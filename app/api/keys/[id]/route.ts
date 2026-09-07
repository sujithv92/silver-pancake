import { NextRequest, NextResponse } from 'next/server';
import { getKeyById, updateKey, deleteKey, getDecryptedKey } from '@/lib/storage';
import { requireAuth } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response!;

  const { id } = await params;
  const key = await getKeyById(id);
  if (!key) return NextResponse.json({ error: 'Key not found' }, { status: 404 });

  const decrypted = await getDecryptedKey(key);
  const { key: _, ...rest } = key;
  return NextResponse.json({ 
    key: {
      ...rest,
      maskedKey: `${decrypted.slice(0, 7)}...${decrypted.slice(-4)}`,
      hasKey: true,
    }
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response!;

  try {
    const { id } = await params;
    const body = await req.json();
    
    const existing = await getKeyById(id);
    if (!existing) return NextResponse.json({ error: 'Key not found' }, { status: 404 });

    // Only allow updating certain fields
    const allowedFields = ['name', 'isActive', 'isValid', 'customBaseUrl', 'notes', 'key', 'rateLimitedUntil'];
    const updates: any = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    // Special handling for clearing rate limit
    if (body.clearRateLimit) {
      updates.rateLimitedUntil = null;
    }

    if (body.resetStats) {
      updates.usageCount = 0;
      updates.successCount = 0;
      updates.failureCount = 0;
      updates.isValid = true;
      updates.rateLimitedUntil = null;
    }

    const updated = await updateKey(id, updates);
    if (!updated) return NextResponse.json({ error: 'Failed to update' }, { status: 500 });

    const decrypted = await getDecryptedKey(updated);
    const { key: _, ...rest } = updated;
    
    return NextResponse.json({
      key: {
        ...rest,
        maskedKey: `${decrypted.slice(0, 7)}...${decrypted.slice(-4)}`,
        hasKey: true,
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response!;

  const { id } = await params;
  const success = await deleteKey(id);
  if (!success) return NextResponse.json({ error: 'Key not found' }, { status: 404 });

  return NextResponse.json({ message: 'Key deleted' });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Test key endpoint: POST /api/keys/[id]/test
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response!;

  const { id } = await params;
  const key = await getKeyById(id);
  if (!key) return NextResponse.json({ error: 'Key not found' }, { status: 404 });

  // This will be handled by query param ?action=test
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'test') {
    try {
      const decrypted = await getDecryptedKey(key);
      const { getProvider } = await import('@/lib/providers');
      const providerConfig = getProvider(key.provider);
      
      if (!providerConfig) {
        return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
      }

      // Simple test: try to list models or make a minimal request
      const { buildProxyUrl, buildProxyHeaders } = await import('@/lib/router');
      
      let testPath = 'models';
      if (key.provider === 'anthropic') testPath = ''; // Anthropic doesn't have models endpoint same way, just validate key format
      if (key.provider === 'google') testPath = 'models';
      
      const url = buildProxyUrl(providerConfig, decrypted, testPath, {}, key.customBaseUrl);
      const headers = buildProxyHeaders(providerConfig, decrypted, {}, key.customBaseUrl);

      // For anthropic, we can't easily test without making a real request, so just check format
      if (key.provider === 'anthropic') {
        if (!decrypted.startsWith('sk-ant-')) {
          return NextResponse.json({ valid: false, error: 'Anthropic key should start with sk-ant-' });
        }
        return NextResponse.json({ valid: true, message: 'Key format looks valid (Anthropic keys cannot be tested without a full request)' });
      }

      if (key.provider === 'google') {
        // Google test
        const testUrl = `https://generativelanguage.googleapis.com/v1/models?key=${decrypted}`;
        const res = await fetch(testUrl, { method: 'GET' });
        if (res.ok) {
          return NextResponse.json({ valid: true, message: 'Key is valid' });
        } else {
          const text = await res.text();
          return NextResponse.json({ valid: false, error: `Test failed: ${res.status} ${text.slice(0, 200)}`, status: res.status });
        }
      }

      const res = await fetch(url, { method: 'GET', headers });
      const text = await res.text();
      
      if (res.ok) {
        await updateKey(id, { isValid: true, failureCount: 0 });
        return NextResponse.json({ valid: true, message: 'Key is valid', data: text.slice(0, 500) });
      } else {
        if (res.status === 401 || res.status === 403) {
          await updateKey(id, { isValid: false });
        }
        return NextResponse.json({ valid: false, error: `Test failed: ${res.status}`, details: text.slice(0, 500), status: res.status });
      }
    } catch (e: any) {
      return NextResponse.json({ valid: false, error: e.message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
