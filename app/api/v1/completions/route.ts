import { NextRequest, NextResponse } from 'next/server';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const provider = req.headers.get('x-ai-provider') || url.searchParams.get('provider') || 'openai';
  
  const body = await req.text();
  const { getProvider } = await import('@/lib/providers');
  const { getHealthyKeys, buildProxyHeaders, buildProxyUrl, handleKeyError, shouldRetryWithNextKey } = await import('@/lib/router');
  const { getDecryptedKey, incrementKeyUsage, addLog } = await import('@/lib/storage');

  const providerConfig = getProvider(provider);
  if (!providerConfig) return NextResponse.json({ error: `Unknown provider ${provider}` }, { status: 400 });

  const originalHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => { originalHeaders[k] = v; });

  const queryParams: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { if (k !== 'provider') queryParams[k] = v; });

  let bodyJson: any;
  try { bodyJson = JSON.parse(body); } catch { bodyJson = {}; }

  let attempts = 0;
  const tried = new Set<string>();
  let lastError: any;

  for (let i = 0; i < 5; i++) {
    attempts++;
    let routing;
    try {
      const healthy = await getHealthyKeys(provider);
      const untried = healthy.filter(k => !tried.has(k.id));
      if (untried.length === 0) {
        if (i === 0) return NextResponse.json({ error: `No keys for ${provider}` }, { status: 503 });
        break;
      }
      const sel = untried[i % untried.length];
      routing = { key: sel, decryptedKey: await getDecryptedKey(sel), providerConfig };
      tried.add(sel.id);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }

    try {
      const pUrl = buildProxyUrl(routing.providerConfig!, routing.decryptedKey, 'completions', queryParams, routing.key.customBaseUrl);
      const pHeaders = buildProxyHeaders(routing.providerConfig!, routing.decryptedKey, originalHeaders, routing.key.customBaseUrl);

      const res = await fetch(pUrl, { method: 'POST', headers: pHeaders, body });
      const latencyStart = Date.now();
      const isStreaming = bodyJson.stream === true;

      if (isStreaming && res.ok && res.body) {
        await incrementKeyUsage(routing.key.id, true);
        const headers = new Headers();
        res.headers.forEach((v, k) => {
          if (!['content-encoding', 'content-length'].includes(k.toLowerCase())) headers.set(k, v);
        });
        headers.set('X-Key-Used', routing.key.name);
        return new Response(res.body, { status: res.status, headers });
      }

      const text = await res.text();
      let json: any; try { json = JSON.parse(text); } catch { json = { error: text }; }

      if (!res.ok && shouldRetryWithNextKey(res.status)) {
        await handleKeyError(routing.key.id, res.status, res.headers as any);
        lastError = { status: res.status, body: json };
        continue;
      }

      if (res.ok) await incrementKeyUsage(routing.key.id, true);
      else await incrementKeyUsage(routing.key.id, false, res.status === 429);

      await addLog({
        provider,
        model: bodyJson.model,
        keyId: routing.key.id,
        keyName: routing.key.name,
        status: res.status,
        latency: 0,
        success: res.ok,
        path: 'completions',
        method: 'POST',
        retryCount: attempts - 1,
      });

      return NextResponse.json(json, { status: res.status });
    } catch (e: any) {
      lastError = e;
      continue;
    }
  }

  return NextResponse.json({ error: `All keys failed`, last_error: lastError?.body || lastError?.message }, { status: 502 });
}
