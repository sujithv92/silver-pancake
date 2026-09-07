import { ApiKey, RequestLog, Stats, StorageData } from './types';
import { encrypt, decrypt } from './encryption';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

// In-memory cache for fast access
let memoryCache: StorageData | null = null;
let lastFileRead = 0;
const FILE_CACHE_TTL = 2000; // 2 seconds

function getStoragePath(): string {
  return process.env.STORAGE_PATH || path.join(process.cwd(), 'data', 'storage.json');
}

function getDefaultStats(): Stats {
  return {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rateLimitedRequests: 0,
    lastReset: new Date().toISOString(),
    providerStats: {},
  };
}

function getDefaultData(): StorageData {
  return {
    keys: [],
    logs: [],
    stats: getDefaultStats(),
  };
}

async function tryGetKvClient(): Promise<any> {
  // Try Upstash Redis first (recommended)
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const { Redis } = await import('@upstash/redis');
      return { type: 'upstash', client: new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })};
    } catch {}
  }
  
  // Try Vercel KV (deprecated but still works)
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import('@vercel/kv');
      return { type: 'vercel-kv', client: kv };
    } catch {}
  }
  
  return null;
}

async function readFromFile(): Promise<StorageData> {
  try {
    const filePath = getStoragePath();
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as StorageData;
    
    // Ensure defaults
    if (!data.keys) data.keys = [];
    if (!data.logs) data.logs = [];
    if (!data.stats) data.stats = getDefaultStats();
    if (!data.stats.providerStats) data.stats.providerStats = {};
    
    return data;
  } catch (e) {
    // File doesn't exist or invalid, return default
    return getDefaultData();
  }
}

async function writeToFile(data: StorageData): Promise<void> {
  try {
    const filePath = getStoragePath();
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to write to file:', e);
    // Don't throw, just log - memory cache will still work
  }
}

export async function getStorageData(): Promise<StorageData> {
  // Check memory cache first for performance
  const now = Date.now();
  if (memoryCache && (now - lastFileRead) < FILE_CACHE_TTL) {
    return memoryCache;
  }

  // Try KV/Redis first
  const kv = await tryGetKvClient();
  if (kv) {
    try {
      if (kv.type === 'upstash') {
        const data = await kv.client.get('ai-router:storage');
        if (data) {
          // Upstash may return parsed object or string
          const parsed = typeof data === 'string' ? JSON.parse(data as string) : data as StorageData;
          memoryCache = parsed;
          lastFileRead = now;
          return parsed;
        }
      } else if (kv.type === 'vercel-kv') {
        const data = await kv.client.get('ai-router:storage');
        if (data) {
          memoryCache = data as StorageData;
          lastFileRead = now;
          return data as StorageData;
        }
      }
    } catch (e) {
      console.warn('KV read failed, falling back to file:', e);
    }
  }

  // Fall back to file
  const fileData = await readFromFile();
  memoryCache = fileData;
  lastFileRead = now;
  return fileData;
}

export async function saveStorageData(data: StorageData): Promise<void> {
  // Update memory cache immediately
  memoryCache = data;
  lastFileRead = Date.now();

  // Try KV first
  const kv = await tryGetKvClient();
  if (kv) {
    try {
      if (kv.type === 'upstash') {
        await kv.client.set('ai-router:storage', JSON.stringify(data));
        return;
      } else if (kv.type === 'vercel-kv') {
        await kv.client.set('ai-router:storage', data);
        return;
      }
    } catch (e) {
      console.warn('KV write failed, falling back to file:', e);
    }
  }

  // Fall back to file
  await writeToFile(data);
}

// Keys CRUD
export async function getKeys(): Promise<ApiKey[]> {
  const data = await getStorageData();
  return data.keys;
}

export async function getKeysByProvider(provider: string): Promise<ApiKey[]> {
  const keys = await getKeys();
  return keys.filter(k => k.provider === provider && k.isActive && k.isValid);
}

export async function getAllActiveKeys(): Promise<ApiKey[]> {
  const keys = await getKeys();
  return keys.filter(k => k.isActive);
}

export async function getKeyById(id: string): Promise<ApiKey | null> {
  const keys = await getKeys();
  return keys.find(k => k.id === id) || null;
}

export async function addKey(input: Omit<ApiKey, 'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'successCount' | 'failureCount' | 'isValid' | 'lastUsed' | 'rateLimitedUntil'> & Partial<Pick<ApiKey, 'isValid'>>): Promise<ApiKey> {
  const data = await getStorageData();
  
  const newKey: ApiKey = {
    id: uuidv4(),
    name: input.name,
    provider: input.provider,
    key: encrypt(input.key),
    isActive: input.isActive ?? true,
    isValid: input.isValid ?? true,
    usageCount: 0,
    successCount: 0,
    failureCount: 0,
    lastUsed: null,
    rateLimitedUntil: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    customBaseUrl: input.customBaseUrl,
    notes: input.notes,
  };

  data.keys.push(newKey);
  await saveStorageData(data);
  
  // Return with masked key for security
  return { ...newKey, key: decrypt(newKey.key) };
}

