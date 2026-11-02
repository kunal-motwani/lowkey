import { describe, expect, it } from "vitest";
import { bestColorways, concernSeverity, rescueMakeup, scoreGarment, undertoneOf } from "../lib/flattery";

const G = { olive: "#7d8239", coral: "#f0705a", navy: "#1f2f5c" } as const;
const warm = { skin_color: "#d9a07c" };
const base = { dark_circle_v2: 90, redness: 90, radiance: 70, moisture: 70, oiliness: 70, texture: 70, age_spot: 70 };

const scores = (m: Record<string, number>, tone = warm) =>
  Object.fromEntries(Object.entries(G).map(([k, hex]) => [k, scoreGarment(hex, tone, m).score]));

describe("scoreGarment", () => {
  it("scores olive lowest when dark circles are high", () => {
    const s = scores({ ...base, dark_circle_v2: 25 });
    expect(s.olive).toBeLessThan(s.coral);
    expect(s.olive).toBeLessThan(s.navy);
  });

  it("scores coral lowest when redness is high", () => {
    const s = scores({ ...base, redness: 25 });
    expect(s.coral).toBeLessThan(s.olive);
    expect(s.coral).toBeLessThan(s.navy);
  });

  it("keeps navy high on low-concern skin and best when both concerns are high", () => {
    const low = {
      dark_circle_v2: 85,
      redness: 85,
      radiance: 80,
      moisture: 80,
      oiliness: 80,
      texture: 80,
      age_spot: 80,
    };
    expect(scoreGarment(G.navy, { skin_color: "#e8c4b0" }, low).score).toBeGreaterThanOrEqual(75);
    const both = scores({ ...base, dark_circle_v2: 30, redness: 30 });
    expect(both.navy).toBeGreaterThan(both.olive);
    expect(both.navy).toBeGreaterThan(both.coral);
  });

  it("keeps scores integer and within 0-100 across extremes", () => {
    for (const hex of ["#000000", "#ffffff", ...Object.values(G)])
      for (const v of [0, 50, 100]) {
        const m = Object.fromEntries(Object.keys(base).map((k) => [k, v]));
        const s = scoreGarment(hex, warm, m).score;
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
        expect(Number.isInteger(s)).toBe(true);
      }
  });

  it("ties the top reason to the metric that drives it", () => {
    const dc = scoreGarment(G.olive, warm, { ...base, dark_circle_v2: 25 });
    expect(dc.reasons[0].rule).toBe("sallow-reflection");
    expect(dc.reasons[0].metric).toBe("Dark circles");
    const red = scoreGarment(G.coral, warm, { ...base, redness: 25 });
    expect(red.reasons[0].rule).toBe("redness-echo");
    expect(red.reasons[0].metric).toBe("Redness");
  });

  it("returns at most two reasons sorted by penalty, with a harmony fallback", () => {
    const f = scoreGarment(G.olive, warm, { ...base, dark_circle_v2: 20, redness: 20, radiance: 20 });
    expect(f.reasons.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < f.reasons.length; i++)
      expect(f.reasons[i - 1].penalty).toBeGreaterThanOrEqual(f.reasons[i].penalty);
    expect(scoreGarment(G.navy, { skin_color: "#e8c4b0" }, base).reasons.length).toBeGreaterThan(0);
  });

  it("never makes precise optical claims with a percent sign", () => {
    const profiles = [{ ...base, dark_circle_v2: 20 }, { ...base, redness: 20 }, base, {}];
    for (const m of profiles)
      for (const hex of Object.values(G)) {
        const f = scoreGarment(hex, warm, m);
        for (const r of f.reasons) expect(r.text).not.toContain("%");
        expect(rescueMakeup(f).note).not.toContain("%");
      }
  });
});

describe("concernSeverity / undertoneOf", () => {
  it("inverts ui_score and defaults missing metrics", () => {
    const c = concernSeverity({ dark_circle_v2: 20 });
    expect(c.darkCircles).toBe(80);
    expect(c.redness).toBe(30);
  });
  it("classifies undertones", () => {
    expect(undertoneOf({ skin_color: "#e0b050" })).toBe("warm");
    expect(undertoneOf({ skin_color: "#e8b4c0" })).toBe("cool");
    expect(undertoneOf({ skin_color: "#d9a07c" })).toBe("neutral");
  });
});

describe("bestColorways", () => {
  it("returns n ranked candidates", () => {
    const ways = bestColorways(G.olive, warm, { ...base, dark_circle_v2: 25 }, 3);
    expect(ways).toHaveLength(3);
    for (let i = 1; i < ways.length; i++) expect(ways[i - 1].score).toBeGreaterThanOrEqual(ways[i].score);
    expect(ways.every((w) => /^#[0-9a-f]{6}$/.test(w.hex))).toBe(true);
  });
});
