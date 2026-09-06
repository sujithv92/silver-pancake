import { NextRequest, NextResponse } from 'next/server';
import { getProvider } from '@/lib/providers';
import { selectNextKey, buildProxyHeaders, buildProxyUrl, handleKeyError, shouldRetryWithNextKey, parseRetryAfter, getHealthyKeys } from '@/lib/router';
import { getDecryptedKey, incrementKeyUsage, addLog, getKeysByProvider } from '@/lib/storage';

export const maxDuration = 60; // Allow up to 60s for AI responses

async function handleProxy(
  req: NextRequest,
  providerId: string,
  pathSegments: string[],
  method: string
) {
  const startTime = Date.now();
  let lastError: any = null;
  let attempts = 0;
  const triedKeyIds = new Set<string>();

  const providerConfig = getProvider(providerId);
  if (!providerConfig) {
    return NextResponse.json({ error: `Unknown provider: ${providerId}` }, { status: 400 });
  }

  // Get request body
  let body: any = null;
  let bodyText: string | null = null;
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      bodyText = await req.text();
      if (bodyText) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
      }
    } catch {}
  }

  // Get query params
  const url = new URL(req.url);
  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    queryParams[key] = value;
  });

  // Get original headers
  const originalHeaders: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    originalHeaders[key] = value;
  });

  const requestPath = pathSegments.join('/');

  // Attempt with rotation
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    attempts++;
    
    let routing;
    try {
      // Get healthy keys excluding already tried ones
      const healthyKeys = await getHealthyKeys(providerId);
      const untried = healthyKeys.filter(k => !triedKeyIds.has(k.id));
      
      if (untried.length === 0) {
        if (attempt === 0) {
          // First attempt and no keys
          const allKeys = await getKeysByProvider(providerId);
          const rateLimited = allKeys.filter(k => k.rateLimitedUntil && new Date(k.rateLimitedUntil).getTime() > Date.now());
          if (rateLimited.length > 0) {
            const earliest = Math.min(...rateLimited.map(k => new Date(k.rateLimitedUntil!).getTime()));
            const retryAfter = Math.max(1, Math.ceil((earliest - Date.now()) / 1000));
            return NextResponse.json({
              error: `All keys rate limited for provider ${providerId}`,
              retry_after: retryAfter,
              provider: providerId,
            }, { 
              status: 429,
              headers: { 'Retry-After': retryAfter.toString() }
            });
          }
          return NextResponse.json({
            error: `No active keys for provider ${providerId}. Add keys in dashboard.`,
            provider: providerId,
          }, { status: 503 });
        }
        break;
      }

      // Select next key from untried
      const selectedKey = untried[attempt % untried.length];
      const decrypted = await getDecryptedKey(selectedKey);
      
      routing = {
        key: selectedKey,
        decryptedKey: decrypted,
        providerConfig,
      };
      triedKeyIds.add(selectedKey.id);
    } catch (e: any) {
      if (e.code === 'ALL_RATE_LIMITED') {
        return NextResponse.json({
          error: e.message,
          retry_after: e.retryAfter,
          provider: providerId,
        }, {
          status: 429,
          headers: { 'Retry-After': (e.retryAfter || 60).toString() }
        });
      }
      return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    }

    try {
      const proxyUrl = buildProxyUrl(routing.providerConfig!, routing.decryptedKey, requestPath, queryParams, routing.key.customBaseUrl);
      const proxyHeaders = buildProxyHeaders(routing.providerConfig!, routing.decryptedKey, originalHeaders, routing.key.customBaseUrl);

      // For Google, body handling is different - they use query key, not header
      // For streaming, we need to handle accordingly
      
      const fetchOptions: RequestInit = {
        method,
        headers: proxyHeaders,
      };

      if (bodyText && method !== 'GET' && method !== 'HEAD') {
        fetchOptions.body = bodyText;
      }

      // Check if streaming requested
      const isStreaming = body && (body.stream === true || body.stream === 'true');

      const proxyRes = await fetch(proxyUrl, fetchOptions);
      const latency = Date.now() - startTime;

      // Handle streaming response
      if (isStreaming && proxyRes.ok && proxyRes.body) {
        await incrementKeyUsage(routing.key.id, true);
        await addLog({
          provider: providerId,
          model: body?.model,
          keyId: routing.key.id,
          keyName: routing.key.name,
          status: proxyRes.status,
          latency,
          success: true,
          path: requestPath,
          method,
          retryCount: attempts - 1,
        });

        // Stream the response
        const headers = new Headers();
        proxyRes.headers.forEach((v, k) => {
          // Filter out some headers
          if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(k.toLowerCase())) {
            headers.set(k, v);
          }
        });
        headers.set('X-Key-Used', routing.key.name);
        headers.set('X-Provider', providerId);
        headers.set('X-Retry-Count', (attempts - 1).toString());

        return new Response(proxyRes.body, {
          status: proxyRes.status,
          headers,
        });
      }

      const responseText = await proxyRes.text();
      let responseJson: any;
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        responseJson = responseText;
      }

      // Check if should retry with next key
      if (!proxyRes.ok && shouldRetryWithNextKey(proxyRes.status)) {
        await handleKeyError(routing.key.id, proxyRes.status, proxyRes.headers as any);
        lastError = { status: proxyRes.status, body: responseJson, headers: proxyRes.headers };
        
        // If auth error, try next key immediately, otherwise small delay
        if (proxyRes.status !== 401 && proxyRes.status !== 403) {
          await new Promise(r => setTimeout(r, 100 * attempt));
        }
        continue;
      }

      // Success or non-retryable error
      if (proxyRes.ok) {
        await incrementKeyUsage(routing.key.id, true);
      } else {
        await incrementKeyUsage(routing.key.id, false, proxyRes.status === 429);
      }

      await addLog({
        provider: providerId,
        model: body?.model,
        keyId: routing.key.id,
        keyName: routing.key.name,
        status: proxyRes.status,
        latency,
        success: proxyRes.ok,
        error: proxyRes.ok ? undefined : JSON.stringify(responseJson).slice(0, 500),
        path: requestPath,
        method,
        retryCount: attempts - 1,
      });

      // Return response
      const resHeaders: Record<string, string> = {};
      proxyRes.headers.forEach((v, k) => {
        if (!['content-encoding', 'content-length'].includes(k.toLowerCase())) {
          resHeaders[k] = v;
        }
      });
      resHeaders['X-Key-Used'] = routing.key.name;
      resHeaders['X-Provider'] = providerId;
      resHeaders['X-Retry-Count'] = (attempts - 1).toString();
      resHeaders['X-Key-Id'] = routing.key.id;

      if (typeof responseJson === 'object') {
        return NextResponse.json(responseJson, { status: proxyRes.status, headers: resHeaders });
      } else {
        return new NextResponse(responseJson, { status: proxyRes.status, headers: resHeaders });
      }

    } catch (e: any) {
      lastError = e;
      await incrementKeyUsage(routing.key.id, false, false);
      // Network error, try next key
      continue;
    }
  }

  // All retries exhausted
  const latency = Date.now() - startTime;
  await addLog({
    provider: providerId,
    keyId: 'none',
    keyName: 'none',
    status: lastError?.status || 500,
    latency,
    success: false,
    error: `All ${attempts} attempts failed: ${JSON.stringify(lastError?.body || lastError?.message || 'Unknown').slice(0, 500)}`,
    path: requestPath,
    method,
    retryCount: attempts,
  });

  return NextResponse.json({
    error: `All keys failed for provider ${providerId} after ${attempts} attempts`,
    last_error: lastError?.body || lastError?.message,
    provider: providerId,
    attempts,
  }, { status: lastError?.status || 502 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string; path: string[] }> }) {
  const { provider, path } = await params;
  return handleProxy(req, provider, path || [], 'GET');
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string; path: string[] }> }) {
  const { provider, path } = await params;
  return handleProxy(req, provider, path || [], 'POST');
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ provider: string; path: string[] }> }) {
  const { provider, path } = await params;
  return handleProxy(req, provider, path || [], 'PUT');
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ provider: string; path: string[] }> }) {
  const { provider, path } = await params;
  return handleProxy(req, provider, path || [], 'PATCH');
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ provider: string; path: string[] }> }) {
  const { provider, path } = await params;
  return handleProxy(req, provider, path || [], 'DELETE');
}
