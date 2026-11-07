import { describe, expect, it } from "vitest";
import { bestColorways, concernSeverity, rescueMakeup, scoreGarment, scorePiece, undertoneOf } from "../lib/flattery";

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

describe("scorePiece", () => {
  const dc = { ...base, dark_circle_v2: 25 };
  const faceRules = ["sallow-reflection", "redness-echo", "wash-out"];
  const rule = (p: ReturnType<typeof scorePiece>, id: string) => p.rules.find((r) => r.rule === id)!;

  it("returns every rule with evidence and an explanation", () => {
    const p = scorePiece("top", G.olive, warm, dc);
    const ids = p.rules.map((r) => r.rule);
    for (const id of [
      ...faceRules,
      "undertone-clash",
      "cool-jewel-harmony",
      "warm-mid-tone-harmony",
      "healthy-contrast",
    ])
      expect(ids).toContain(id);
    for (const r of p.rules) expect(r.explanation.length).toBeGreaterThan(10);
    expect(p.base).toBe(84);
  });

  it("formats evidence for humans", () => {
    const sallow = rule(scorePiece("top", G.olive, warm, dc), "sallow-reflection");
    expect(sallow.triggered).toBe(true);
    expect(sallow.delta).toBeLessThan(0);
    expect(sallow.evidence[0]).toEqual({ label: "Dark circles", value: "75/100 (high)" });
    expect(sallow.evidence[1].value).toContain("#7d8239");
  });

  it("score equals clamp(base + sum of deltas)", () => {
    for (const hex of Object.values(G))
      for (const m of [dc, { ...base, redness: 25 }, base]) {
        const p = scorePiece("top", hex, warm, m);
        const sum = p.rules.reduce((s, r) => s + r.delta, 0);
        expect(p.score).toBe(Math.round(Math.max(0, Math.min(100, p.base + sum))));
      }
  });

  it("matches scoreGarment for a top without context", () => {
    for (const hex of Object.values(G))
      expect(scorePiece("top", hex, warm, dc).score).toBe(scoreGarment(hex, warm, dc).score);
  });

  it("skips face-reflection rules for bottoms", () => {
    const p = scorePiece("bottom", G.olive, warm, { ...dc, redness: 25 });
    for (const id of faceRules) {
      const r = rule(p, id);
      expect(r.applicable).toBe(false);
      expect(r.triggered).toBe(false);
      expect(r.delta).toBe(0);
      expect(r.explanation).toBe(
        "Not evaluated: trousers/skirts sit far from the face, so their colour has little effect on how your face looks."
      );
    }
    expect(p.score).toBeGreaterThanOrEqual(80);
  });

  it("applies half-strength undertone clash to bottoms", () => {
    const cool = { skin_color: "#e8b4c0" };
    expect(rule(scorePiece("top", "#8a5a2b", cool, base), "undertone-clash").delta).toBe(-22);
    expect(rule(scorePiece("bottom", "#8a5a2b", cool, base), "undertone-clash").delta).toBe(-11);
  });

  it("pair-harmony only applies to non-top pieces with context", () => {
    expect(rule(scorePiece("top", G.navy, warm, base, { topHex: G.olive }), "pair-harmony").applicable).toBe(false);
    expect(rule(scorePiece("bottom", G.navy, warm, base), "pair-harmony").applicable).toBe(false);
    const withCtx = rule(scorePiece("bottom", G.navy, warm, base, { topHex: "#e8e8e8" }), "pair-harmony");
    expect(withCtx.applicable).toBe(true);
    expect(withCtx.delta).toBe(0);
  });

  it("penalises clashing saturated hues and near-identical colours mildly", () => {
    const clash = rule(scorePiece("bottom", "#22aa44", warm, base, { topHex: "#e0a020" }), "pair-harmony");
    expect(clash.triggered).toBe(true);
    expect(clash.delta).toBeLessThan(-5);
    const same = rule(scorePiece("bottom", "#1f2f5d", warm, base, { topHex: G.navy }), "pair-harmony");
    expect(same.delta).toBe(-3);
    const analogous = rule(scorePiece("bottom", "#6fa0d8", warm, base, { topHex: G.navy }), "pair-harmony");
    expect(analogous.delta).toBeGreaterThan(0);
  });

  it("never shows percent signs in rule text", () => {
    for (const hex of Object.values(G))
      for (const r of scorePiece("jacket", hex, warm, dc, { topHex: G.navy }).rules)
        expect(r.explanation).not.toContain("%");
  });

  it("counterfactual deltas match rescoring and explain which rules change", () => {
    const p = scorePiece("top", G.olive, warm, dc);
    expect(p.counterfactuals.length).toBe(3);
    for (const cf of p.counterfactuals) {
      expect(cf.score - p.score).toBe(cf.delta);
      expect(scorePiece("top", cf.hex, warm, dc).score).toBe(cf.score);
      expect(cf.why.length).toBeGreaterThan(5);
    }
    expect(p.counterfactuals[0].delta).toBeGreaterThan(0);
    expect(p.counterfactuals[0].why).toMatch(/avoids the .* rule \(\+\d+\)/);
    for (let i = 1; i < 3; i++)
      expect(p.counterfactuals[i - 1].score).toBeGreaterThanOrEqual(p.counterfactuals[i].score);
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
