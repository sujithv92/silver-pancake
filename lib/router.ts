import { ApiKey } from './types';
import { getKeysByProvider, getDecryptedKey, incrementKeyUsage, setKeyRateLimited, clearRateLimitIfExpired } from './storage';
import { getProvider } from './providers';

export interface RoutingOptions {
  provider: string;
  model?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface RoutingResult {
  key: ApiKey;
  decryptedKey: string;
  providerConfig: ReturnType<typeof getProvider>;
}

export class KeyRotationError extends Error {
  constructor(
    message: string,
    public code: 'NO_KEYS' | 'ALL_RATE_LIMITED' | 'ALL_INVALID' | 'ALL_FAILED',
    public retryAfter?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'KeyRotationError';
  }
}

// In-memory round-robin index per provider
const roundRobinIndex: Record<string, number> = {};

function getNextIndex(provider: string, poolSize: number): number {
  if (!roundRobinIndex[provider]) roundRobinIndex[provider] = 0;
  const idx = roundRobinIndex[provider] % poolSize;
  roundRobinIndex[provider] = (roundRobinIndex[provider] + 1) % poolSize;
  return idx;
}

export async function getHealthyKeys(provider: string): Promise<ApiKey[]> {
  const allKeys = await getKeysByProvider(provider);
  
  // Filter out rate-limited keys that haven't expired
  const healthy: ApiKey[] = [];
  for (const key of allKeys) {
    if (key.rateLimitedUntil) {
      const expired = await clearRateLimitIfExpired(key);
      if (!expired) {
        // Still rate limited, skip
        continue;
      }
    }
    if (key.isActive && key.isValid) {
      healthy.push(key);
    }
  }
  
  // Sort by: least recently used, then least failures, then least usage
  // This provides fair distribution
  healthy.sort((a, b) => {
    // Prefer keys that haven't been rate limited recently
    if (a.failureCount !== b.failureCount) return a.failureCount - b.failureCount;
    if (a.usageCount !== b.usageCount) return a.usageCount - b.usageCount;
    const aLast = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
    const bLast = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
    return aLast - bLast;
  });

  return healthy;
}

export async function selectNextKey(provider: string): Promise<RoutingResult> {
  const healthyKeys = await getHealthyKeys(provider);
  
  if (healthyKeys.length === 0) {
    // Check if there are keys but all rate limited
    const allKeys = await getKeysByProvider(provider);
    const rateLimitedKeys = allKeys.filter(k => k.rateLimitedUntil);
    
    if (rateLimitedKeys.length > 0) {
      // Find earliest retry time
      const retryTimes = rateLimitedKeys
        .map(k => k.rateLimitedUntil ? new Date(k.rateLimitedUntil).getTime() : Infinity)
        .filter(t => t !== Infinity);
      
      const earliest = Math.min(...retryTimes);
      const retryAfter = Math.max(1, Math.ceil((earliest - Date.now()) / 1000));
      
      throw new KeyRotationError(
        `All keys for provider ${provider} are rate limited. Retry after ${retryAfter}s`,
        'ALL_RATE_LIMITED',
        retryAfter,
        { rateLimitedCount: rateLimitedKeys.length }
      );
    }

    // Check if keys exist but invalid
    const { getKeys } = await import('./storage');
    const allProviderKeys = (await getKeys()).filter(k => k.provider === provider);
    if (allProviderKeys.length > 0) {
      const invalid = allProviderKeys.filter(k => !k.isValid);
      if (invalid.length === allProviderKeys.length) {
        throw new KeyRotationError(
          `All keys for provider ${provider} are marked invalid (401/403). Please check your keys.`,
          'ALL_INVALID'
        );
      }
    }

    throw new KeyRotationError(
      `No active keys found for provider ${provider}. Please add keys in dashboard.`,
      'NO_KEYS'
    );
  }

  // Round-robin among healthy keys
  const idx = getNextIndex(provider, healthyKeys.length);
  const selectedKey = healthyKeys[idx];
  
  const decrypted = await getDecryptedKey(selectedKey);
  const providerConfig = getProvider(provider);

  if (!providerConfig) {
    throw new KeyRotationError(`Unknown provider: ${provider}`, 'NO_KEYS');
  }

  return {
    key: selectedKey,
    decryptedKey: decrypted,
    providerConfig,
  };
}

export function parseRetryAfter(headers: Headers | Record<string, string>): number {
  // Check various retry-after headers
  const getHeader = (name: string): string | null => {
    if (headers instanceof Headers) {
      return headers.get(name) || headers.get(name.toLowerCase());
    }
    return (headers as any)[name] || (headers as any)[name.toLowerCase()] || null;
  };

  const retryAfter = getHeader('retry-after') || getHeader('x-retry-after') || getHeader('ratelimit-reset');
  
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return Math.min(seconds, 300); // Cap at 5 minutes
    }
    // Try to parse as date
    const date = new Date(retryAfter);
    if (!isNaN(date.getTime())) {
      const diff = Math.ceil((date.getTime() - Date.now()) / 1000);
      return Math.max(1, Math.min(diff, 300));
    }
  }

  // Check ratelimit headers
  const remaining = getHeader('x-ratelimit-remaining') || getHeader('ratelimit-remaining');
  if (remaining === '0') {
    // Rate limited, use default backoff
    return 60;
  }

  return 60; // Default 60s backoff for rate limits
}

export function shouldRetryWithNextKey(status: number): boolean {
  // Retry with next key on these statuses
  return [429, 401, 403, 500, 502, 503, 504].includes(status);
}

