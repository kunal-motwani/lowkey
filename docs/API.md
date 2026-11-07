# API: `POST /api/analyze`

Runs the Stylist Agent on a face photo plus one or more pieces (top, bottom, jacket, shoes, necklace, earrings, bracelet, ring) and streams progress as Server-Sent Events. Implemented in `app/api/analyze/route.ts` (Node runtime, `maxDuration = 300`). Types live in `lib/types.ts`.

## Request

`multipart/form-data`.

| Field | Type | Notes |
|---|---|---|
| `face` | file | Close-up face/shoulders photo. Required (or `sampleFace`). Skin analysis and tone run on this photo |
| `sampleFace` | string | Filename in `public/samples/`, matching `^[a-z0-9_-]+\.(jpg|png)$` |
| `body` | file | Full-body photo (head to feet). Optional, but required when a `bottom` or `shoes` is present |
| `hand` | file | Back of the hand/wrist, fingers visible. File only (no URL or sample). Required when a `bracelet` or `ring` is present |
| `top`, `bottom`, `jacket`, `shoes`, `necklace`, `earrings`, `bracelet`, `ring` | file | Image for that role |
| `topUrl`, ... `ringUrl` (`<role>Url`) | string | `http(s)` URL fetched server-side (product pages are resolved to their image); used if no file |
| `sampleTop`, `sampleBottom`, `sampleJacket`, `sampleShoes`, `sampleNecklace`, `sampleEarrings`, `sampleBracelet`, `sampleRing` | string | Sample filename in `public/samples/` (same pattern) |

Per role the order of precedence is file, then URL, then sample. At least one piece is required. Each upload is limited to 8 MB; hosted platforms cap request bodies lower (about 4.5 MB on Vercel), so downscale client-side. Requests are rate limited to 6 per minute per IP (HTTP 429 with `Retry-After: 60`); a body that is not multipart gets HTTP 400 `{ error }`.

Photo requirements per piece:

| Piece | Photo it is tried on | What that photo must show |
|---|---|---|
| `top`, `jacket` | `face` (or `body` when given, for the layered chain) | Chest-up, front-facing |
| `bottom` | `body` (required) | Full body, head to feet |
| `shoes` | `body` (required) | Full body with the foot fully visible |
| `necklace` | `face` close-up | Front-facing, neck clearly visible (neck width at least 15% of image width, head rotation up to 20 degrees) |
| `earrings` | `face` close-up | Front-facing, ears visible |
| `bracelet`, `ring` | `hand` (required) | Back of the hand/wrist, all five fingers visible |

All other violations (missing face, no pieces, bottom/shoes without a body photo, bracelet/ring without a hand photo, bad sample name, unsafe URL, unreadable image) arrive as an SSE `fail` event with HTTP 200.

## Response

`Content-Type: text/event-stream`. Each message is `event: <name>` + `data: <JSON>`.

### `step`

Zero or more `AgentEvent`s (`lib/steps.ts`):

```ts
{ step: "perceive" | "garments" | "score" | "decide" | "tryon" | "recolor" | "rescue" | "tips" | "explain";
  status: "running" | "done" | "error" | "skipped";
  api?: string;      // YouCam API (or "Claude"/"templated") behind the step
  detail?: string }
```

Step list, in order: `perceive` (skin analysis + skin tone on the face photo), `garments` (dominant colour per piece), `score` (explainable outfit score), `decide` (buy at 70+, otherwise fix), `tryon` (layered try-on: clothing then shoes on the full-length image, then jewellery close-ups), `recolor` and `rescue` (fix verdict only, otherwise `skipped`), `tips` (makeup tips), `explain`.

### `result`

Exactly one on success, `AnalysisResult` (`lib/types.ts`):

