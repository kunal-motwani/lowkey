# Result cache

Every YouCam result is cached on disk so repeat runs cost zero API units. Keys come from a SHA-1 (first 16 hex chars) of the exact input bytes.

| Kind | File | Content |
|---|---|---|
| Skin Analysis | `skin_<hash>.json` | Metric map |
| Skin tone | `tone_<hash>.json` | Tone result incl. `source` |
| Clothes try-on | `vto_<personHash>_<garmentHash>_<category>.jpg` | Result image bytes |
| Makeup try-on | `makeup_<faceHash>_<planHash>.jpg` | Result image bytes |

## Location

Default `./cache` under the working directory. `FLATTR_CACHE_DIR` relocates it (being added alongside this doc; if your checkout predates it, `lib/youcam.ts` uses `cache/` only). An in-process memory map also fronts the JSON cache. Writes are wrapped in try/catch, so a read-only filesystem (e.g. Vercel) still works but nothing persists.

## DEMO_MODE

With `DEMO_MODE=1` **and no YouCam key set**, a cache miss throws `DEMO_MODE: no cached result for <key>` instead of calling the API. If any YouCam key is set, misses still call the live API.

## Populating the cache

1. Put your key in `.env` and leave `DEMO_MODE` unset.
2. `npm run dev` and run every scenario you want to serve (sample selfie plus each garment), including the fix path (recolour and makeup). Each run costs API units once.
3. Confirm `skin_*`, `tone_*`, `vto_*` and `makeup_*` entries exist.
4. Re-run with `DEMO_MODE=1` and no key; every scenario must complete without API calls.
5. Commit the cache directory only if you intend to ship it (remove it from `.gitignore` if listed).

Entries must come from real API runs; never hand-write them.

## Privacy

Cached files can contain skin metrics and generated try-on images derived from user photos. Do not commit caches built from other people's photos. Delete the directory to purge.

## Invalidation and fragility

Keys hash raw bytes, so any re-encode (client resize, recoloured JPEG output) changes the key. Changing sample images or recolour logic requires regenerating the cache. A cached tone result with `source: "local"` stays local until deleted, even after you gain Skin Tone entitlement.
