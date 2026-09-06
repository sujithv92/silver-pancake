export type ProviderId = string;

export interface ApiKey {
  id: string;
  name: string;
  provider: ProviderId;
  key: string; // encrypted at rest, decrypted in memory when needed
  isActive: boolean;
  isValid: boolean;
  usageCount: number;
  successCount: number;
  failureCount: number;
  lastUsed: string | null;
  rateLimitedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  customBaseUrl?: string;
  notes?: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  authType: 'bearer' | 'x-api-key' | 'api-key-header' | 'query' | 'custom';
  authHeader?: string;
  authQueryParam?: string;
  authPrefix?: string; // e.g. "Bearer "
  isOpenAICompatible: boolean;
  defaultModels: string[];
  color: string;
  description: string;
  docsUrl: string;
}

export interface RequestLog {
  id: string;
  timestamp: string;
  provider: ProviderId;
  model?: string;
  keyId: string;
  keyName: string;
  status: number;
  latency: number;
  success: boolean;
  error?: string;
  path: string;
  method: string;
  retryCount?: number;
}

export interface Stats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rateLimitedRequests: number;
  lastReset: string;
  providerStats: Record<string, {
    total: number;
    success: number;
    failed: number;
    rateLimited: number;
    lastRequest?: string;
  }>;
}

export interface StorageData {
  keys: ApiKey[];
  logs: RequestLog[];
  stats: Stats;
}

export interface KeyRotationResult {
  key: ApiKey;
  isRateLimited: boolean;
  retryAfter?: number;
}

export interface ProxyRequest {
  provider: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: any;
  queryParams?: Record<string, string>;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: any;
  keyUsed: ApiKey;
  latency: number;
  retryCount: number;
}
