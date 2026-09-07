import { NextRequest, NextResponse } from 'next/server';
import { getKeysMasked, addKey, getKeys } from '@/lib/storage';
import { requireAuth } from '@/lib/auth';
import { getProvider } from '@/lib/providers';

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response!;

  try {
    const { searchParams } = new URL(req.url);
    const provider = searchParams.get('provider');
    
    let keys = await getKeysMasked();
    if (provider) {
      keys = keys.filter(k => k.provider === provider);
    }

    return NextResponse.json({ keys });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authenticated) return auth.response!;

  try {
    const body = await req.json();
    const { name, provider, key, customBaseUrl, notes, isActive } = body;

    if (!name || !provider || !key) {
      return NextResponse.json({ error: 'Missing required fields: name, provider, key' }, { status: 400 });
    }

    // Validate provider
    const providerConfig = getProvider(provider);
    if (!providerConfig && provider !== 'custom' && !provider.startsWith('custom-')) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
    }

    if (provider === 'custom' && !customBaseUrl) {
      return NextResponse.json({ error: 'Custom provider requires customBaseUrl' }, { status: 400 });
    }

    // Check for duplicate key (by decrypting and comparing? just check same provider + same key prefix)
    const existingKeys = await getKeys();
    // We won't do strict duplicate check for simplicity, but we can warn

    const newKey = await addKey({
      name: name.trim(),
      provider,
      key: key.trim(),
      customBaseUrl: customBaseUrl?.trim(),
      notes: notes?.trim(),
      isActive: isActive ?? true,
    });

    // Return masked version
    const { key: _, ...rest } = newKey as any;
    return NextResponse.json({ 
      key: {
        ...rest,
        maskedKey: `${newKey.key.slice(0, 7)}...${newKey.key.slice(-4)}`,
        hasKey: true,
      },
      message: 'Key added successfully' 
    }, { status: 201 });
  } catch (e: any) {
    console.error('Add key error:', e);
    return NextResponse.json({ error: e.message || 'Failed to add key' }, { status: 500 });
  }
}
