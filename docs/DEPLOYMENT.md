# Deployment Guide

This guide covers deploying AI Router to Vercel with GitHub integration for seamless CI/CD.

## Quick Deploy (Recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/sujithv92/silver-pancake&env=ADMIN_PASSWORD,ENCRYPTION_KEY&envDescription=Admin%20password%20and%20encryption%20key%20for%20API%20keys&envLink=https://github.com/sujithv92/silver-pancake%23environment-variables)

### Steps:

1. **Click Deploy Button Above** or manually:
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repository `sujithv92/silver-pancake`
   - Vercel auto-detects Next.js

2. **Configure Environment Variables**:

   | Variable | Required | Description | Example |
   |----------|----------|-------------|---------|
   | `ADMIN_PASSWORD` | No | Dashboard login | `MyS3cureP@ss!` |
   | `ENCRYPTION_KEY` | Yes (prod) | AES-256 encryption key | `openssl rand -hex 32` output |

   Generate encryption key:
   ```bash
   openssl rand -hex 32
   # or
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **Add Persistent Storage (Highly Recommended)**:

   Without persistent storage, keys are stored in memory/file system which is ephemeral on Vercel (lost on redeploy).

   **Option A: Upstash Redis (Recommended)**
   - In Vercel dashboard: Go to your project → Storage → Create Database → Upstash Redis
   - Or: Vercel Marketplace → Search "Upstash Redis" → Add Integration
   - Select your project, it auto-injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
   - No code changes needed!

   **Option B: Vercel KV (Legacy)**
   - Storage → Create → KV (deprecated but works)
   - Auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`

   **Without Redis/KV**: App still works but uses ephemeral file storage. Keys will be lost on redeploy. Okay for testing.

4. **Deploy**:
   - Click Deploy
   - Wait 1-2 minutes for build
   - Visit your deployment URL

5. **Add API Keys**:
   - Go to `https://your-deployment.vercel.app`
   - Login with `ADMIN_PASSWORD` (default: `admin`)
   - Add keys for providers you want to use
   - Test with `/api/health` endpoint

## GitHub Integration (Auto Deploy)

Vercel's GitHub integration gives you:

- **Auto deploys** on push to `main`
- **Preview deployments** for PRs
- **Instant rollbacks**
- **Deployment protection**

Setup:

1. Push repo to GitHub:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/ai-router.git
   git push -u origin main
   ```

2. In Vercel, import from GitHub (if not already)
3. Enable GitHub integration - it auto-creates webhook
4. Every push to `main` now auto-deploys
5. PRs get preview URLs

## Environment Variables Reference

### Core

- `ADMIN_PASSWORD`: Dashboard auth. If not set, defaults to `admin`. **Change in production!**
- `ENCRYPTION_KEY`: Secret for encrypting API keys at rest using AES-256-GCM. Uses SHA-256 hash to 32 bytes. If not set, uses `ADMIN_PASSWORD` or dev default (insecure).

### Storage

- `UPSTASH_REDIS_REST_URL`: Upstash Redis REST URL
- `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis token
- `KV_REST_API_URL`: Vercel KV URL (legacy)
- `KV_REST_API_TOKEN`: Vercel KV token
- `STORAGE_PATH`: File path for JSON storage (default: `./data/storage.json`). On Vercel, `/tmp` is writable but ephemeral.

### Optional

- `DISABLE_AUTH`: Set `true` to disable dashboard auth (dev only, never production!)

## Custom Domain

1. In Vercel dashboard → Settings → Domains
2. Add your domain
3. Configure DNS as instructed
4. Vercel auto-provisions SSL

Then update your apps to use custom domain:

```python
client = OpenAI(
  base_url="https://ai.yourdomain.com/api/v1",
  api_key="not-needed"
)
```

## Monitoring

- **Vercel Logs**: Dashboard → Logs → Real-time function logs
- **Health Check**: `GET https://your-domain/api/health`
- **Dashboard Stats**: Login → Overview shows requests, success rate, rate limits

## Troubleshooting

### Build Fails

- Ensure Node >=18 (set in package.json engines)
- Check Vercel build logs
- Try `npm run build` locally first

### Keys Lost After Deploy

- You didn't add Redis/KV. File storage is ephemeral on Vercel.
- Add Upstash Redis integration to persist keys.

### 401 Unauthorized on Dashboard

- Check `ADMIN_PASSWORD` env var in Vercel → Settings → Environment Variables
- Default is `admin` if not set
- Clear cookies and login again

### Proxy Returns 503 No Keys

- No active keys for provider. Add keys via dashboard.
- Check provider ID is correct (see `/api/providers`)

### Rate Limited All Keys

- All keys for provider hit rate limit. Wait for `Retry-After` or add more keys.
- Check logs in dashboard for 429s.

## Local Development with Vercel Env

Pull Vercel env vars locally:

```bash
npm i -g vercel
vercel link
vercel env pull .env.local
npm run dev
```

## Self-Hosting (Alternative)

Not Vercel? You can deploy anywhere Node.js runs:

```bash
npm run build
npm start
# Requires NODE_ENV=production, set env vars
```

Docker example:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

## Security Checklist for Production

- [ ] Set strong `ADMIN_PASSWORD` (12+ chars)
- [ ] Set random `ENCRYPTION_KEY` (32+ hex chars)
- [ ] Add Upstash Redis for persistence
- [ ] Enable Vercel Authentication (optional, extra layer)
- [ ] Set custom domain with SSL
- [ ] Review dashboard logs regularly
- [ ] Rotate API keys periodically
- [ ] Don't commit `.env.local` to Git

## Cost

- **Vercel**: Free tier includes 100GB bandwidth, 100k function invocations/month - enough for personal/small team use
- **Upstash Redis**: Free tier 10k commands/day, enough for key storage. Pay-as-you-go after.
- **Your AI API costs**: You pay providers directly (OpenAI, etc.) - router doesn't add fees
