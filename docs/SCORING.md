# Flattery scoring

Implemented in `lib/flattery.ts` (per-piece rules), `lib/outfit.ts` (outfit aggregation, rescue makeup) and `lib/makeup-tips.ts` (tips). Deterministic: the same inputs always give the same output. These are heuristics from colour theory, not a validated perceptual model, and **Flattr is not a medical device** and gives no medical or skin-condition advice.

## Inputs

- Garment hex per piece (dominant colour from `lib/color.ts`), converted to HSL and CIE Lab.
- Skin tone hex (`ToneResult.skin_color`) from YouCam Skin Tone Analysis or the local estimate, converted to Lab; undertone derived from it.
- Skin metrics (`SkinMetrics`): YouCam `ui_score` values (1-100) keyed by `dark_circle_v2`, `redness`, `oiliness`, `texture`, `age_spot`, `moisture`, `radiance`.

### Concern severity

`concernSeverity` converts each metric to severity 0-100 (higher = worse) as `100 - ui_score`, defaulting to 30 if missing. `dullness = max(100 - radiance, 0.8 * (100 - moisture))`. Evidence strings show severity with a band: `>= 55` high, `>= 35` moderate, otherwise low (e.g. `62/100 (high)`).

> **Unverified assumption:** this inversion assumes higher `ui_score` means healthier skin. That has not been checked against real API responses. If real responses show the opposite, remove the inversion. Until verified, treat "/100" values with caution.

### Undertone

Lab hue angle `atan2(b*, a*)` of the skin colour: above 62 deg = warm, below 50 deg = cool, otherwise neutral. Typical skin clusters around 55 deg, so many skins land in "neutral" and cool-undertone rules fire rarely.

## Piece score

`scorePiece(role, hex, tone, metrics, { topHex? })` evaluates **every** rule and returns all of them in `rules` (triggered or not):

```
score = round(clamp(base + sum(rule.delta), 0, 100)),  base = 84
```

Each `RuleResult` has `applicable` (evaluated for this role at all), `triggered`, signed `delta` (penalties negative, bonuses positive; 0 when not triggered), `evidence` (labelled values that drove it) and a plain-English `explanation` with risk-based wording ("can", "tends to"). Penalties of 2 points or less are ignored (not triggered, delta 0). Because deltas are exactly what is summed, the breakdown always adds up to `score - base` (before clamping and rounding).

| Rule | Roles | Formula / trigger | Delta |
|---|---|---|---|
| `sallow-reflection` | top, jacket | Hue near 70 deg (45 deg falloff) x saturation factor x (0.4 if very light) | `-factor * (12 + 0.55 * darkCircles)` |
| `redness-echo` | top, jacket | Hue within the red/coral/pink bands x `min(1.4 * saturation, 1)` | `-factor * (8 + 0.6 * redness)` |
| `wash-out` | top, jacket | Lab L* gap to skin under 30 and low chroma | `-lowContrast * (8 + 0.6 * dullness)` |
| `undertone-clash` | all (bottom at half strength) | Warm skin + icy cool pastel, or cool skin + dark earthy warm tone | `-22` (`-11` for bottoms) |
| `cool-jewel-harmony` | top, jacket | Deep blue/jewel tone (hue 200-280, L < 0.5, S > 0.3) | `+8` cool, `+4` neutral undertone |
| `warm-mid-tone-harmony` | top, jacket | Warm mid-tone (hue 10-50, L 0.3-0.6, S > 0.25) on warm undertone | `+6` |
| `healthy-contrast` | top, jacket | L* gap to skin between 25 and 55 | `+6` |
| `bottom-harmony` | bottom | Neutral colour, or a family that echoes the undertone | `+3` |
| `pair-harmony` | jacket, bottom (needs a top/anchor colour) | See below | about `-12` to `+2` |
| `undertone-clash` (shoes) | shoes | Same trigger, half strength | `-11` |
| `undertone-clash` (jewellery) | necklace, earrings, only for a strongly coloured stone (metal `other`, saturation >= 0.55) | Same trigger, half strength; skipped for metals and for bracelet/ring | `-11` |
| `shoe-harmony` | shoes (needs clothing) | Neutral shoes: `0`. Saturated shoes (S >= 0.5) echoing a clothing hue within 30 deg: `+3`; single accent over neutral/muted clothing: `+2`; next to a saturated clothing piece 50+ deg away (two competing accents): `-(5 to 8)` | `-8` to `+3` |
| `shoe-neutral-tie` | shoes (needs top and bottom) | Neutral or earthy (hue 15-50, S < 0.65, L < 0.6) shoes bridging top and bottom | `+2` |
| `metal-undertone-match` | all jewellery (recognised gold / silver / rose gold only) | Warm: gold `+4`, rose gold `+3`, silver `-5`. Cool: silver `+4`, rose gold `-2`, gold `-5`. Neutral: any recognised metal `+3` | `-5` to `+4` |
| `jewellery-vs-neckline` | necklace, earrings (needs a clothing colour) | Metal within 12 L* of the top: `-3` (blends in). Gold on a deep or earthy/olive/navy top, silver on a cool jewel or dark/neutral top, rose gold on a dark muted or cool top: `+3` | `-3` to `+3` |
| `accent-balance` | bracelet, ring | Distinct saturated accent hues (40 deg apart) across jewellery stones and shoes; 3 or more and this piece is itself an accent: note plus small penalty | `-3` or `0` |

