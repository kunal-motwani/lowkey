import { describe, expect, it } from "vitest";
import { ROLE_WEIGHT, scorePiece } from "../lib/flattery";
import { rescueMakeupFor, scoreOutfit } from "../lib/outfit";
import type { PieceRole } from "../lib/types";

const warm = { skin_color: "#d9a07c" };
const base = { dark_circle_v2: 90, redness: 90, radiance: 70, moisture: 70, oiliness: 70, texture: 70, age_spot: 70 };
const OLIVE = "#7d8239";
const CORAL = "#f0705a";
const NAVY = "#1f2f5c";
const GREY = "#777777";

const pair = (o: ReturnType<typeof scoreOutfit>, role: PieceRole) =>
  o.pieces.find((p) => p.role === role)!.rules.find((r) => r.rule === "pair-harmony")!;

describe("scoreOutfit", () => {
  it("throws on empty input and duplicate roles", () => {
    expect(() => scoreOutfit([], warm, base)).toThrow(/at least one piece/);
    expect(() =>
      scoreOutfit(
        [
          { role: "top", hex: NAVY },
          { role: "top", hex: OLIVE },
        ],
        warm,
        base
      )
    ).toThrow(/more than once/);
  });

  it("normalises weights to 1 for any subset of pieces", () => {
    const sets: PieceRole[][] = [
      ["top"],
      ["bottom"],
      ["top", "bottom"],
      ["top", "jacket"],
      ["top", "bottom", "jacket"],
    ];
    for (const roles of sets) {
      const o = scoreOutfit(
        roles.map((role) => ({ role, hex: NAVY })),
        warm,
        base
      );
      expect(o.pieces.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 10);
    }
    expect(ROLE_WEIGHT.top + ROLE_WEIGHT.jacket + ROLE_WEIGHT.bottom).toBeCloseTo(1, 10);
  });

  it("weights top highest, then jacket, then bottom", () => {
    const o = scoreOutfit(
      [
        { role: "bottom", hex: GREY },
        { role: "jacket", hex: NAVY },
        { role: "top", hex: NAVY },
      ],
      warm,
      base
    );
    const w = Object.fromEntries(o.pieces.map((p) => [p.role, p.weight]));
    expect(w.top).toBeCloseTo(0.5);
    expect(w.jacket).toBeCloseTo(0.35);
    expect(w.bottom).toBeCloseTo(0.15);
  });

  it("score is the rounded weighted mean of piece scores", () => {
    const o = scoreOutfit(
      [
        { role: "top", hex: OLIVE },
        { role: "bottom", hex: NAVY },
      ],
      warm,
      { ...base, dark_circle_v2: 25 }
    );
    expect(o.score).toBe(Math.round(o.pieces.reduce((s, p) => s + p.weight * p.score, 0)));
    expect(o.threshold).toBe(70);
  });

  it("passes the top colour as pairing context to other pieces", () => {
    const o = scoreOutfit(
      [
        { role: "top", hex: NAVY },
        { role: "bottom", hex: "#1f2f5d" },
      ],
      warm,
      base
    );
    expect(pair(o, "bottom").applicable).toBe(true);
    expect(pair(o, "bottom").delta).toBe(-3);
    expect(pair(o, "top").applicable).toBe(false);
  });

  it("uses the jacket as the anchor when there is no top", () => {
    const o = scoreOutfit(
      [
        { role: "jacket", hex: NAVY },
        { role: "bottom", hex: GREY },
      ],
      warm,
      base
    );
    expect(pair(o, "bottom").applicable).toBe(true);
    expect(pair(o, "jacket").applicable).toBe(false);
  });

  it("flips verdict exactly at the 70 threshold (69 -> fix, 70 -> buy)", () => {
    const byScore = new Map<number, number>();
    for (let v = 0; v <= 100; v++)
      byScore.set(scoreOutfit([{ role: "top", hex: OLIVE }], warm, { ...base, dark_circle_v2: v }).score, v);
    const v69 = byScore.get(69);
    const v70 = byScore.get(70);
    expect(v69).toBeDefined();
    expect(v70).toBeDefined();
    const at = (v: number) => scoreOutfit([{ role: "top", hex: OLIVE }], warm, { ...base, dark_circle_v2: v });
    expect(at(v69!).verdict).toBe("fix");
    expect(at(v70!).verdict).toBe("buy");
  });

  it("summary has 2-4 sentences and names the dominant piece and its impact", () => {
    const o = scoreOutfit(
      [
        { role: "top", hex: OLIVE },
        { role: "bottom", hex: NAVY },
        { role: "jacket", hex: NAVY },
      ],
      warm,
      { ...base, dark_circle_v2: 20 }
    );
    expect(o.summary.length).toBeGreaterThanOrEqual(2);
    expect(o.summary.length).toBeLessThanOrEqual(4);
    const text = o.summary.join(" ").toLowerCase();
    expect(text).toContain(String(o.score));
    expect(text).toContain("the top moved the score most");
    expect(text).toContain("yellow-green cast near the eyes");
    expect(text).toContain("about");
    expect(text).not.toContain("%");
  });

  it("summary offers a swap whose lift matches the counterfactual", () => {
    const o = scoreOutfit([{ role: "top", hex: OLIVE }], warm, { ...base, dark_circle_v2: 20 });
    const cf = o.pieces[0].counterfactuals[0];
    const text = o.summary.join(" ");
    expect(text).toContain(cf.hex);
    expect(text).toContain(`+${cf.delta}`);
  });

  it("matches scorePiece for a lone top", () => {
    const m = { ...base, redness: 25 };
    const o = scoreOutfit([{ role: "top", hex: CORAL }], warm, m);
    expect(o.score).toBe(scorePiece("top", CORAL, warm, m).score);
    expect(o.verdict).toBe(o.score >= 70 ? "buy" : "fix");
  });
});

describe("rescueMakeupFor", () => {
  it("returns hex swatches and a note tied to the biggest problem", () => {
    const o = scoreOutfit([{ role: "top", hex: CORAL }], warm, { ...base, redness: 25 });
    const r = rescueMakeupFor(o);
    expect(r.blush).toBe("#d9a08f");
    for (const k of ["lip", "blush", "concealer"] as const) expect(r[k]).toMatch(/^#[0-9a-f]{6}$/);
    expect(r.note).not.toContain("%");
    const o2 = scoreOutfit([{ role: "top", hex: OLIVE }], warm, { ...base, dark_circle_v2: 20 });
    expect(rescueMakeupFor(o2).concealer).toBe("#f2b48f");
  });
});
