# API Documentation

Complete reference for AI Router proxy endpoints and management API.

## Base URL

- Local: `http://localhost:3000`
- Vercel: `https://your-deployment.vercel.app`

## Authentication

- **Proxy endpoints**: No auth required (router uses its own stored keys)
- **Management API** (`/api/keys`, `/api/stats`, etc.): Requires dashboard login cookie
  - Login via `POST /api/auth` with `ADMIN_PASSWORD`
  - Or set `DISABLE_AUTH=true` for local dev

## Proxy Endpoints (For Your Apps)

### 1. OpenAI Compatible - Recommended

Unified OpenAI-compatible API that auto-routes to correct provider.

**Endpoint**: `POST /api/v1/chat/completions`

**Headers**:
- `Content-Type: application/json`
- `X-AI-Provider` (optional): Force provider (`openai`, `groq`, `mistral`, `together`, `openrouter`, `deepseek`, `xai`, `perplexity`)
- If not provided, infers from model name

**Body** (OpenAI chat completion format):
```json
{
  "model": "gpt-4o-mini",
  "messages": [{"role": "user", "content": "Hello!"}],
  "temperature": 0.7,
  "stream": false
}
```

**Response**: OpenAI-compatible response

**Examples**:

```bash
curl https://your-router.vercel.app/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Force Groq
curl https://your-router.vercel.app/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-AI-Provider: groq" \
  -d '{
    "model": "llama-3.3-70b-versatile",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

**Supported Providers for this endpoint**:
- `openai`, `groq`, `mistral`, `together`, `openrouter`, `deepseek`, `xai`, `perplexity`, `custom`

---

### 2. Anthropic Compatible

**Endpoint**: `POST /api/v1/messages`

**Body** (Anthropic format):
```json
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 1024,
  "messages": [{"role": "user", "content": "Hello"}]
}
```

**Response**: Anthropic-compatible

```bash
curl https://your-router.vercel.app/api/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

### 3. Embeddings

**Endpoint**: `POST /api/v1/embeddings`

```bash
curl https://your-router.vercel.app/api/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "X-AI-Provider: openai" \
  -d '{
    "model": "text-embedding-3-small",
    "input": "Hello world"
  }'
```

---

### 4. Completions (Legacy)

**Endpoint**: `POST /api/v1/completions`

For legacy completion models.

---

### 5. Models Listing

**Endpoint**: `GET /api/v1/models?provider=openai`

**Query Params**:
- `provider` (optional): Filter by provider

**Response**:
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o",
      "object": "model",
      "created": 1234567890,
      "owned_by": "openai",
      "provider": "openai"
    }
  ]
}
```

---

### 6. Universal Provider Proxy

Proxy any request to any provider with automatic rotation.

**Pattern**: `/api/proxy/{provider}/{path}`

**Providers**:
- `openai`, `anthropic`, `google`, `groq`, `mistral`, `together`, `openrouter`, `deepseek`, `xai`, `cohere`, `perplexity`, `custom`

**Path**: Any path supported by provider's API

**Examples**:

```bash
# OpenAI
POST /api/proxy/openai/chat/completions
GET  /api/proxy/openai/models

# Anthropic
POST /api/proxy/anthropic/v1/messages

# Groq
POST /api/proxy/groq/chat/completions

# Google Gemini
POST /api/proxy/google/v1beta/models/gemini-1.5-flash:generateContent
GET  /api/proxy/google/v1/models

# Mistral
POST /api/proxy/mistral/v1/chat/completions

