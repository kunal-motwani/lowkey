# Deploying Flattr to Vercel

1. `npx vercel login`
2. From the repo root: `npx vercel link` (create a new project).
3. Set environment variables (Production, and Preview if wanted):
   - `YOUCAM_API_KEY` - shared YouCam / Perfect Corp key (omit for a cached-only demo). Optional per-API overrides: `YOUCAM_KEY_SKIN`, `YOUCAM_KEY_TONE`, `YOUCAM_KEY_CLOTHES`, `YOUCAM_KEY_MAKEUP`
   - `YOUCAM_API_BASE` - optional, defaults to `https://yce-api-01.makeupar.com`
   - `DEMO_MODE` - `1` to serve only from the committed cache
   - `ANTHROPIC_API_KEY` - optional, enables an LLM-written verdict
   - `FLATTR_CACHE_DIR` - optional cache location (see [docs/CACHE.md](docs/CACHE.md))

   ```
   npx vercel env add YOUCAM_API_KEY production
   npx vercel env add DEMO_MODE production      # value: 1
   ```
4. Deploy: `npx vercel --prod`

## Filesystem caveat
Vercel functions have a read-only filesystem except `/tmp`. A committed cache directory is readable at runtime but writes fail; `lib/youcam.ts` catches write errors, so a live run works but nothing persists. Populate the cache locally and commit it (see [docs/CACHE.md](docs/CACHE.md)). The cache and `public/samples/` are read via `process.cwd()`, so confirm they are included in the serverless bundle (for example with `outputFileTracingIncludes` in `next.config.ts`) and test a cold run.

## Public deployments
`DEMO_MODE=1` only blocks live calls when **no** YouCam key is set. For a strictly cached public demo, leave all YouCam keys unset on that project to protect your API units. There is no built-in auth or rate limiting; add it before exposing a live-key deployment.

## Function duration and size
`app/api/analyze/route.ts` exports `maxDuration = 300`. Try-on polling can take 60-120 s; lower it to your plan's limit if needed. Request bodies are capped at about 4.5 MB on Vercel, so downscale selfies client-side. `sharp` must remain in `dependencies`.

## Privacy
Images are sent to YouCam for processing; see the README privacy section. Make sure your deployment's users are told this.

See `docs/NOTES.md` for further known issues.
