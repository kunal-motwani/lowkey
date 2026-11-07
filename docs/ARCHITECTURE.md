# Architecture

Flattr is a Next.js 15 (App Router, TypeScript) app. A single API route runs a multi-piece "Stylist Agent" that streams progress to the browser over Server-Sent Events.

## Components

```mermaid
flowchart TB
  UI[Browser UI] -- multipart POST --> R[app/api/analyze/route.ts]
  R -- SSE: step / result / fail --> UI
  R --> A[lib/agent.ts runStylist]
  A --> Y[lib/youcam.ts]
  A --> F[lib/outfit.ts + lib/flattery.ts]
  A --> MT[lib/makeup-tips.ts]
  A --> C[lib/color.ts]
  Y --> TL[lib/tone-local.ts]
  Y <--> K[(Disk cache)]
  Y -- upload, task, poll --> YC[YouCam S2S API v2.0]
  A -. optional .-> LLM[Anthropic Messages API]
```

| Module | Responsibility |
|---|---|
| `app/api/analyze/route.ts` | Parses the form (face, body, per-role pieces), loads images (upload, URL or sample), runs the agent, emits SSE |
| `lib/agent.ts` | Orchestrates the steps and layered try-on; each external call is isolated so partial failures degrade gracefully |
| `lib/youcam.ts` | Typed client: File API upload, create task, poll; key selection; cache |
| `lib/flattery.ts`, `lib/outfit.ts` | Deterministic per-piece scoring rules, outfit score, colourway counterfactuals, rescue makeup plan |
| `lib/makeup-tips.ts` | Actionable makeup tips from the outfit, tone and skin metrics |
| `lib/color.ts` | RGB/LAB/HSL maths, dominant colour (k-means via sharp), garment recolouring |
| `lib/tone-local.ts` | Local skin-tone estimate when Skin Tone Analysis is unavailable |

## Agent sequence

Steps: perceive, garments, score, decide, tryon, recolor, rescue, tips, explain. Skin analysis and tone run on the **face** photo; the try-on chain starts from the **body** photo when there is one, otherwise from the face photo (chest-up only).

```mermaid
sequenceDiagram
  participant UI
  participant Route
  participant Agent
  participant YouCam
  UI->>Route: POST /api/analyze (face, body?, pieces)
  Route->>Agent: runStylist({ face, body, pieces })
  Agent->>YouCam: Skin Analysis + Skin Tone on face (parallel)
  Agent->>Agent: dominant colour per piece, scoreOutfit, decide (>= 70 = buy)
  Note over Agent,YouCam: Layering: person = body or face
  Agent->>YouCam: Try-on top onto person -> stage 1 image
  Agent->>YouCam: Try-on bottom onto stage 1 -> stage 2 image
  Agent->>YouCam: Try-on jacket onto stage 2 -> stage 3 image
  alt verdict is fix
    Agent->>Agent: recolour weakest face-adjacent piece locally
    Agent->>YouCam: Try-on recoloured piece on face photo (better)
    Agent->>YouCam: Try-on face-adjacent pieces on face photo (or reuse stage image)
    Agent->>YouCam: Makeup try-on with rescue plan (rescue)
  end
  Agent->>Agent: makeup tips, explain (Anthropic if key set, else template)
  Agent-->>UI: result
```

A failed layering stage records an error and the chain continues from the previous person image. Failures in recolour, rescue or makeup never abort the run; they land in `result.errors`. A failure in perceive, garment colour or scoring aborts with a `fail` event. Bad input (no pieces, a bottom without a body photo) throws `InputError`, whose message is shown to the user.

## Cost and units

Each uncached piece costs one clothes try-on call; the fix path adds a recolour try-on, optional rescue try-ons and one makeup call. `unitsEstimate` sums a constant per live call (`UNITS_PER_CALL` in `lib/agent.ts`) and skips cache hits, which `lib/youcam.ts` reports through an optional `onCall` callback. It is an estimate only. Per the YouCam docs, bottoms need a worn-outfit reference photo and a full-body person photo. `GARMENT_CATEGORY` in `lib/youcam.ts` is the single place to change the category sent per role; its values are unverified until a real run, and the category is part of the try-on cache key.

## Skin tone fallback

`skinTone()` calls Skin Tone Analysis when a key (`YOUCAM_KEY_TONE` or `YOUCAM_API_KEY`) exists; on missing key or any error it uses `localSkinTone()` (central face crop, YCbCr skin-pixel gate, per-channel median). The result carries `source: "youcam" | "local"`, shown in the UI as "local estimate" when local.

## Key selection

Per-API override (`YOUCAM_KEY_SKIN`, `_TONE`, `_CLOTHES`, `_MAKEUP`) wins over `YOUCAM_API_KEY`. See [CACHE.md](CACHE.md) for caching and [API.md](API.md) for the HTTP contract.

## Privacy

Images go to YouCam; only a text summary goes to Anthropic if `ANTHROPIC_API_KEY` is set. Nothing is stored server-side except the hash-keyed cache.