```ts
{
  metrics: Record<string, number>;       // YouCam ui_score by metric
  tone: { skin_color: string; source?: "youcam" | "local"; ... };
  outfit: {
    score: number; verdict: "buy" | "fix"; threshold: number;   // 0-100, threshold 70
    undertone: "warm" | "cool" | "neutral";
    concerns: Record<string, number>;    // severity 0-100, higher = worse
    pieces: PieceScore[];                // role, hex, score, weight, rules[], reasons[], counterfactuals[]
    summary: string[];                   // 2-4 sentences explaining the verdict
  };
  stages: { label: string; roles: PieceRole[]; image?: string; group?: "outfit" | "closeup" }[];
  // outfit chain: "Top", "+ Bottom", "+ Jacket", "+ Shoes"; closeup: "Necklace", "+ Earrings", "Bracelet", "+ Ring"; image is a data URL
  better?: { role: PieceRole; hex: string; name: string; score: number; image?: string };
  rescue?: { image?: string; baselineScore: number;
             plan: { lip: string; blush: string; concealer: string; note: string } };
  makeupTips: { area: string; tip: string; why: string; shade?: string }[];
  explanation: string;                   // LLM or templated
  photoNotes: string[];                  // e.g. "No body photo: chest-up try-on only"
  unitsEstimate: number;                 // rough YouCam units used, cache hits excluded
  errors: string[];                      // non-fatal step failures, e.g. "Try-on (Bottom): ..."
}
```

`better` and `rescue` exist only when `verdict` is `fix`. A stage or image is absent if that try-on failed (see `errors`).

### `fail`

Fatal error; the stream then closes:

```ts
{ message: string }
```

User-actionable messages (bad input, YouCam rejections such as "face too small") are passed through; anything unexpected becomes a generic message.

## Cost and YouCam constraints

Every uncached piece costs one try-on call (clothes, shoes or jewellery); the recolour and rescue paths add more. `unitsEstimate` counts only calls that were not served from the cache, using a small constant table in `lib/agent.ts` (`UNITS_PER_CALL`). It is an estimate, not billing data. Per the YouCam docs, bottoms need a worn-outfit reference photo and a full-body person photo, which is why a body photo is required for them. Jewellery and shoes use their own YouCam APIs; their endpoints and request shapes live in `JEWELLERY_TASK` and `SHOES_TASK` in `lib/youcam.ts`:

| Piece | Endpoint (POST, poll GET `.../{task_id}`) | Status |
|---|---|---|
| shoes | `/s2s/v2.0/task/shoes-transfer` body `{src_file_id, ref_file_id}` (gender/style omitted: enum values undocumented) | docs + live probe: task created and ran |
| necklace | `/s2s/v2.0/task/2d-vto/necklace` | docs; exists for our key |
| bracelet | `/s2s/v2.0/task/2d-vto/bracelet` | docs; exists for our key |
| earrings | `/s2s/v2.0/task/2d-vto/earring` | exists for our key (live probe, 400 not 404); docs page not found |
| ring | `/s2s/v2.0/task/2d-vto/ring` | exists for our key (live probe); docs page not found |

Jewellery body: `{src_file_id, ref_file_ids:[id], source_info:{name:<src id>}, object_infos:[{name:<ref id>, parameter?}]}`. This passes the live API's required-field validation but is not yet verified end to end with real face/hand images. A rejected or disabled endpoint becomes a failed stage in `errors` with a hint, never a crash. Result image: `data.results.url` (valid 2 hours; downloaded immediately and cached as bytes).

The `garment_category` values are set in one place (`GARMENT_CATEGORY` in `lib/youcam.ts`); the YouCam docs do not enumerate them, so they are unverified until a real run.

## Example

```bash
curl -N -F sampleFace=<face-file> -F sampleTop=olive-tee.jpg http://localhost:3000/api/analyze
curl -N -F face=@me.jpg -F hand=@hand.jpg -F ringUrl=https://shop.example/ring http://localhost:3000/api/analyze
curl -N -F face=@me.jpg -F body=@full.jpg -F top=@shirt.jpg -F bottom=@jeans.jpg -F jacketUrl=https://shop.example/jacket http://localhost:3000/api/analyze
```

(Garment samples: `coral-top.jpg`, `navy-shirt.jpg`, `olive-tee.jpg`; use a face filename that exists in `public/samples/`.)

## Notes

- No authentication is built in; the per-IP limiter is in-memory (per instance on serverless). Add auth and a shared store before public deployment, since each live request consumes YouCam API units.
- Errors thrown by the stream surface as `fail`, not HTTP error codes; the HTTP status is 200.
