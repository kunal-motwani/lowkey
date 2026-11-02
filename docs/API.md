# API: `POST /api/analyze`

Runs the Stylist Agent and streams progress as Server-Sent Events. Implemented in `app/api/analyze/route.ts` (Node runtime, `maxDuration = 300`).

## Request

`multipart/form-data`. Each image (`selfie`, `garment`) is resolved in this order:

| Field | Type | Notes |
|---|---|---|
| `selfie` | file | Uploaded selfie |
| `selfieUrl` | string | `http(s)` URL fetched server-side (used if no file) |
| `sampleSelfie` | string | Filename in `public/samples/`, matching `^[a-z0-9_-]+\.(jpg|png)$` |
| `garment` | file | Uploaded garment image |
| `garmentUrl` | string | `http(s)` URL fetched server-side |
| `sampleGarment` | string | Filename in `public/samples/` (same pattern) |

If none resolves, the stream emits `fail` with `Missing selfie` / `Missing garment`. Hosted platforms cap request bodies (about 4.5 MB on Vercel); downscale client-side.

## Response

`Content-Type: text/event-stream`. Each message is `event: <name>` + `data: <JSON>`.

### `step`

Zero or more, `AgentEvent`:

```ts
{ step: "perceive" | "garment" | "score" | "decide" | "recolor" | "rescue" | "explain";
  status: "running" | "done" | "error" | "skipped";
  api?: string;      // YouCam API (or "Claude"/"templated") behind the step
  detail?: string }
```

When the verdict is `buy`, `recolor` and `rescue` are emitted as `skipped`.

### `result`

Exactly one on success, `Result` from `lib/agent.ts`:

```ts
{
  garmentHex: string;
  metrics: Record<string, number>;       // YouCam ui_score by metric
  tone: { skin_color: string; source?: "youcam" | "local";
          eye_color?: string; lip_color?: string; hair_color?: string;
          eye_color_name?: string; hair_color_name?: string };
  flattery: { score: number;             // 0-100
              reasons: { rule: string; metric: string; penalty: number; text: string }[];  // top 2
              undertone: "warm" | "cool" | "neutral";
              concerns: Record<string, number> };  // severity 0-100, higher = worse
  verdict: "buy" | "fix";                // buy when score >= 70
  originalTryOn?: string;                // data:image/jpeg;base64,...
  better?: { hex: string; name: string; score: number; image?: string;
             alternatives: { hex: string; name: string; score: number }[] };
  rescue?: { image?: string; baselineScore: number;
             plan: { lip: string; blush: string; concealer: string; note: string } };
  explanation: string;                   // LLM or templated
  errors: string[];                      // non-fatal step failures, e.g. "Makeup try-on: ..."
}
```

`better` and `rescue` exist only when `verdict` is `fix`. Images may be absent if that try-on failed (see `errors`).

### `fail`

Fatal error; the stream then closes:

```ts
{ message: string }
```

## Example

```bash
curl -N -F sampleSelfie=<selfie-file> -F sampleGarment=olive-tee.jpg http://localhost:3000/api/analyze
```

(Garment samples: `coral-top.jpg`, `navy-shirt.jpg`, `olive-tee.jpg`; use a selfie filename that exists in `public/samples/`.)

## Notes

- No auth or rate limiting is built in; add them before public deployment, since each live request consumes YouCam API units.
- Errors thrown by the stream surface as `fail`, not HTTP error codes; the HTTP status is 200.
