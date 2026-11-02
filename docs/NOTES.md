# Notes for the build agent (Vercel issues spotted, nothing edited)

1. **cache/ not bundled.** `lib/youcam.ts` reads `path.join(process.cwd(), "cache")` with a dynamic path; Next file tracing will not include it in the serverless bundle. Add to `next.config.ts`:
   `outputFileTracingIncludes: { "/api/analyze": ["./cache/**/*", "./public/samples/**/*"] }`.
   `app/api/analyze/route.ts` has the same issue reading `public/samples/*` via `fs` + `process.cwd()`.
2. **Writes** to `cache/` are try/caught (good) but silently lost on Vercel. Optionally write to `/tmp` and check `/tmp` on reads.
3. **DEMO_MODE guard** only throws when `YOUCAM_API_KEY` is unset. With a key set and DEMO_MODE=1, cache misses still hit the API. Intended? Document it or always throw on a miss.
4. **Cache key fragility:** keys hash raw image bytes. Any re-encode (client resize, `recolorGarment` JPEG output) changes the hash, so cached demo results only hit if the exact same bytes are produced. Test a cold DEMO_MODE run locally before deploying.
5. **SkinMetrics comment** in youcam.ts says "higher = more of the concern", but `concernSeverity` in flattery.ts assumes ui_score (higher = healthier) and inverts. Verify against a real response; if the comment is right, remove the inversion in flattery.ts.
6. `maxDuration = 300` may exceed plan limits; request body limit is about 4.5 MB.
7. `sharp` (lib/color.ts) must stay in `dependencies`, not devDependencies.
8. Undertone: both test skins (#d9a07c, #e8c4b0) land in the "neutral" band (Lab hue 56-58 deg), so cool-undertone rules only fire on distinctly pinkish skin. Navy gets a smaller bonus on neutral skin.