# Together
POST /api/proxy/together/v1/chat/completions
```

**Headers**: Router forwards relevant headers, injects auth from stored keys.

**Query Params**: All query params forwarded, plus auth if provider uses query auth (Google).

---

## Management API (Dashboard Backend)

Requires authentication.

### Providers

**GET /api/providers**

List all providers with stats.

**Response**:
```json
{
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "color": "#000000",
      "stats": {
        "totalKeys": 2,
        "activeKeys": 2,
        "rateLimitedKeys": 0,
        "totalUsage": 150
      }
    }
  ]
}
```

---

### Keys

**GET /api/keys?provider=openai**

List keys (masked).

**Query**:
- `provider` (optional): Filter by provider

**Response**:
```json
{
  "keys": [
    {
      "id": "uuid",
      "name": "Prod Key 1",
      "provider": "openai",
      "maskedKey": "sk-proj...XXXX",
      "isActive": true,
      "isValid": true,
      "usageCount": 100,
      "successCount": 98,
      "failureCount": 2,
      "lastUsed": "2024-01-01T00:00:00Z",
      "rateLimitedUntil": null,
      "createdAt": "...",
      "hasKey": true
    }
  ]
}
```

**POST /api/keys**

Add new key.

**Body**:
```json
{
  "name": "My OpenAI Key",
  "provider": "openai",
  "key": "sk-...",
  "customBaseUrl": "https://custom.api.com/v1", // for custom provider
  "notes": "Production key",
  "isActive": true
}
```

**Response**: 201 with created key (masked)

---

**GET /api/keys/{id}**

Get single key (masked).

**PATCH /api/keys/{id}**

Update key.

**Body** (all optional):
```json
{
  "name": "New Name",
  "isActive": false,
  "isValid": true,
  "customBaseUrl": "...",
  "notes": "...",
  "key": "sk-new...", // to update key value
  "clearRateLimit": true, // clears rateLimitedUntil
  "resetStats": true // resets usage counts
}
```

**DELETE /api/keys/{id}**

Delete key.

**POST /api/keys/{id}?action=test**

Test if key is valid.

**Response**:
```json
{
  "valid": true,
  "message": "Key is valid"
}
// or
{
  "valid": false,
  "error": "Test failed: 401",
  "details": "...",
  "status": 401
}
```

---

### Stats

**GET /api/stats**

Get usage stats.

**Response**:
```json
{
  "stats": {
    "totalRequests": 1000,
    "successfulRequests": 950,
    "failedRequests": 50,
    "rateLimitedRequests": 20,
    "lastReset": "2024-01-01T00:00:00Z",
    "providerStats": {
      "openai": {
        "total": 500,
        "success": 480,
        "failed": 20,
        "rateLimited": 10,
        "lastRequest": "2024-01-01T00:00:00Z"
      }
    }
  },
  "overview": {
    "totalKeys": 5,
    "activeKeys": 4,
    "validKeys": 4,
    "rateLimitedKeys": 1,
    "providers": 2
  }
}
```

**DELETE /api/stats**

Clear logs and reset stats.

---

### Logs

**GET /api/logs?limit=100&provider=openai**

Get request logs.

**Query**:
- `limit` (default 100, max 500)
- `provider` (optional filter)

**Response**:
```json
{
  "logs": [
    {
      "id": "uuid",
      "timestamp": "2024-01-01T00:00:00Z",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "keyId": "key-uuid",
      "keyName": "Prod Key 1",
      "status": 200,
      "latency": 1234,
      "success": true,
      "path": "chat/completions",
      "method": "POST",
      "retryCount": 0
    }
  ]
}
```

---

### Health

**GET /api/health**

Public, no auth required. Health check and info.

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00Z",
  "version": "1.0.0",
  "storage": "upstash-redis",
  "providers": 12,
  "keys": {
    "total": 5,
    "active": 4,
    "valid": 4
  },
  "stats": {
    "totalRequests": 1000,
    "successRate": "95.0%"
  },
  "endpoints": {
    "proxy": "/api/proxy/{provider}/{path}",
    "openaiCompatible": "/api/v1/chat/completions",
    "anthropicCompatible": "/api/v1/messages",
    "models": "/api/v1/models"
  }
}
```

---

### Auth

**POST /api/auth**

Login.

**Body**:
```json
{
  "password": "your-admin-password"
}
```

**Response**: Sets httpOnly cookie `ai-router-admin`, returns 200.

**GET /api/auth**

Check auth status.

**Response**:
```json
{
  "authenticated": true
}
```

**DELETE /api/auth**

Logout, clears cookie.

---

## SDK Usage

### OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-router.vercel.app/api/v1",
    api_key="dummy"  # Router uses its own keys, but SDK requires something
)

# Auto-detects provider from model
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}]
)

# Force provider via extra_headers
response = client.chat.completions.create(
    model="llama-3.3-70b-versatile",
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={"X-AI-Provider": "groq"}
)

# Streaming
stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True
)
for chunk in stream:
    print(chunk.choices[0].delta.content, end="")
```

### OpenAI Node SDK

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://your-router.vercel.app/api/v1',
  apiKey: 'dummy',
  defaultHeaders: {
    'X-AI-Provider': 'openai'
  }
});

const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

### Vercel AI SDK

```javascript
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const openai = createOpenAI({
  baseURL: 'https://your-router.vercel.app/api/v1',
  apiKey: 'dummy',
  headers: { 'X-AI-Provider': 'groq' }
});

const { text } = await generateText({
  model: openai('llama-3.3-70b-versatile'),
  prompt: 'Hello',
});
```

### Anthropic SDK

```javascript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  baseURL: 'https://your-router.vercel.app/api/proxy/anthropic',
  apiKey: 'dummy', // Router handles real keys
});

const message = await client.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
});
```

### cURL Streaming

```bash
curl https://your-router.vercel.app/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }' --no-buffer
```

---

## Error Handling

### Rate Limited (All Keys)

**Status**: 429

```json
{
  "error": "All keys rate limited for provider openai",
  "retry_after": 60,
  "provider": "openai"
}
```

**Headers**: `Retry-After: 60`

**Action**: Wait `retry_after` seconds, or add more keys.

### No Keys

**Status**: 503

```json
{
  "error": "No active keys for provider openai. Add keys in dashboard.",
  "provider": "openai"
}
```

**Action**: Add keys via dashboard.

### All Keys Invalid

**Status**: 503

```json
{
  "error": "All keys for provider openai are marked invalid (401/403). Please check your keys.",
  "code": "ALL_INVALID"
}
```

**Action**: Check keys validity, reset via dashboard.

### Provider Error

If all retries fail, returns last provider error with original status.

---

## Rate Limit Headers (Returned)

Router adds:

- `X-Key-Used`: Name of key used
- `X-Provider`: Provider used
- `X-Retry-Count`: Number of retries attempted
- `X-Key-Id`: ID of key used

Plus forwards provider's rate limit headers.

---

## CORS

All `/api/*` routes include:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-AI-Provider, X-Provider, x-api-key, anthropic-version, openai-organization
```

For production, you may want to restrict origin in `next.config.ts`.