For **shoes** and **jewellery** the face-reflection rules and the three face bonuses are also `applicable: false`, with a "Not evaluated: ..." explanation naming the reason (shoes/jewellery are far from, or small relative to, the face).

For **bottoms** the face-reflection rules (`sallow-reflection`, `redness-echo`, `wash-out`) and the three face bonuses are `applicable: false` with the explanation "Not evaluated: trousers/skirts sit far from the face, so their colour has little effect on how your face looks."

The jacket uses identical rule maths to the top; it is weighted lower only through the outfit weights.

### Pair harmony

Compared with the anchor piece (the top, else the jacket): near-identical colours (Lab distance under 12) get `-3` ("can look flat", tonal looks are a style choice); with a neutral on either side, `0`; two strongly saturated hues 50-140 deg apart get `-(6 + 6 * (minSaturation - 0.5) / 0.5)`; analogous hues (within 40 deg) with an L* gap of at least 12 get `+2`; roughly complementary hues (150 deg or more) with one muted get `+2`; everything else `0`.

### Metal heuristic (jewellery)

`classifyMetal(hex)` sets `PieceScore.metal` from the dominant HSL colour of the jewellery image. **This is a colour heuristic, not material detection**: it cannot tell gold from gold-coloured plastic, and it can misjudge gemstone-heavy photos, reflections or strongly tinted lighting.

| Metal | Rule |
|---|---|
| `dark` | lightness < 0.20 |
| `gold` | hue 38-56 deg, saturation >= 0.45, lightness 0.30-0.78 |
| `rose-gold` | hue 0-28 or 335-360 deg, saturation 0.20-0.65, lightness 0.45-0.85 |
| `silver` | saturation < 0.15 and lightness >= 0.50, or hue 180-260 with saturation < 0.25 and lightness >= 0.60 |
| `other` | anything else (coloured stones, brown, etc.) |

The warm-with-gold / cool-with-silver pairing is a common styling guideline, not a law; the wording uses "tends to" and mismatches are a modest penalty only. `dark` and `other` pieces skip `metal-undertone-match`.

### Reasons and counterfactuals

- `reasons`: the two triggered penalties with the largest magnitude (`penalty = -delta`), or a "harmony" fallback with penalty 0.
- `counterfactuals`: up to 3 alternative colourways from 12 hues (30 deg apart, skipping hues within 20 deg of the current) at the garment's clamped saturation and lightness, re-scored with the same role and pairing context. For **shoes** the candidates are a fixed set of sensible shoe colours (black, white, tan, brown, navy, grey, burgundy; ones within Lab distance 10 of the current colour are skipped), re-scored with the same outfit context. For **jewellery** the candidates are the other metals with representative hexes: gold `#c9a227`, silver `#c0c0c0`, rose gold `#b76e79`, and `why` starts "A gold finish ...". `delta` = candidate score minus current score (so rescoring the candidate hex reproduces it). `why` lists the (up to) two rules whose delta changed most, e.g. "avoids the yellow-green cast near the eyes rule (+29)", "adds healthy lightness contrast (+6)", "brings in red-on-red echo (-12)".

## Outfit score

