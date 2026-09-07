import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword, createAdminSession, getAuthCookieName, verifyAdminSession } from '@/lib/auth';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password } = body;

    if (!password) {
      return NextResponse.json({ error: 'Password required' }, { status: 400 });
    }

    const isValid = await verifyAdminPassword(password);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const session = await createAdminSession();
    
    const response = NextResponse.json({ success: true, message: 'Authenticated' });
    response.cookies.set(getAuthCookieName(), session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60, // 24 hours
      path: '/',
    });

    return response;
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(getAuthCookieName())?.value;
    
    if (!session) {
      return NextResponse.json({ authenticated: false });
    }

    const valid = await verifyAdminSession(session);
    return NextResponse.json({ authenticated: valid });
  } catch (e: any) {
    return NextResponse.json({ authenticated: false, error: e.message });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true, message: 'Logged out' });
  response.cookies.set(getAuthCookieName(), '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return response;
}
