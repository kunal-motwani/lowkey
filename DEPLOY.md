# Deploying Flattr to Vercel

1. `npx vercel login`
2. From the repo root: `npx vercel link` (create a new project).
3. Set environment variables (Production, and Preview if wanted):
   - `YOUCAM_API_KEY` - your YouCam / Perfect Corp key (omit for a pure cached demo)
   - `YOUCAM_API_BASE` - optional, defaults to `https://yce-api-01.makeupar.com`
   - `DEMO_MODE` - `1` to serve only from the committed `cache/` directory
   - `ANTHROPIC_API_KEY` - optional, enables Claude-written styling copy

   ```
   npx vercel env add YOUCAM_API_KEY production
   npx vercel env add DEMO_MODE production      # value: 1
   ```
4. Deploy: `npx vercel --prod`

## Filesystem caveat
Vercel functions have a read-only filesystem except `/tmp`. The committed `cache/` directory is readable at runtime, but writes to it fail. `lib/youcam.ts` wraps cache writes in try/catch, so a live run still works but nothing persists between invocations. Populate `cache/` locally (see `docs/CACHE.md`) and commit it.

## Recommended public demo setup
Set `DEMO_MODE=1` and commit `cache/` with real results for the sample selfie and garments. In `lib/youcam.ts`, DEMO_MODE only blocks live calls when `YOUCAM_API_KEY` is also unset, so for a strictly cached public demo leave `YOUCAM_API_KEY` unset on the public project (protects your API units).

## Function duration
`app/api/analyze/route.ts` exports `maxDuration = 300`. Try-on polling can take 60-120 s; confirm your plan allows it (lower it to your plan's limit otherwise). Request bodies are capped at about 4.5 MB on Vercel, so downscale uploaded selfies client-side.

See `docs/NOTES.md` for known Vercel issues to fix before deploying.