export async function updateKey(id: string, updates: Partial<Omit<ApiKey, 'id' | 'createdAt'>>): Promise<ApiKey | null> {
  const data = await getStorageData();
  const idx = data.keys.findIndex(k => k.id === id);
  if (idx === -1) return null;

  const existing = data.keys[idx];
  
  // If key is being updated, encrypt it
  let encryptedKey = existing.key;
  if (updates.key && updates.key !== existing.key) {
    // Check if it's already encrypted or plain
    if (updates.key.startsWith('sk-') || updates.key.length > 10 && !updates.key.includes(':')) {
      encryptedKey = encrypt(updates.key);
    } else {
      encryptedKey = updates.key; // Assume already encrypted or masked, keep existing
      if (updates.key.includes('...') || updates.key.includes('****')) {
        encryptedKey = existing.key; // Don't overwrite with masked version
      }
    }
  }

  data.keys[idx] = {
    ...existing,
    ...updates,
    key: encryptedKey,
    updatedAt: new Date().toISOString(),
  };

  await saveStorageData(data);
  return { ...data.keys[idx], key: decrypt(data.keys[idx].key) };
}

export async function deleteKey(id: string): Promise<boolean> {
  const data = await getStorageData();
  const initialLength = data.keys.length;
  data.keys = data.keys.filter(k => k.id !== id);
  if (data.keys.length === initialLength) return false;
  await saveStorageData(data);
  return true;
}

export async function incrementKeyUsage(id: string, success: boolean, isRateLimited = false): Promise<void> {
  const data = await getStorageData();
  const key = data.keys.find(k => k.id === id);
  if (!key) return;

  key.usageCount += 1;
  key.lastUsed = new Date().toISOString();
  if (success) {
    key.successCount += 1;
    key.failureCount = Math.max(0, key.failureCount - 1); // Decay failure count on success
  } else {
    if (!isRateLimited) {
      key.failureCount += 1;
    }
  }
  key.updatedAt = new Date().toISOString();

  // Auto-disable after too many failures? No, just mark invalid after threshold
  if (key.failureCount > 10) {
    key.isValid = false;
  }

  await saveStorageData(data);
  // Update memory cache reference
  if (memoryCache) {
    const memKey = memoryCache.keys.find(k => k.id === id);
    if (memKey) {
      Object.assign(memKey, key);
    }
  }
}

export async function setKeyRateLimited(id: string, retryAfterSeconds: number): Promise<void> {
  const data = await getStorageData();
  const key = data.keys.find(k => k.id === id);
  if (!key) return;

  const until = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
  key.rateLimitedUntil = until;
  key.updatedAt = new Date().toISOString();

  await saveStorageData(data);
}

export async function clearRateLimitIfExpired(key: ApiKey): Promise<boolean> {
  if (!key.rateLimitedUntil) return false;
  const until = new Date(key.rateLimitedUntil).getTime();
  if (Date.now() > until) {
    await updateKey(key.id, { rateLimitedUntil: null });
    return true;
  }
  return false;
}

// Logs
export async function getLogs(limit = 100): Promise<RequestLog[]> {
  const data = await getStorageData();
  return data.logs.slice(-limit).reverse();
}

export async function addLog(log: Omit<RequestLog, 'id' | 'timestamp'>): Promise<void> {
  const data = await getStorageData();
  
  const newLog: RequestLog = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    ...log,
  };

  data.logs.push(newLog);
  
  // Keep only last 500 logs to prevent bloat
  if (data.logs.length > 500) {
    data.logs = data.logs.slice(-500);
  }

  // Update stats
  data.stats.totalRequests += 1;
  if (log.success) {
    data.stats.successfulRequests += 1;
  } else {
    data.stats.failedRequests += 1;
  }

  if (!data.stats.providerStats[log.provider]) {
    data.stats.providerStats[log.provider] = { total: 0, success: 0, failed: 0, rateLimited: 0 };
  }
  data.stats.providerStats[log.provider].total += 1;
  data.stats.providerStats[log.provider].lastRequest = newLog.timestamp;
  if (log.success) {
    data.stats.providerStats[log.provider].success += 1;
  } else {
    data.stats.providerStats[log.provider].failed += 1;
    if (log.status === 429) {
      data.stats.rateLimitedRequests += 1;
      data.stats.providerStats[log.provider].rateLimited += 1;
    }
  }

  await saveStorageData(data);
}

export async function getStats(): Promise<Stats> {
  const data = await getStorageData();
  return data.stats;
}

export async function clearLogs(): Promise<void> {
  const data = await getStorageData();
  data.logs = [];
  data.stats = getDefaultStats();
  await saveStorageData(data);
}

export async function getDecryptedKey(key: ApiKey): Promise<string> {
  try {
    return decrypt(key.key);
  } catch {
    return key.key;
  }
}

// For API responses, mask keys
export async function getKeysMasked(): Promise<Array<Omit<ApiKey, 'key'> & { maskedKey: string; hasKey: boolean }>> {
  const keys = await getKeys();
  return Promise.all(keys.map(async k => {
    let plain = '';
    try {
      plain = await getDecryptedKey(k);
    } catch {
      plain = '';
    }
    const masked = plain ? `${plain.slice(0, 7)}...${plain.slice(-4)}` : '****';
    const { key: _, ...rest } = k;
    return {
      ...rest,
      maskedKey: masked,
      hasKey: !!plain,
    };
  }));
}
