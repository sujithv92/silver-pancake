# AI Router ◈

**Intelligent AI API router with multi-key rotation, automatic rate limit handling, and unified dashboard.**

Deploy seamlessly to Vercel with GitHub integration. Add unlimited API keys for 12+ providers, and the router cycles through them, handling 429s and failover automatically.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/sujithv92/silver-pancake&env=ADMIN_PASSWORD,ENCRYPTION_KEY&envDescription=Admin%20password%20and%20encryption%20key%20for%20API%20keys&envLink=https://github.com/sujithv92/silver-pancake%23environment-variables)
![Next.js 16](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)
![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=flat-square&logo=vercel)
![License MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)
![Providers](https://img.shields.io/badge/Providers-12%2B-6B7280?style=flat-square)

---

## ✨ Features

- **🔑 Multi-Key Management** — Add unlimited API keys per provider (OpenAI, Anthropic, Groq, etc.)
- **🔄 Smart Rotation** — Round-robin with least-used preference, fair distribution, LRU
- **⚡ Rate Limit Handling** — Detects `429`, parses `Retry-After`, backs off per-key (60s default, 5m max)
- **🌊 Streaming** — Full SSE streaming support for chat completions
- **🛡️ Failover** — Marks invalid keys (401/403), skips rate-limited, retries with next key (5 attempts)
- **🔒 Encrypted** — AES-256-GCM encryption at rest, masked in API responses
- **📊 Dashboard** — Beautiful UI with stats, logs, health, provider management
- **🚀 Vercel Ready** — One-click deploy, GitHub auto-deploys, Upstash Redis persistence
- **🌐 12+ Providers** — OpenAI, Anthropic, Google, Groq, Mistral, Together, OpenRouter, DeepSeek, xAI, Cohere, Perplexity + Custom

## 🚀 Quick Deploy to Vercel

1. **Push to GitHub** (or click Deploy button above)
2. **Import to Vercel**: [vercel.com/new](https://vercel.com/new) → Import `silver-pancake`
3. **Set Env Vars**:
   - `ADMIN_PASSWORD` — Dashboard login (default: `admin`)
   - `ENCRYPTION_KEY` — Generate: `openssl rand -hex 32`
4. **Add Redis (Recommended)**: Vercel Dashboard → Storage → Create → Upstash Redis → Connect to project (auto-injects env vars)
5. **Deploy** → Visit URL → Login → Add API keys → Use proxy endpoints!

> **Without Redis**: App uses ephemeral file storage — keys lost on redeploy. Okay for testing, but add Redis for production.

Detailed steps: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## 🏃 Local Development

```bash
npm install
cp .env.example .env.local
# Edit .env.local with your secrets
npm run dev
```

Open http://localhost:3000 — default password `admin`.

## 📡 API Usage

### OpenAI Compatible (Recommended)

```bash
curl https://your-router.vercel.app/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello!"}]}'

# Force provider via header
curl https://your-router.vercel.app/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-AI-Provider: groq" \
  -d '{"model":"llama-3.3-70b-versatile","messages":[{"role":"user","content":"Hello"}]}'
```

**Python**:

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-router.vercel.app/api/v1",
    api_key="not-needed"  # Router uses its own stored keys
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={"X-AI-Provider": "openai"}  # Optional, auto-detected
)
print(response.choices[0].message.content)
```

### Universal Proxy

```bash
# Any provider, any path
POST /api/proxy/{provider}/{path}

# Examples
POST /api/proxy/openai/chat/completions
POST /api/proxy/anthropic/v1/messages
POST /api/proxy/groq/chat/completions
POST /api/proxy/google/v1beta/models/gemini-1.5-flash:generateContent
```

Full reference: [docs/API.md](docs/API.md)

## 🔧 How It Works

### Rotation Strategy

1. **Filter Healthy**: Exclude inactive, invalid (401/403), and rate-limited (until expiry) keys
2. **Sort Smart**: Least failures → least usage → oldest last-used
3. **Round-Robin**: Fair distribution among healthy keys
4. **Failover**: On 429/401/500, try next key (up to 5 attempts)
5. **Backoff**: Mark rate-limited key with `rateLimitedUntil`, skip until expired

### Rate Limit Handling

- Detects `429 Too Many Requests`
- Parses `Retry-After` (seconds or HTTP date)
- Checks `X-RateLimit-Remaining`
- Default 60s backoff, capped at 5 minutes
- Logs rate-limited requests

### Storage

| Environment | Storage | Persistence |
|-------------|---------|-------------|
| Vercel + Upstash Redis | Redis | ✅ Persistent |
| Vercel + Vercel KV | KV | ✅ Persistent (legacy) |
| Vercel (no Redis/KV) | File (`/tmp`) | ❌ Ephemeral |
| Local | `./data/storage.json` | ✅ Persistent |

Keys encrypted with AES-256-GCM.

## 📊 Dashboard

- **Overview**: Total requests, active keys, rate limits, provider health, recent requests
- **Keys**: List, search, filter by provider, test validity, clear rate limits, toggle, delete
- **Logs**: Last 500 requests with status, latency, retries, model, key used
- **Docs**: Live API examples, deployment guide, env vars

## 🌐 Supported Providers

| Provider | ID | OpenAI Compat | Auth |
|----------|----|---------------|------|
| OpenAI | `openai` | ✅ | Bearer |
| Anthropic | `anthropic` | ❌ | x-api-key |
| Google AI | `google` | ❌ | Query |
| Groq | `groq` | ✅ | Bearer |
| Mistral | `mistral` | ✅ | Bearer |
| Together AI | `together` | ✅ | Bearer |
| OpenRouter | `openrouter` | ✅ | Bearer |
| DeepSeek | `deepseek` | ✅ | Bearer |
| xAI (Grok) | `xai` | ✅ | Bearer |
| Cohere | `cohere` | ❌ | Bearer |
| Perplexity | `perplexity` | ✅ | Bearer |
| Custom | `custom` | ✅ | Bearer |

Add custom OpenAI-compatible endpoints via `customBaseUrl`.

## 📚 Documentation

- [Deployment Guide](docs/DEPLOYMENT.md) — Vercel, GitHub integration, env vars, troubleshooting
- [API Reference](docs/API.md) — All endpoints, SDK examples, error handling
- [Architecture](docs/ARCHITECTURE.md) — How rotation, storage, encryption work

## 🔐 Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `ADMIN_PASSWORD` | No | Dashboard password | `admin` |
| `ENCRYPTION_KEY` | Yes (prod) | AES-256 encryption key | Dev key (insecure) |
| `UPSTASH_REDIS_REST_URL` | No | Redis URL | File storage |
| `UPSTASH_REDIS_REST_TOKEN` | No | Redis token | — |
| `STORAGE_PATH` | No | File storage path | `./data/storage.json` |
| `DISABLE_AUTH` | No | Disable auth (dev only) | `false` |

Generate encryption key:

```bash
openssl rand -hex 32
```

## 🛡️ Security

- AES-256-GCM encryption at rest
- Masked keys in API (`sk-...XXXX`)
- HMAC-signed sessions, httpOnly cookies
- Timing-safe password compare
- No key leakage in logs

## 🤝 Contributing

PRs welcome! Ideas:

- Per-key quotas
- Team auth
- Global rate limiting
- Usage analytics
- More providers

## 📄 License

MIT — See [LICENSE](LICENSE) (or use as you like).

---

**Built for Vercel** — Deploy with GitHub integration in seconds. Add multiple keys per provider, let router handle rotation and rate limits.

**Endpoints after deploy**:
- Dashboard: `https://your-domain.vercel.app`
- Health: `https://your-domain.vercel.app/api/health`
- OpenAI compat: `https://your-domain.vercel.app/api/v1/chat/completions`
- Proxy: `https://your-domain.vercel.app/api/proxy/{provider}/{path}`
