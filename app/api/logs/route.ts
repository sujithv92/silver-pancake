import { NextRequest, NextResponse } from 'next/server';
import { getLogs } from '@/lib/storage';
import { requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response!;

  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const provider = searchParams.get('provider');
    
    let logs = await getLogs(Math.min(limit, 500));
    
    if (provider) {
      logs = logs.filter(l => l.provider === provider);
    }

    return NextResponse.json({ logs });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
