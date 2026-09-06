import { cookies } from 'next/headers';
import crypto from 'crypto';

const ADMIN_COOKIE = 'ai-router-admin';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || process.env.ADMIN_KEY || 'admin';
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export async function verifyAdminPassword(inputPassword: string): Promise<boolean> {
  const adminPassword = getAdminPassword();
  // Use timing-safe comparison
  const inputHash = hashPassword(inputPassword);
  const expectedHash = hashPassword(adminPassword);
  
  try {
    return crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(expectedHash));
  } catch {
    return inputPassword === adminPassword;
  }
}

export async function createAdminSession(): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DURATION;
  const payload = JSON.stringify({ token, expires });
  const secret = getAdminPassword();
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${Buffer.from(payload).toString('base64')}.${signature}`;
}

export async function verifyAdminSession(sessionValue: string): Promise<boolean> {
  try {
    const [payloadB64, signature] = sessionValue.split('.');
    if (!payloadB64 || !signature) return false;
    
    const payload = Buffer.from(payloadB64, 'base64').toString('utf-8');
    const secret = getAdminPassword();
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return false;
    }
    
    const data = JSON.parse(payload);
    return data.expires > Date.now();
  } catch {
    return false;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  // If no admin password set (default), allow all in dev? No, require auth always but default password is 'admin'
  // For seamless Vercel deploy, if ADMIN_PASSWORD not set, we still require login with 'admin'
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(ADMIN_COOKIE)?.value;
    if (!session) return false;
    return await verifyAdminSession(session);
  } catch {
    return false;
  }
}

export async function requireAuth(): Promise<{ authenticated: boolean; response?: Response }> {
  // Allow bypass if DISABLE_AUTH is set (for development)
  if (process.env.DISABLE_AUTH === 'true') {
    return { authenticated: true };
  }

  const auth = await isAuthenticated();
  if (!auth) {
    return {
      authenticated: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized', message: 'Please login via dashboard' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }
  return { authenticated: true };
}

export function getAuthCookieName(): string {
  return ADMIN_COOKIE;
}
