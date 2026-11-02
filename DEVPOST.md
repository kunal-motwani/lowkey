## Inspiration
We kept buying tops that looked amazing on the model and made us look exhausted. Garment colour reflects onto the face and amplifies whatever our skin is doing that day. Personal-colour apps give one static palette; try-on tools show fit but not whether the colour flatters *us, today*. Nobody connects live skin condition, skin tone and the specific garment before checkout.

## What it does
Flattr answers "Will this shirt make me look tired?" before you buy. Upload a selfie and a garment (image or URL). A Stylist Agent reads your skin, scores the garment, and returns a Flattery Score with two plain-English reasons tied to your skin metrics. Below 70, it offers a one-tap fix: the same garment in a better colour shown on you, or the exact lip, blush and concealer that rescue the shirt you love.

## How we built it
Next.js (App Router) + TypeScript + Tailwind on Vercel. A typed YouCam client handles upload → task → poll with backoff and a hash-keyed cache. A deterministic Flattery engine (colour theory in LAB/HSL) scores the garment against skin tone, undertone and concern severity. The Stylist Agent orchestrates perceive → analyse → score → decide → fix → explain, streaming every step over SSE into a live timeline. Garments are recoloured locally with sharp (hue shift preserving shading) and ranked per user. An optional LLM writes the final verdict; the app works without it.

## YouCam APIs used
- **AI Skin Analysis**: today's dark circles, redness, oiliness, texture, spots, moisture, radiance.
- **AI Skin Tone Analysis**: skin colour (undertone), eye, lip and hair colours.
- **AI Clothes Virtual Try-On**: original and recoloured garment on the user.
- **AI Makeup Virtual Try-On**: lip, blush and concealer applied on the try-on image.

## Challenges
Async tasks are slow, so we stream agent progress and degrade gracefully: if a try-on fails, the score, reasons and other fixes still show. We avoided fake precision: the engine speaks in risk and amplification, not invented optical percentages. Recolouring flat-lay product shots without recolouring the background took careful hue gating.

## Accomplishments
A complete, coherent flow using all four YouCam APIs with real logic between them, a transparent rules engine, a demo mode that never fails live, and zero repeat-run API cost via caching.

## What's next
- Browser extension that scores any product page as you shop.
- Retailer widget that reduces colour-related returns.
- B2B API for fashion e-commerce: "flattery score" per shopper per SKU.
- Accessories and hair-colour matching, and a multi-day skin trend view.