`scoreOutfit(pieces, tone, metrics)` scores each piece (the anchor colour is passed as pairing context to the others) and combines them:

```
score = round(sum(weight_i * pieceScore_i))
```

Suggested weights (`ROLE_WEIGHT`): top 0.5, jacket 0.35, bottom 0.15, shoes 0.10, necklace 0.10, earrings 0.10, bracelet 0.05, ring 0.05, **normalised over the pieces provided** so they sum to 1 (e.g. top + bottom = 0.77 / 0.23; top + shoes + ring = 0.77 / 0.15 / 0.08). Each piece also receives the other pieces' colours as context (used by the shoe and accent rules); the anchor is still the top, else jacket, else bottom, and an outfit of only shoes/jewellery has no anchor. Face-adjacent pieces weigh more because the colour near the face is what reflects onto skin. `verdict = score >= 70 ? "buy" : "fix"` (threshold 70). Empty input or a repeated role throws an Error.

`summary` is 2-4 sentences: (1) score vs threshold and verdict; (2) the piece that costs the most points (`weight * (100 - score)`) and by about how much; (3) the biggest triggered rule per clothing piece with its delta, plus, only when a shoe or jewellery rule actually fired, a clause "Shoes and jewellery shifted the outfit by about N points (...)"; (4) the best single swap by outfit gain (colour for clothing and shoes, metal for jewellery) and the resulting approximate outfit score, or a note that makeup is the best lever.

`rescueMakeupFor(outfit)` picks lip, blush and concealer hex values plus a note, based on undertone and the largest weighted penalty across pieces (reuses `rescueMakeup`).

## Makeup tips

`makeupTips(outfit, tone, metrics)` returns 4-7 deterministic tips (cap 7; the lowest-priority tip is dropped first), each with a `why` citing the metric or garment colour, and `shade` swatches where meaningful:

- **Concealer**: dark-circle severity 45 or more recommends a peach/orange-toned corrector for blue-purple circles (cosmetic colour-theory suggestion, stated as such); otherwise a light-reflecting concealer. Mentions extra blending if the face-adjacent garment is yellow-green.
- **Skin prep**: redness 45 or more suggests green-tinted primer or colour corrector before foundation; oiliness 45 or more suggests mattifying primer and blotting; dullness 45 or more suggests hydrating prep and a subtle luminizer; for healthy skin, light prep that enhances.
- **Base**: depth range from skin L* (light >= 72, medium >= 55, deep otherwise) plus undertone; no brand names.
- **Blush / lip**: shade by undertone, softened to a muted peach-nude/rose-nude when redness is high or the garment is a saturated red/coral/orange/pink, so shades do not stack or compete.
- **Eyes**: liner or shadow tone roughly opposite the garment hue on the colour wheel (a suggestion, not a measured effect); for neutral garments, a plum-grey or chocolate by undertone.
- **Jewellery-aware** (only when jewellery is present; tip count stays 4-7): a gold or rose-gold piece nudges blush toward peach/apricot and the lip toward warm coral/terracotta; silver nudges blush toward rose and the lip toward a cooler berry (a saturated garment still overrides these); coloured earrings make the eye tip soft and neutral; metal earrings add an optional matching lid shimmer; a bold or dark necklace adds "keep the application light" to the blush tip. Each `why` cites the piece, its detected metal and hex.
- **Brows**: a step softer than the detected hair colour, otherwise by undertone.

Tips avoid medical wording ("treat", "cure", "diagnose").

## Limits

- Not medical advice and not a medical device; tips are cosmetic suggestions.
- Jewellery metal is inferred from colour only (see above), so it can be wrong; the metal/undertone pairing is a styling guideline, not a rule. Piece size and style (statement vs delicate) are not known.
- Garment colour is a single dominant colour; patterns, trims and fit are not modelled.
- Lighting and white balance in both photos shift the estimates. No precise optical effect is claimed; wording is risk-based.
- Thresholds, weights and constants are hand-tuned, not fitted to data.

## How to extend

1. Add a rule inside `evaluate` in `lib/flattery.ts` using the `penalty(...)` or `bonus(...)` helper; supply evidence and risk-based text for both the triggered and not-triggered case.
2. Add tests in `tests/flattery.test.ts` and expectations to `scripts/score-check.ts` (`npx tsx scripts/score-check.ts`).
3. Update this page and `CHANGELOG.md`.
