# API: `POST /api/analyze`

Runs the Stylist Agent on a face photo plus one to three garments (top, bottom, jacket) and streams progress as Server-Sent Events. Implemented in `app/api/analyze/route.ts` (Node runtime, `maxDuration = 300`). Types live in `lib/types.ts`.

## Request

`multipart/form-data`.

| Field | Type | Notes |
|---|---|---|
| `face` | file | Close-up face/shoulders photo. Required (or `sampleFace`). Skin analysis and tone run on this photo |
| `sampleFace` | string | Filename in `public/samples/`, matching `^[a-z0-9_-]+\.(jpg|png)$` |
| `body` | file | Full-body photo. Optional, but required when a `bottom` is present |
| `top`, `bottom`, `jacket` | file | Garment image for that role |
| `topUrl`, `bottomUrl`, `jacketUrl` | string | `http(s)` URL fetched server-side (product pages are resolved to their image); used if no file |
| `sampleTop`, `sampleBottom`, `sampleJacket` | string | Sample filename in `public/samples/` (same pattern) |

Per role the order of precedence is file, then URL, then sample. At least one piece is required. Each upload is limited to 8 MB; hosted platforms cap request bodies lower (about 4.5 MB on Vercel), so downscale client-side. Requests are rate limited to 6 per minute per IP (HTTP 429 with `Retry-After: 60`); a body that is not multipart gets HTTP 400 `{ error }`.

All other violations (missing face, no pieces, bottom without a body photo, bad sample name, unsafe URL, unreadable image) arrive as an SSE `fail` event with HTTP 200.

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

Step list, in order: `perceive` (skin analysis + skin tone on the face photo), `garments` (dominant colour per piece), `score` (explainable outfit score), `decide` (buy at 70+, otherwise fix), `tryon` (layered try-on), `recolor` and `rescue` (fix verdict only, otherwise `skipped`), `tips` (makeup tips), `explain`.

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
  stages: { label: string; roles: PieceRole[]; image?: string }[];  // "Top", "+ Bottom", "+ Jacket"; image is a data URL
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

Every uncached piece costs one clothes try-on call; the recolour and rescue paths add more. `unitsEstimate` counts only calls that were not served from the cache, using a small constant table in `lib/agent.ts` (`UNITS_PER_CALL`). It is an estimate, not billing data. Per the YouCam docs, bottoms need a worn-outfit reference photo and a full-body person photo, which is why a body photo is required for them. The `garment_category` values are set in one place (`GARMENT_CATEGORY` in `lib/youcam.ts`); the YouCam docs do not enumerate them, so they are unverified until a real run.

## Example

```bash
curl -N -F sampleFace=<face-file> -F sampleTop=olive-tee.jpg http://localhost:3000/api/analyze
curl -N -F face=@me.jpg -F body=@full.jpg -F top=@shirt.jpg -F bottom=@jeans.jpg -F jacketUrl=https://shop.example/jacket http://localhost:3000/api/analyze
```

(Garment samples: `coral-top.jpg`, `navy-shirt.jpg`, `olive-tee.jpg`; use a face filename that exists in `public/samples/`.)

## Notes

- No authentication is built in; the per-IP limiter is in-memory (per instance on serverless). Add auth and a shared store before public deployment, since each live request consumes YouCam API units.
- Errors thrown by the stream surface as `fail`, not HTTP error codes; the HTTP status is 200.
