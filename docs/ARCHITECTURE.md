# Architecture

## Overview

AI Router is a Next.js application designed for Vercel's serverless environment, providing intelligent API key rotation and rate limit handling for multiple AI providers.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Applications                       │
│   (Your apps, OpenAI SDK, Vercel AI SDK, cURL, etc.)            │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Vercel Edge / Serverless                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Next.js App Router                      │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌───────────┐ │  │
│  │  │  Dashboard UI   │  │  Proxy Routes   │  │  Auth     │ │  │
│  │  │  (React)        │  │  /api/proxy/*   │  │  /api/auth│ │  │
│  │  │  - Keys mgmt    │  │  /api/v1/*      │  │           │ │  │
│  │  │  - Logs         │  │                 │  │           │ │  │
│  │  │  - Stats        │  │                 │  │           │ │  │
│  │  └────────┬────────┘  └────────┬────────┘  └─────┬─────┘ │  │
│  │           │                    │                 │       │  │
│  │           └────────────────────┼─────────────────┘       │  │
│  │                                ▼                         │  │
│  │  ┌────────────────────────────────────────────────────┐ │  │
│  │  │              Core Logic (lib/)                      │ │  │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌──────────────┐ │ │  │
│  │  │  │ router.ts   │ │ storage.ts  │ │ providers.ts │ │ │  │
│  │  │  │ - Rotation  │ │ - KV/Redis  │ │ - 12+ prov.  │ │ │  │
│  │  │  │ - Failover  │ │ - File      │ │ - Config     │ │ │  │
│  │  │  │ - Backoff   │ │ - Memory    │ │              │ │ │  │
│  │  │  └──────┬──────┘ └──────┬──────┘ └──────┬───────┘ │ │  │
│  │  │         │               │               │         │ │  │
│  │  │         └───────────────┼───────────────┘         │ │  │
│  │  │                         ▼                         │ │  │
│  │  │  ┌────────────────────────────────────────────┐  │ │  │
│  │  │  │  Encryption (AES-256-GCM)                  │  │ │  │
│  │  │  │  - Encrypt at rest                         │  │ │  │
│  │  │  │  - Mask in API responses                   │  │ │  │
│  │  │  └────────────────────────────────────────────┘  │ │  │
│  │  └────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           │                                     │
│                           ▼                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   Storage Layer                           │  │
│  │  Priority: Upstash Redis > Vercel KV > File > Memory      │  │
│  │  ┌─────────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐  │  │
│  │  │ Upstash     │ │ Vercel   │ │ File    │ │ Memory   │  │  │
│  │  │ Redis       │ │ KV       │ │ storage │ │ Cache    │  │  │
│  │  │ (Prod)      │ │ (Legacy) │ │ (Dev)   │ │ (2s TTL) │  │  │
│  │  └─────────────┘ └──────────┘ └─────────┘ └──────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS with rotated keys
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AI Providers                                │
│  OpenAI, Anthropic, Google, Groq, Mistral, Together, etc.       │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Router (`lib/router.ts`)

**Key Rotation**:

- **Healthy Key Selection**: `getHealthyKeys(provider)` filters out:
  - Inactive keys (`isActive=false`)
  - Invalid keys (`isValid=false` from 401/403)
  - Rate-limited keys (`rateLimitedUntil` in future, auto-clears when expired)

- **Sorting Strategy**: Prefers:
  1. Least failure count
  2. Least usage count
  3. Oldest last-used (LRU)

- **Round-Robin**: `roundRobinIndex` per provider, in-memory, ensures fair distribution even with sorting

- **Failover Loop**: Up to 5 attempts per request:
  ```ts
  for attempt in 0..5:
    select next healthy key not yet tried
    try request
    if 429: mark rate-limited, try next
    if 401/403: mark invalid, try next
    if 5xx: try next
    if success: return
  ```

**Rate Limit Handling**:

- Parses `Retry-After` header (seconds or HTTP date)
- Checks `X-RateLimit-Remaining` == 0
- Default 60s backoff, capped 300s
- Per-key `rateLimitedUntil` timestamp
- Auto-clears when expired on next selection

**Header/URL Building**:

- `buildProxyHeaders()`: Injects auth based on provider type:
  - `bearer`: `Authorization: Bearer <key>`
  - `x-api-key`: `x-api-key: <key>` + `anthropic-version`
  - `query`: Adds `?key=<key>` to URL (Google)
- `buildProxyUrl()`: Joins baseUrl + path + query params

### 2. Storage (`lib/storage.ts`)

**Abstraction**: Tries in order:

1. **Upstash Redis** (if `UPSTASH_REDIS_REST_URL` + `TOKEN` set)
   - `client.get('ai-router:storage')` / `set`
   - Stores entire `StorageData` as JSON string
   - Persistent across Vercel deployments
   - Recommended

2. **Vercel KV** (if `KV_REST_API_URL` + `TOKEN` set)
   - Legacy, deprecated but still works
   - Same API

3. **File System** (`./data/storage.json` or `STORAGE_PATH`)
   - `fs.readFile` / `writeFile`
   - Creates dir if needed
   - Works locally, ephemeral on Vercel (`/tmp` writable but cleared)
   - Fallback for dev

4. **Memory Cache** (always)
   - In-memory `memoryCache` singleton
   - 2s TTL for file reads
   - Immediate updates on write
   - Fast path, survives within same serverless instance

**Data Structure**:

```ts
StorageData {
  keys: ApiKey[] // encrypted at rest
  logs: RequestLog[] // last 500
  stats: Stats // counters + per-provider
}

ApiKey {
  id, name, provider, key (encrypted), isActive, isValid,
  usageCount, successCount, failureCount,
  lastUsed, rateLimitedUntil, createdAt, updatedAt,
  customBaseUrl?, notes?
}
```

**Encryption**: All keys encrypted via `lib/encryption.ts` (AES-256-GCM) before storage, decrypted on use.

### 3. Providers (`lib/providers.ts`)

**Config**:

```ts
ProviderConfig {
  id, name, baseUrl, authType, authHeader?, authQueryParam?, authPrefix?,
  isOpenAICompatible, defaultModels[], color, description, docsUrl
}
```

**Supported**: 12 providers + custom. Each defines:
- Base URL
- Auth type (bearer, x-api-key, query)
- OpenAI compatibility
- Default models for discovery

**Model Inference**: `getProviderFromModel()` heuristically maps model names to providers (e.g., `claude` → anthropic, `gemini` → google, `grok` → xai).

### 4. Encryption (`lib/encryption.ts`)

- Algorithm: `aes-256-gcm`
- Key: SHA-256 hash of `ENCRYPTION_KEY` env (or `ADMIN_PASSWORD` or dev default) → 32 bytes
- Format: `iv:authTag:ciphertext` (hex)
- Fallback: `plain:base64` if encryption fails (dev)
- Decrypt handles both encrypted and plain (backwards compat)
- `maskKey()`: Shows `sk-proj...XXXX` for UI

### 5. Auth (`lib/auth.ts`)

- Password: `ADMIN_PASSWORD` env, default `admin`
- Hash: SHA-256, timing-safe compare
- Session: Random 32-byte token + expiry (24h) → JSON → base64 + HMAC-SHA256 signature
- Cookie: `ai-router-admin`, httpOnly, secure in prod, 24h maxAge
- `isAuthenticated()`: Verifies cookie signature and expiry
- `requireAuth()`: Used in management API routes, returns 401 if not auth, unless `DISABLE_AUTH=true`

## API Routes

### Proxy Routes

**`/api/proxy/[provider]/[...path]`**:

- Handles all methods (GET, POST, PUT, PATCH, DELETE)
- `maxDuration=60` for long AI responses
- Reads body, query, headers
- Loops with rotation (max 5 attempts)
- Handles streaming: If `body.stream=true` and response ok and body exists, returns `new Response(proxyRes.body)` with headers, no buffering
- Otherwise buffers, parses JSON, checks if should retry, logs, returns
- Adds `X-Key-Used`, `X-Provider`, `X-Retry-Count` headers

**`/api/v1/chat/completions`**:

- OpenAI-compatible, `maxDuration=60`
- Infers provider from `X-AI-Provider` header, `provider` query, `body.provider`, or model name
- If model contains `/` and OpenRouter keys exist, prefers OpenRouter
- Same rotation logic as proxy, but path hardcoded to `chat/completions`
- Handles streaming similarly

**`/api/v1/messages`**:

- Anthropic-compatible, same pattern, provider hardcoded `anthropic`, path `v1/messages`

**`/api/v1/embeddings`**, **`/api/v1/completions`**:

- Similar, for embeddings and legacy completions

**`/api/v1/models`**:

- If `provider` query set, tries to proxy to provider's `/models` endpoint using first healthy key, falls back to config `defaultModels`
- If no provider, aggregates all providers that have keys (or openai) and returns combined list

### Management Routes

**`/api/providers`**: Lists providers + stats (key counts, usage) - public? No, but currently no auth check (could add, but okay for dashboard)

**`/api/keys`**: GET (list masked, filter by provider), POST (add, encrypts)

**`/api/keys/[id]`**: GET, PATCH (update, clear rate limit, reset stats), DELETE, POST?action=test (tests key validity by calling provider's models endpoint)

**`/api/stats`**: GET (stats + overview), DELETE (clear logs)

**`/api/logs`**: GET with limit and provider filter

**`/api/health`**: Public, returns status, storage type, counts, endpoints

**`/api/auth`**: POST login, GET check, DELETE logout

## Frontend (`app/page.tsx`)

Single-page dashboard, client component (`"use client"`):

- **Auth**: Checks `/api/auth` on mount, shows login if not auth
- **Data Loading**: Fetches providers, keys, logs, stats in parallel
- **State**: `selectedProvider` filter, `activeTab` (overview/keys/logs/docs), search, add-key modal
- **Tabs**:
  - Overview: Stats grid, provider health, recent logs
  - Keys: List with rate limit badges, test/toggle/delete actions, search
  - Logs: Table with status, latency, retries
  - Docs: API examples, deployment guide
- **Styling**: Tailwind v4, custom design, no external UI lib, responsive, dark mode via system? Actually light only, uses `#fafafa` bg, white cards, black accents

## Deployment

**Vercel**:

- Framework: Next.js, auto-detected
- Build: `npm run build` → `.next`
- Functions: Each `route.ts` becomes serverless function, `maxDuration` set to 60s in `vercel.json` for AI routes (needs Pro plan for >10s? Actually hobby allows 60s for some? Vercel free allows 10s default, 60s requires Pro, but we set anyway, will work with warning on free)
- Regions: `iad1` (US East) default, can change
- Env: Set via dashboard, pulled into functions
- Storage: Upstash Redis integration auto-injects env vars
- GitHub: Vercel creates webhook, auto-deploys on push, preview deploys for PRs

**Why Next.js for Vercel**:

- Zero-config deploy
- API routes as serverless functions
- App Router for dashboard
- Edge-ready but we use Node runtime for crypto, fs
- `next.config.ts` headers for CORS

## Security Considerations

- **Encryption at rest**: AES-256-GCM, key from env, not hardcoded
- **Masking**: Never return full keys in API, only `maskedKey`
- **Auth**: HMAC-signed sessions, httpOnly cookies, timing-safe password compare
- **No key in logs**: Logs store keyId and keyName, not key value
- **CORS**: Open (`*`) for proxy endpoints to allow any client app - could restrict in production via `next.config.ts`
- **Rate limiting**: Per-key backoff prevents hammering provider, but no global rate limit on router itself (could add Upstash rate limit)

## Performance

- **Memory cache**: 2s TTL avoids file reads on every request
- **Round-robin index**: In-memory, O(1)
- **Logs capped**: 500 max, prevents bloat
- **Streaming**: No buffering for stream=true, pipes directly
- **Turbopack**: Fast builds

## Limitations & Future Improvements

- **File storage ephemeral**: On Vercel without Redis, keys lost on redeploy. Solved by adding Redis.
- **In-memory round-robin**: Resets on cold start, but okay due to sorting by usage
- **No distributed rate limit**: Each serverless instance has own memory cache, rateLimitedUntil stored in Redis/file so shared, but roundRobinIndex not shared - okay, eventual consistency
- **No global rate limit**: Could add Upstash Ratelimit for router itself
- **No key versioning**: Simple CRUD, no history
- **No team auth**: Single admin password, could add multi-user
- **No usage quotas**: Could add per-key or per-provider quotas
- **Turbopack warning**: Dynamic fs access traces whole project - could suppress with `/*turbopackIgnore: true*/` or move storage to only use Redis in prod

## Testing

- **Build**: `npm run build` must pass (TypeScript check)
- **Health**: `GET /api/health` should return ok
- **Add key**: Via dashboard or `POST /api/keys`
- **Proxy**: `curl /api/proxy/openai/models` should use key and return provider response
- **Rotation**: Add 2 keys, make requests, check logs show alternating keys
- **Rate limit**: Simulate 429, check key marked rate-limited, next key used

## File Structure

```
.
├── app/
│   ├── page.tsx (dashboard)
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── auth/route.ts
│       ├── health/route.ts
│       ├── keys/route.ts & [id]/route.ts
│       ├── providers/route.ts
│       ├── stats/route.ts
│       ├── logs/route.ts
│       ├── proxy/[provider]/[...path]/route.ts
│       └── v1/
│           ├── chat/completions/route.ts
│           ├── messages/route.ts
│           ├── models/route.ts
│           ├── embeddings/route.ts
│           └── completions/route.ts
├── lib/
│   ├── types.ts
│   ├── providers.ts
│   ├── encryption.ts
│   ├── storage.ts
│   ├── router.ts
│   └── auth.ts
├── docs/
│   ├── DEPLOYMENT.md
│   ├── API.md
│   └── ARCHITECTURE.md
├── data/ (gitignored, stores storage.json locally)
├── public/
├── next.config.ts
├── vercel.json
├── package.json
├── .env.example
└── README.md
```
