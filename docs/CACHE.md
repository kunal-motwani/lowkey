# Populating cache/

Every YouCam result is stored as `cache/<kind>_<hash>.json` (skin, tone) or a binary image `cache/<kind>_<hash>` (vto, makeup). The hash is derived from the exact input bytes. The folder is created automatically on the first live run. Results must come from real API runs; never hand-write or fabricate entries.

## Steps
1. Put `YOUCAM_API_KEY` (and `YOUCAM_API_BASE` if needed) in `.env.local`; leave `DEMO_MODE` unset.
2. `npm run dev`, open the app, and run each demo scenario you will show (sample selfie + each sample garment) end to end, including recolored colorways and the makeup step. Each run costs API units once.
3. Confirm `cache/` holds `skin_*`, `tone_*`, `vto_*` and `makeup_*` entries.
4. Re-run with `DEMO_MODE=1` and the key removed: every scenario must complete without API calls. A miss shows `DEMO_MODE: no cached result for <key>`.
5. Commit `cache/` (remove it from `.gitignore` if listed) and deploy per `DEPLOY.md`.

If you change the sample images or the recolor logic, hashes change and the cache must be regenerated.
