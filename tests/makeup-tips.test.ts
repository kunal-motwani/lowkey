import { describe, expect, it } from "vitest";
import { makeupTips } from "../lib/makeup-tips";
import { scoreOutfit } from "../lib/outfit";

const warm = { skin_color: "#d9a07c", hair_color: "#3a2a20" };
const healthy = {
  dark_circle_v2: 90,
  redness: 90,
  radiance: 85,
  moisture: 85,
  oiliness: 90,
  texture: 85,
  age_spot: 85,
};
const rough = { dark_circle_v2: 20, redness: 20, radiance: 30, moisture: 30, oiliness: 25, texture: 60, age_spot: 60 };
const BRANDS = /sephora|maybelline|loreal|l'oreal|fenty|nars|revlon|clinique|estee|dior|chanel|covergirl|nyx/i;
const MEDICAL = /treat|cure|diagnos/i;

const build = (
  m: Record<string, number>,
  hex = "#7d8239",
  tone: { skin_color: string; hair_color?: string } = warm
) => {
  const outfit = scoreOutfit([{ role: "top", hex }], tone, m);
  return makeupTips(outfit, tone, m);
};

describe("makeupTips", () => {
  it("returns 4-7 well-formed tips even for healthy skin", () => {
    for (const m of [healthy, rough, {}])
      for (const hex of ["#7d8239", "#f0705a", "#1f2f5c", "#ffffff", "#000000"]) {
        const tips = build(m, hex);
        expect(tips.length).toBeGreaterThanOrEqual(4);
        expect(tips.length).toBeLessThanOrEqual(7);
        for (const t of tips) {
          expect(t.tip.length).toBeGreaterThan(20);
          expect(t.why.length).toBeGreaterThan(8);
          if (t.shade) expect(t.shade).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
  });

  it("is deterministic", () => {
    expect(build(rough)).toEqual(build(rough));
  });

  it("recommends peach/orange corrector for high dark circles, citing the metric", () => {
    const t = build(rough).find((x) => x.area === "concealer")!;
    expect(t.tip.toLowerCase()).toMatch(/peach|orange/);
    expect(t.tip.toLowerCase()).toContain("cosmetic");
    expect(t.why).toContain("80/100");
    expect(t.shade).toBe("#f2b48f");
  });

  it("recommends green-tinted primer for redness and a blush that avoids red-on-red", () => {
    const tips = build(rough, "#f0705a");
    expect(tips.some((x) => x.area === "skin-prep" && /green-tinted/.test(x.tip))).toBe(true);
    const blush = tips.find((x) => x.area === "blush")!;
    expect(blush.tip).toMatch(/red on red/);
    expect(blush.why).toContain("#f0705a");
  });

  it("covers oiliness and dullness in skin prep", () => {
    const prep = build(rough)
      .filter((x) => x.area === "skin-prep")
      .map((x) => x.tip.toLowerCase())
      .join(" ");
    expect(prep).toContain("mattifying");
    expect(prep).toContain("hydrating");
  });

  it("covers enhancement areas for healthy skin", () => {
    const areas = build(healthy, "#1f2f5c").map((x) => x.area);
    for (const a of ["concealer", "skin-prep", "base", "blush", "lip", "eyes", "brows"]) expect(areas).toContain(a);
  });

  it("chooses base depth from skin lightness", () => {
    const light = build(healthy, "#1f2f5c", { skin_color: "#f3d5c3" }).find((x) => x.area === "base")!;
    const deep = build(healthy, "#1f2f5c", { skin_color: "#6b4430" }).find((x) => x.area === "base")!;
    expect(light.tip).toContain("light range");
    expect(deep.tip).toContain("deep range");
    expect(light.why).toContain("L*");
  });

  it("picks a lip that does not compete with a saturated red garment", () => {
    expect(build(healthy, "#d83020").find((x) => x.area === "lip")!.shade).toBe("#b57a72");
  });

  it("avoids brand names and medical claims", () => {
    for (const m of [healthy, rough])
      for (const hex of ["#7d8239", "#f0705a", "#1f2f5c"])
        for (const t of build(m, hex)) {
          const text = `${t.tip} ${t.why}`;
          expect(text).not.toMatch(BRANDS);
          expect(text).not.toMatch(MEDICAL);
        }
  });
});
