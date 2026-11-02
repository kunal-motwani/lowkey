# Flattery scoring

Implemented in `lib/flattery.ts`. Deterministic: the same inputs always give the same score. These are heuristics from colour theory, not a validated perceptual model.

## Inputs

- Garment hex (dominant colour from `lib/color.ts`), converted to HSL and CIE Lab.
- Skin tone hex (`ToneResult.skin_color`) from YouCam Skin Tone Analysis or the local estimate, converted to Lab; undertone derived from it.
- Skin metrics (`SkinMetrics`): map of YouCam `ui_score` values (1-100) keyed by `dark_circle_v2`, `redness`, `oiliness`, `texture`, `age_spot`, `moisture`, `radiance`.

### Concern severity

`concernSeverity` converts each metric to severity 0-100 (higher = worse) as `100 - ui_score`, defaulting to 30 if missing. `dullness = max(100 - radiance, 0.8 * (100 - moisture))`.

> **Unverified assumption:** this inversion assumes higher `ui_score` means healthier skin. That has not been checked against real API responses. If real responses show the opposite, remove the inversion. Until verified, treat reason text citing "/100" values with caution.

### Undertone

Lab hue angle `atan2(b*, a*)` of the skin colour: above 62 deg = warm, below 50 deg = cool, otherwise neutral. Typical skin clusters around 55 deg, so many skins land in "neutral" and cool-undertone rules fire rarely.

## Rules

| Rule | Trigger | Penalty (before clamping) |
|---|---|---|
| `sallow-reflection` | Hue near 70 deg (yellow-green, olive, mustard), not very light | up to `12 + 0.55 * darkCircles` |
| `redness-echo` | Saturated red / coral / pink hues | `(8 + 0.6 * redness) * saturation` |
| `wash-out` | Garment lightness close to skin lightness and low chroma | `lowContrast * (8 + 0.6 * dullness)` |
| `undertone-clash` | Warm skin + icy pastel, or cool skin + earthy dark warm tone | 22 |

Penalties of 2 or less are ignored. Bonuses: deep blues (+8 cool, +4 neutral), warm mid-tones on warm skin (+6), healthy lightness contrast (+6).

## Output

`score = round(clamp(84 - sum(penalties) + bonus, 0, 100))`. The top two reasons by penalty are returned with plain-English text; if none, a "harmony" reason. `verdict` is `buy` at score >= 70, else `fix`. Wording stays risk-based ("can", "tends to").

## Colourways and makeup

- `bestColorways` generates 12 hues (30 deg apart) at the garment's clamped saturation/lightness, skips hues within 20 deg of the original, scores each for this user and returns the top N.
- `rescueMakeup` picks lip, blush and concealer hex values and a note based on undertone and the top rule.

## Limits

- Not medical advice and not a medical device.
- Garment colour is a single dominant colour; patterns and trims are not modelled.
- Lighting and white balance in both photos shift the estimates.
- Thresholds and constants are hand-tuned, not fitted to data.

## How to extend

1. Add a rule inside `scoreGarment` using the `add({ rule, metric, penalty, text })` helper; keep text risk-based.
2. Add expectations to `scripts/score-check.ts` and run `npx tsx scripts/score-check.ts`.
3. Update this page and `CHANGELOG.md`.