export function isRateLimitError(status: number): boolean {
  return status === 429;
}

export function isAuthError(status: number): boolean {
  return status === 401 || status === 403;
}

export async function handleKeyError(keyId: string, status: number, headers: Headers | Record<string, string>): Promise<void> {
  if (isRateLimitError(status)) {
    const retryAfter = parseRetryAfter(headers);
    await setKeyRateLimited(keyId, retryAfter);
    await incrementKeyUsage(keyId, false, true);
  } else if (isAuthError(status)) {
    // Mark as invalid but don't delete - let user fix it
    const { updateKey } = await import('./storage');
    await updateKey(keyId, { isValid: false });
    await incrementKeyUsage(keyId, false, false);
  } else if (status >= 500) {
    // Server error, count as failure but don't invalidate
    await incrementKeyUsage(keyId, false, false);
  }
}

export async function executeWithRotation<T>(
  provider: string,
  operation: (key: ApiKey, decryptedKey: string, providerConfig: NonNullable<ReturnType<typeof getProvider>>) => Promise<T>,
  options: RoutingOptions = { provider }
): Promise<{ result: T; keyUsed: ApiKey; attempts: number }> {
  const maxRetries = options.maxRetries ?? 3;
  let lastError: any;
  let attempts = 0;
  const triedKeys = new Set<string>();

  for (let i = 0; i < maxRetries; i++) {
    attempts++;
    
    let routing: RoutingResult;
    try {
      routing = await selectNextKey(provider);
      
      // Avoid retrying same key in same request
      if (triedKeys.has(routing.key.id)) {
        // Get next healthy key that hasn't been tried
        const healthy = await getHealthyKeys(provider);
        const untried = healthy.filter(k => !triedKeys.has(k.id));
        if (untried.length === 0) break;
        
        const idx = getNextIndex(provider, untried.length);
        const nextKey = untried[idx];
        routing = {
          key: nextKey,
          decryptedKey: await getDecryptedKey(nextKey),
          providerConfig: getProvider(provider)!,
        };
      }
      
      triedKeys.add(routing.key.id);
    } catch (e) {
      if (e instanceof KeyRotationError) throw e;
      throw new KeyRotationError(`Failed to select key: ${e}`, 'NO_KEYS');
    }

    try {
      const result = await operation(routing.key, routing.decryptedKey, routing.providerConfig!);
      
      // Success
      await incrementKeyUsage(routing.key.id, true);
      return { result, keyUsed: routing.key, attempts };
    } catch (error: any) {
      lastError = error;
      
      const status = error.status || error.statusCode || 500;
      const headers = error.headers || {};
      
      await handleKeyError(routing.key.id, status, headers);
      
      if (!shouldRetryWithNextKey(status) || i === maxRetries - 1) {
        throw error;
      }
      
      // Small delay before retrying with next key (except for auth errors)
      if (!isAuthError(status)) {
        const delay = Math.min(100 * (i + 1), 500);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new KeyRotationError(`All ${attempts} attempts failed for provider ${provider}`, 'ALL_FAILED');
}

// Helper to build proxied request
export function buildProxyHeaders(
  providerConfig: NonNullable<ReturnType<typeof getProvider>>,
  apiKey: string,
  originalHeaders: Record<string, string>,
  customBaseUrl?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Copy relevant headers from original request
  const allowedHeaders = ['accept', 'content-type', 'x-request-id', 'anthropic-version', 'openai-organization'];
  for (const [k, v] of Object.entries(originalHeaders)) {
    if (allowedHeaders.includes(k.toLowerCase()) || k.toLowerCase().startsWith('x-')) {
      if (k.toLowerCase() !== 'authorization' && k.toLowerCase() !== 'x-api-key' && k.toLowerCase() !== 'api-key') {
        headers[k] = v;
      }
    }
  }

  // Add auth based on provider type
  switch (providerConfig.authType) {
    case 'bearer':
      headers['Authorization'] = `${providerConfig.authPrefix || 'Bearer '}${apiKey}`;
      break;
    case 'x-api-key':
      headers[providerConfig.authHeader || 'x-api-key'] = apiKey;
      // Anthropic also needs version header
      if (providerConfig.id === 'anthropic') {
        headers['anthropic-version'] = originalHeaders['anthropic-version'] || '2023-06-01';
      }
      break;
    case 'api-key-header':
      headers[providerConfig.authHeader || 'api-key'] = apiKey;
      break;
    case 'query':
      // Auth will be added to URL query params, not headers
      break;
    default:
      headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

export function buildProxyUrl(
  providerConfig: NonNullable<ReturnType<typeof getProvider>>,
  apiKey: string,
  path: string,
  queryParams: Record<string, string> = {},
  customBaseUrl?: string
): string {
  const baseUrl = customBaseUrl || providerConfig.baseUrl;
  
  // Clean path
  let cleanPath = path;
  if (cleanPath.startsWith('/')) cleanPath = cleanPath.slice(1);
  
  // For OpenAI compatible, ensure path doesn't duplicate v1 if base already has it
  // But let user control it - just join
  const url = `${baseUrl.replace(/\/$/, '')}/${cleanPath}`;
  
  const urlObj = new URL(url);
  
  // Add query params
  for (const [k, v] of Object.entries(queryParams)) {
    urlObj.searchParams.set(k, v);
  }
  
  // Add auth as query param if needed (Google)
  if (providerConfig.authType === 'query') {
    const param = providerConfig.authQueryParam || 'key';
    urlObj.searchParams.set(param, apiKey);
  }
  
  return urlObj.toString();
}
