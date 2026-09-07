import { NextRequest, NextResponse } from 'next/server';
import { getProviderFromModel, getProvider } from '@/lib/providers';
import { selectNextKey, buildProxyHeaders, buildProxyUrl, handleKeyError, shouldRetryWithNextKey, getHealthyKeys } from '@/lib/router';
import { getDecryptedKey, incrementKeyUsage, addLog, getKeysByProvider } from '@/lib/storage';

export const maxDuration = 60;

async function handleChatCompletion(req: NextRequest) {
  const startTime = Date.now();
  let body: any;
  let bodyText: string;

  try {
    bodyText = await req.text();
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const model = body.model;
  if (!model) {
    return NextResponse.json({ error: 'Model is required' }, { status: 400 });
  }

  // Determine provider
  let providerId = req.headers.get('x-ai-provider') || req.headers.get('x-provider') || body.provider || '';
  if (!providerId) {
    // Try to infer from model
    providerId = getProviderFromModel(model);
    
    // If model contains '/', it might be from OpenRouter/Together, keep provider as openrouter/together if available
    // But for simplicity, use inferred provider unless openrouter key exists
    // Check if provider has keys, if not, try openrouter as fallback for slash models
    if (model.includes('/')) {
      const openRouterKeys = await getKeysByProvider('openrouter');
      if (openRouterKeys.length > 0) {
        providerId = 'openrouter';
      }
    }
  }

  // Allow override via query param
  const url = new URL(req.url);
  if (url.searchParams.get('provider')) {
    providerId = url.searchParams.get('provider')!;
  }

  const providerConfig = getProvider(providerId);
  if (!providerConfig) {
    return NextResponse.json({ error: `Unknown provider: ${providerId}. Use X-AI-Provider header to specify.` }, { status: 400 });
  }

  if (!providerConfig.isOpenAICompatible) {
    return NextResponse.json({ 
      error: `Provider ${providerId} is not OpenAI compatible. Use /api/proxy/${providerId}/... or /api/v1/messages for Anthropic.` 
    }, { status: 400 });
  }

  const originalHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => { originalHeaders[k] = v; });

  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { if (k !== 'provider') queryParams[k] = v; });

  let attempts = 0;
  let lastError: any;
  const triedKeyIds = new Set<string>();

  for (let attempt = 0; attempt < 5; attempt++) {
    attempts++;
    
    let routing;
    try {
      const healthyKeys = await getHealthyKeys(providerId);
      const untried = healthyKeys.filter(k => !triedKeyIds.has(k.id));
      if (untried.length === 0) {
        if (attempt === 0) {
          const allKeys = await getKeysByProvider(providerId);
          const rateLimited = allKeys.filter(k => k.rateLimitedUntil && new Date(k.rateLimitedUntil).getTime() > Date.now());
          if (rateLimited.length > 0) {
            const earliest = Math.min(...rateLimited.map(k => new Date(k.rateLimitedUntil!).getTime()));
            const retryAfter = Math.max(1, Math.ceil((earliest - Date.now()) / 1000));
            return NextResponse.json({
              error: { message: `All keys rate limited for ${providerId}`, type: 'rate_limit', code: 'rate_limit_exceeded' },
              retry_after: retryAfter,
            }, { status: 429, headers: { 'Retry-After': retryAfter.toString() } });
          }
          return NextResponse.json({
            error: { message: `No active keys for provider ${providerId}`, type: 'invalid_request_error' }
          }, { status: 503 });
        }
        break;
      }
      const selected = untried[attempt % untried.length];
      routing = {
        key: selected,
        decryptedKey: await getDecryptedKey(selected),
        providerConfig,
      };
      triedKeyIds.add(selected.id);
    } catch (e: any) {
      if (e.code === 'ALL_RATE_LIMITED') {
        return NextResponse.json({
          error: { message: e.message, type: 'rate_limit' },
          retry_after: e.retryAfter,
        }, { status: 429, headers: { 'Retry-After': (e.retryAfter || 60).toString() } });
      }
      return NextResponse.json({ error: { message: e.message } }, { status: 503 });
    }

    try {
      // For OpenAI-compatible, path is chat/completions
      const proxyUrl = buildProxyUrl(routing.providerConfig!, routing.decryptedKey, 'chat/completions', queryParams, routing.key.customBaseUrl);
      const proxyHeaders = buildProxyHeaders(routing.providerConfig!, routing.decryptedKey, originalHeaders, routing.key.customBaseUrl);

      const fetchRes = await fetch(proxyUrl, {
        method: 'POST',
        headers: proxyHeaders,
        body: bodyText,
      });

      const latency = Date.now() - startTime;

      // Streaming?
      const isStreaming = body.stream === true;

      if (isStreaming && fetchRes.ok && fetchRes.body) {
        await incrementKeyUsage(routing.key.id, true);
        await addLog({
          provider: providerId,
          model,
          keyId: routing.key.id,
          keyName: routing.key.name,
          status: fetchRes.status,
          latency,
          success: true,
          path: 'chat/completions',
          method: 'POST',
          retryCount: attempts - 1,
        });

        const headers = new Headers();
        fetchRes.headers.forEach((v, k) => {
          if (!['content-encoding', 'content-length'].includes(k.toLowerCase())) {
            headers.set(k, v);
          }
        });
        headers.set('X-Key-Used', routing.key.name);
        headers.set('X-Provider', providerId);

        return new Response(fetchRes.body, { status: fetchRes.status, headers });
      }

      const responseText = await fetchRes.text();
      let responseJson: any;
      try { responseJson = JSON.parse(responseText); } catch { responseJson = { error: responseText }; }

      if (!fetchRes.ok && shouldRetryWithNextKey(fetchRes.status)) {
        await handleKeyError(routing.key.id, fetchRes.status, fetchRes.headers as any);
        lastError = { status: fetchRes.status, body: responseJson };
        continue;
      }

      if (fetchRes.ok) await incrementKeyUsage(routing.key.id, true);
      else await incrementKeyUsage(routing.key.id, false, fetchRes.status === 429);

      await addLog({
        provider: providerId,
        model,
        keyId: routing.key.id,
        keyName: routing.key.name,
        status: fetchRes.status,
        latency,
        success: fetchRes.ok,
        error: fetchRes.ok ? undefined : JSON.stringify(responseJson).slice(0, 500),
        path: 'chat/completions',
        method: 'POST',
        retryCount: attempts - 1,
      });

      const resHeaders: Record<string, string> = {};
      fetchRes.headers.forEach((v, k) => {
        if (!['content-encoding', 'content-length'].includes(k.toLowerCase())) {
          resHeaders[k] = v;
        }
      });
      resHeaders['X-Key-Used'] = routing.key.name;
      resHeaders['X-Provider'] = providerId;

      return NextResponse.json(responseJson, { status: fetchRes.status, headers: resHeaders });

    } catch (e: any) {
      lastError = e;
      continue;
    }
  }

  return NextResponse.json({
    error: { message: `All keys failed after ${attempts} attempts`, type: 'server_error', last_error: lastError?.body || lastError?.message },
  }, { status: lastError?.status || 502 });
}

export async function POST(req: NextRequest) {
  return handleChatCompletion(req);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-AI-Provider, X-Provider',
    },
  });
}
