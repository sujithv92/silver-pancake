import { NextRequest, NextResponse } from 'next/server';
import { getProvider } from '@/lib/providers';
import { getHealthyKeys, buildProxyHeaders, buildProxyUrl, handleKeyError, shouldRetryWithNextKey } from '@/lib/router';
import { getDecryptedKey, incrementKeyUsage, addLog, getKeysByProvider } from '@/lib/storage';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let body: any;
  let bodyText: string;

  try {
    bodyText = await req.text();
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const model = body.model || 'claude-3-5-sonnet-20241022';
  const providerId = 'anthropic';
  const providerConfig = getProvider(providerId)!;

  const url = new URL(req.url);
  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { queryParams[k] = v; });

  const originalHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => { originalHeaders[k] = v; });

  let attempts = 0;
  let lastError: any;
  const triedKeyIds = new Set<string>();

  for (let attempt = 0; attempt < 5; attempt++) {
    attempts++;
    let routing;
    try {
      const healthy = await getHealthyKeys(providerId);
      const untried = healthy.filter(k => !triedKeyIds.has(k.id));
      if (untried.length === 0) {
        if (attempt === 0) {
          const all = await getKeysByProvider(providerId);
          const rateLimited = all.filter(k => k.rateLimitedUntil && new Date(k.rateLimitedUntil).getTime() > Date.now());
          if (rateLimited.length > 0) {
            const earliest = Math.min(...rateLimited.map(k => new Date(k.rateLimitedUntil!).getTime()));
            const retryAfter = Math.max(1, Math.ceil((earliest - Date.now()) / 1000));
            return NextResponse.json({ error: `All keys rate limited`, retry_after: retryAfter }, { status: 429, headers: { 'Retry-After': retryAfter.toString() } });
          }
          return NextResponse.json({ error: `No active keys for ${providerId}` }, { status: 503 });
        }
        break;
      }
      const selected = untried[attempt % untried.length];
      routing = { key: selected, decryptedKey: await getDecryptedKey(selected), providerConfig };
      triedKeyIds.add(selected.id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }

    try {
      const proxyUrl = buildProxyUrl(routing.providerConfig!, routing.decryptedKey, 'v1/messages', queryParams, routing.key.customBaseUrl);
      const proxyHeaders = buildProxyHeaders(routing.providerConfig!, routing.decryptedKey, originalHeaders, routing.key.customBaseUrl);

      const fetchRes = await fetch(proxyUrl, {
        method: 'POST',
        headers: proxyHeaders,
        body: bodyText,
      });

      const latency = Date.now() - startTime;
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
          path: 'v1/messages',
          method: 'POST',
          retryCount: attempts - 1,
        });

        const headers = new Headers();
        fetchRes.headers.forEach((v, k) => {
          if (!['content-encoding', 'content-length'].includes(k.toLowerCase())) headers.set(k, v);
        });
        headers.set('X-Key-Used', routing.key.name);
        return new Response(fetchRes.body, { status: fetchRes.status, headers });
      }

      const text = await fetchRes.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = { error: text }; }

      if (!fetchRes.ok && shouldRetryWithNextKey(fetchRes.status)) {
        await handleKeyError(routing.key.id, fetchRes.status, fetchRes.headers as any);
        lastError = { status: fetchRes.status, body: json };
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
        error: fetchRes.ok ? undefined : JSON.stringify(json).slice(0, 500),
        path: 'v1/messages',
        method: 'POST',
        retryCount: attempts - 1,
      });

      const resHeaders: Record<string, string> = {};
      fetchRes.headers.forEach((v, k) => {
        if (!['content-encoding', 'content-length'].includes(k.toLowerCase())) resHeaders[k] = v;
      });
      resHeaders['X-Key-Used'] = routing.key.name;

      return NextResponse.json(json, { status: fetchRes.status, headers: resHeaders });

    } catch (e: any) {
      lastError = e;
      continue;
    }
  }

  return NextResponse.json({ error: `All keys failed after ${attempts} attempts`, last_error: lastError?.body || lastError?.message }, { status: lastError?.status || 502 });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
    },
  });
}
