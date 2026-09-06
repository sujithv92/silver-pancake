import { NextResponse } from 'next/server';
import { getKeys, getStats } from '@/lib/storage';
import { getAllProviders } from '@/lib/providers';

export async function GET() {
  try {
    const keys = await getKeys();
    const stats = await getStats();
    const providers = getAllProviders();

    const hasKv = !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL);
    const storageType = hasKv ? (process.env.UPSTASH_REDIS_REST_URL ? 'upstash-redis' : 'vercel-kv') : 'file-memory';

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      storage: storageType,
      providers: providers.length,
      keys: {
        total: keys.length,
        active: keys.filter(k => k.isActive).length,
        valid: keys.filter(k => k.isValid).length,
      },
      stats: {
        totalRequests: stats.totalRequests,
        successRate: stats.totalRequests > 0 ? (stats.successfulRequests / stats.totalRequests * 100).toFixed(1) + '%' : '0%',
      },
      endpoints: {
        proxy: '/api/proxy/{provider}/{path}',
        openaiCompatible: '/api/v1/chat/completions',
        anthropicCompatible: '/api/v1/messages',
        models: '/api/v1/models',
      }
    });
  } catch (e: any) {
    return NextResponse.json({ status: 'error', error: e.message }, { status: 500 });
  }
}
