/**
 * Sanity check for lib/flattery.ts scoring. Run from the flattr folder:
 *   npx tsx scripts/score-check.ts
 * Exits non-zero if an expectation fails.
 * Skin metrics use YouCam-style ui_score (higher = healthier), so a LOW value = HIGH concern.
 */
import { scorePiece, undertoneOf } from "../lib/flattery";
import { makeupTips } from "../lib/makeup-tips";
import { scoreOutfit } from "../lib/outfit";

const garments = { olive: "#7d8239", coral: "#f0705a", navy: "#1f2f5c" } as const;

const profiles: Record<string, { skin: string; m: Record<string, number> }> = {
  "warm skin, high dark circles + redness": {
    skin: "#d9a07c",
    m: { dark_circle_v2: 30, redness: 30, radiance: 50, moisture: 55, oiliness: 60, texture: 60, age_spot: 60 },
  },
  "warm skin, high dark circles only": {
    skin: "#d9a07c",
    m: { dark_circle_v2: 25, redness: 90, radiance: 70, moisture: 70, oiliness: 70, texture: 70, age_spot: 70 },
  },
  "warm skin, high redness only": {
    skin: "#d9a07c",
    m: { dark_circle_v2: 90, redness: 25, radiance: 70, moisture: 70, oiliness: 70, texture: 70, age_spot: 70 },
  },
  "low-concern lighter skin": {
    skin: "#e8c4b0",
    m: { dark_circle_v2: 85, redness: 85, radiance: 80, moisture: 80, oiliness: 80, texture: 80, age_spot: 80 },
  },
};

const results: Record<string, Record<string, number>> = {};
for (const [pname, p] of Object.entries(profiles)) {
  const tone = { skin_color: p.skin };
  console.log(`\n${pname}  skin ${p.skin}  undertone=${undertoneOf(tone)}`);
  results[pname] = {};
  for (const [gname, hex] of Object.entries(garments)) {
    const f = scorePiece("top", hex, tone, p.m);
    results[pname][gname] = f.score;
    const fired = f.rules
      .filter((r) => r.triggered)
      .map((r) => `${r.rule}(${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(1)})`);
    console.log(
      `  ${gname.padEnd(6)} ${hex}  score ${String(f.score).padStart(3)}  base ${f.base}  ` +
        (fired.join(", ") || "no rules fired") +
        `  | cf: ${f.counterfactuals.map((c) => `${c.name}${c.delta >= 0 ? "+" : ""}${c.delta}`).join(" ")}`
    );
  }
}

let fail = 0;
const expect = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) fail++;
};
const a = results["warm skin, high dark circles only"];
const b = results["warm skin, high redness only"];
const c = results["warm skin, high dark circles + redness"];
const lo = results["low-concern lighter skin"];
expect(a.olive < a.coral && a.olive < a.navy, "olive scores lowest when dark circles are high");
expect(b.coral < b.olive && b.coral < b.navy, "coral scores lowest when redness is high");
expect(c.navy > c.olive && c.navy > c.coral, "navy beats olive and coral when both concerns are high");
expect(lo.navy >= 75, "navy reasonably high (>=75) on low-concern skin");

// Outfit-level checks.
{
  const tone = { skin_color: "#d9a07c" };
  const m = profiles["warm skin, high dark circles only"].m;
  const outfit = scoreOutfit(
    [
      { role: "top", hex: garments.olive },
      { role: "bottom", hex: garments.navy },
    ],
    tone,
    m
  );
  console.log(`\nOutfit (olive top + navy bottom): ${outfit.score} ${outfit.verdict}`);
  outfit.summary.forEach((s) => console.log(`  - ${s}`));
  makeupTips(outfit, tone, m).forEach((t) => console.log(`  [${t.area}] ${t.tip} (${t.why})`));
  expect(Math.abs(outfit.pieces.reduce((s, p) => s + p.weight, 0) - 1) < 1e-9, "outfit weights sum to 1");
  expect(
    outfit.pieces.find((p) => p.role === "bottom")!.rules.filter((r) => !r.applicable).length >= 3,
    "bottom skips face rules"
  );
  expect(outfit.verdict === (outfit.score >= 70 ? "buy" : "fix"), "verdict matches threshold");
}
for (const p of Object.values(results))
  for (const s of Object.values(p)) expect(s >= 0 && s <= 100, `score ${s} within 0-100`);
process.exit(fail ? 1 : 0);
