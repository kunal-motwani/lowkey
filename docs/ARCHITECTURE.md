# Architecture

Flattr is a Next.js 15 (App Router, TypeScript) app. A single API route runs a "Stylist Agent" that streams progress to the browser over Server-Sent Events.

## Components

```mermaid
flowchart TB
  UI[Browser UI] -- multipart POST --> R[app/api/analyze/route.ts]
  R -- SSE: step / result / fail --> UI
  R --> A[lib/agent.ts runStylist]
  A --> Y[lib/youcam.ts]
  A --> F[lib/flattery.ts]
  A --> C[lib/color.ts]
  Y --> TL[lib/tone-local.ts]
  Y <--> K[(Disk cache)]
  Y -- upload, task, poll --> YC[YouCam S2S API v2.0]
  A -. optional .-> LLM[Anthropic Messages API]
```

| Module | Responsibility |
|---|---|
| `app/api/analyze/route.ts` | Parses the form, loads images (upload, URL or sample), runs the agent, emits SSE |
| `lib/agent.ts` | Orchestrates steps; each external call is isolated so partial failures degrade gracefully |
| `lib/youcam.ts` | Typed client: File API upload, create task, poll; key selection; cache |
| `lib/flattery.ts` | Deterministic scoring rules, colourway ranking, makeup plan |
| `lib/color.ts` | RGB/LAB/HSL maths, dominant colour (k-means via sharp), garment recolouring |
| `lib/tone-local.ts` | Local skin-tone estimate when Skin Tone Analysis is unavailable |

## Agent sequence

```mermaid
sequenceDiagram
  participant UI
  participant Route
  participant Agent
  participant YouCam
  UI->>Route: POST /api/analyze
  Route->>Agent: runStylist(selfie, garment)
  Agent->>YouCam: Skin Analysis + Skin Tone (parallel)
  Agent-->>UI: step perceive
  Agent->>Agent: garment colour, score, decide (>= 70 = buy)
  Agent->>YouCam: Clothes try-on (original)
  alt score < 70
    Agent->>Agent: rank colourways, recolour garment
    Agent->>YouCam: Clothes try-on (better colour)
    Agent->>YouCam: Makeup try-on (rescue)
  end
  Agent->>Agent: explain (Anthropic if key set, else template)
  Agent-->>UI: result
```

Failures in try-on or makeup steps are recorded in `result.errors` and the rest of the result is still returned. A failure in perceive, garment colour or scoring aborts the run with a `fail` event.

## Skin tone fallback

`skinTone()` calls Skin Tone Analysis when a key (`YOUCAM_KEY_TONE` or `YOUCAM_API_KEY`) exists; on missing key or any error it uses `localSkinTone()` (central face crop, YCbCr skin-pixel gate, per-channel median). The result carries `source: "youcam" | "local"`, shown in the UI as "local estimate" when local.

## Key selection

Per-API override (`YOUCAM_KEY_SKIN`, `_TONE`, `_CLOTHES`, `_MAKEUP`) wins over `YOUCAM_API_KEY`. See [CACHE.md](CACHE.md) for caching and [API.md](API.md) for the HTTP contract.

## Privacy

Images go to YouCam; only a text summary goes to Anthropic if `ANTHROPIC_API_KEY` is set. Nothing is stored server-side except the hash-keyed cache.
