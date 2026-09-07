import { NextRequest, NextResponse } from 'next/server';
import { getAllProviders } from '@/lib/providers';
import { getKeysByProvider } from '@/lib/storage';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const providerFilter = searchParams.get('provider');

  // OpenAI-compatible models listing
  // If provider specified, proxy to that provider, else aggregate from config

  if (providerFilter) {
    const { getProvider } = await import('@/lib/providers');
    const { getHealthyKeys } = await import('@/lib/router');
    
    const providerConfig = getProvider(providerFilter);
    if (!providerConfig) {
      return NextResponse.json({ error: `Unknown provider ${providerFilter}` }, { status: 400 });
    }

    const healthy = await getHealthyKeys(providerFilter);
    if (healthy.length === 0) {
      // Return config models if no keys
      return NextResponse.json({
        object: 'list',
        data: providerConfig.defaultModels.map(m => ({
          id: m,
          object: 'model',
          created: Date.now(),
          owned_by: providerFilter,
        })),
        provider: providerFilter,
      });
    }

    // Try to fetch from provider
    try {
      const key = healthy[0];
      const { getDecryptedKey: getDec } = await import('@/lib/storage');
      const decrypted = await getDec(key);
      const { buildProxyUrl: bUrl, buildProxyHeaders: bHeaders } = await import('@/lib/router');
      
      const url = bUrl(providerConfig, decrypted, 'models', {}, key.customBaseUrl);
      const headers = bHeaders(providerConfig, decrypted, {}, key.customBaseUrl);
      
      const res = await fetch(url, { headers });
      const data = await res.json();
      
      if (res.ok) return NextResponse.json(data);
      // Fall back to config
    } catch {}
    
    return NextResponse.json({
      object: 'list',
      data: providerConfig.defaultModels.map(m => ({
        id: m,
        object: 'model',
        created: Date.now(),
        owned_by: providerFilter,
      })),
      provider: providerFilter,
    });
  }

  // No provider filter: return aggregated list with provider info
  const providers = getAllProviders();
  const allModels: any[] = [];

  for (const p of providers) {
    const keys = await getKeysByProvider(p.id);
    if (keys.length > 0 || p.id === 'openai') {
      for (const model of p.defaultModels) {
        allModels.push({
          id: model,
          object: 'model',
          created: Date.now(),
          owned_by: p.id,
          provider: p.id,
        });
      }
    }
  }

  // Also add generic openai models if no keys yet, for discovery
  if (allModels.length === 0) {
    const openai = providers.find(p => p.id === 'openai')!;
    for (const model of openai.defaultModels) {
      allModels.push({
        id: model,
        object: 'model',
        created: Date.now(),
        owned_by: 'openai',
        provider: 'openai',
      });
    }
  }

  return NextResponse.json({
    object: 'list',
    data: allModels,
  });
}
