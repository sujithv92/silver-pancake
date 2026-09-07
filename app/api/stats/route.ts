import { NextResponse } from 'next/server';
import { getStats, getKeys } from '@/lib/storage';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response!;

  try {
    const stats = await getStats();
    const keys = await getKeys();

    const activeKeys = keys.filter(k => k.isActive).length;
    const validKeys = keys.filter(k => k.isValid).length;
    const rateLimitedKeys = keys.filter(k => k.rateLimitedUntil && new Date(k.rateLimitedUntil).getTime() > Date.now()).length;

    return NextResponse.json({
      stats,
      overview: {
        totalKeys: keys.length,
        activeKeys,
        validKeys,
        rateLimitedKeys,
        providers: Object.keys(stats.providerStats).length,
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE() {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response!;

  try {
    const { clearLogs } = await import('@/lib/storage');
    await clearLogs();
    return NextResponse.json({ message: 'Stats and logs cleared' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
