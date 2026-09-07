import { NextRequest, NextResponse } from 'next/server';
import { getAllProviders } from '@/lib/providers';
import { getKeys } from '@/lib/storage';

export async function GET() {
  const providers = getAllProviders();
  const keys = await getKeys();
  
  // Add key counts per provider
  const providersWithStats = providers.map(p => {
    const providerKeys = keys.filter(k => k.provider === p.id);
    const activeKeys = providerKeys.filter(k => k.isActive && k.isValid);
    const rateLimited = providerKeys.filter(k => k.rateLimitedUntil && new Date(k.rateLimitedUntil).getTime() > Date.now());
    
    return {
      ...p,
      stats: {
        totalKeys: providerKeys.length,
        activeKeys: activeKeys.length,
        rateLimitedKeys: rateLimited.length,
        totalUsage: providerKeys.reduce((sum, k) => sum + k.usageCount, 0),
      }
    };
  });

  return NextResponse.json({ providers: providersWithStats });
}
