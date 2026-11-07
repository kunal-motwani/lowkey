import { describe, expect, it } from "vitest";

import {
  buildWaterfall,
  formatDelta,
  formatEvidence,
  groupPieces,
  groupTips,
  metalLabel,
  missingMessage,
  missingPhotosFor,
  splitStages,
  mutedReason,
  orderRules,
  safeHex,
  scoreTone,
  stepForError,
  weightPercents,
} from "../lib/explain-view";
import type { RuleResult } from "../lib/types";

const rule = (o: Partial<RuleResult>): RuleResult => ({
  rule: "r",
  label: "R",
  appliesTo: ["top"],
  applicable: true,
  triggered: true,
  delta: 0,
  evidence: [],
  explanation: "because",
  ...o,
});

describe("explain-view", () => {
  it("weightPercents sums to 100", () => {
    for (const w of [[1], [0.5, 0.3, 0.2], [1, 1, 1], [0.34, 0.33, 0.33], [0, 0], [3, 1]]) {
      expect(weightPercents(w).reduce((a, b) => a + b, 0)).toBe(100);
    }
    expect(weightPercents([])).toEqual([]);
    expect(weightPercents([1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("formats deltas and evidence", () => {
    expect(formatDelta(5)).toBe("+5");
    expect(formatDelta(-3.04)).toBe("-3");
    expect(formatDelta(0)).toBe("0");
    expect(formatDelta(undefined)).toBe("0");
    expect(formatEvidence({ label: "Dark circles", value: "62/100" })).toBe("Dark circles: 62/100");
    expect(formatEvidence({ label: "x" })).toBe("x");
    expect(formatEvidence(null)).toBe("");
  });

  it("orders triggered rules by |delta|, then quiet, then not applicable", () => {
    const out = orderRules([
      rule({ rule: "na", applicable: false, triggered: false }),
      rule({ rule: "small", delta: -2 }),
      rule({ rule: "quiet", triggered: false }),
      rule({ rule: "big", delta: 9 }),
    ]);
    expect(out.map((r) => r.rule)).toEqual(["big", "small", "quiet", "na"]);
    expect(orderRules(undefined)).toEqual([]);
  });

  it("builds a waterfall with running totals", () => {
    const w = buildWaterfall({
      base: 80,
      score: 71,
      rules: [
        rule({ rule: "a", delta: -4 }),
        rule({ rule: "b", delta: -8 }),
        rule({ rule: "c", delta: 3 }),
        rule({ rule: "q", triggered: false, delta: -50 }),
        rule({ rule: "n", applicable: false, triggered: false, delta: -50 }),
      ],
    });
    expect(w.segments.map((s) => s.rule)).toEqual(["b", "a", "c", "q", "n"]);
    expect(w.segments[0]).toMatchObject({ start: 80, end: 72, delta: -8, direction: "down" });
    expect(w.segments[2]).toMatchObject({ start: 68, end: 71, direction: "up" });
    expect(w.segments[3].delta).toBe(0);
    expect(w.adjustment).toBe(0);
    expect(w.segments.every((s) => s.left >= 0 && s.left + s.width <= 100.0001)).toBe(true);
  });

  it("reports clamping adjustments and handles no rules", () => {
    const w = buildWaterfall({ base: 90, score: 100, rules: [rule({ delta: 20 })] });
    expect(w.adjustment).toBe(-10);
    const empty = buildWaterfall({ base: 70, score: 70, rules: [] });
    expect(empty.segments).toEqual([]);
    expect(empty.finalWidth).toBeGreaterThan(0);
  });

  it("muted reasons", () => {
    expect(
      mutedReason(rule({ applicable: false, triggered: false, explanation: "bottoms are not near the face" }))
    ).toBe("Not evaluated: bottoms are not near the face");
    expect(mutedReason(rule({ triggered: false, explanation: "" }))).toMatch(/^Not triggered/);
    expect(mutedReason(rule({}))).toBe("");
  });

  it("groups tips in application order and tolerates missing input", () => {
    const g = groupTips([
      { area: "lip", tip: "a", why: "w" },
      { area: "base", tip: "b", why: "w" },
      { area: "lip", tip: "c", why: "w" },
    ]);
    expect(g.map((x) => x.area)).toEqual(["base", "lip"]);
    expect(g[1].tips).toHaveLength(2);
    expect(groupTips(undefined)).toEqual([]);
  });

  it("misc helpers", () => {
    expect(safeHex("#abc")).toBe("#abc");
    expect(safeHex("red; background:url(x)")).toBe("#9ca3af");
    expect(scoreTone(80)).toBe("good");
    expect(scoreTone(55)).toBe("warn");
    expect(scoreTone(30)).toBe("bad");
    expect(stepForError("Bottoms need a full-body photo")).toBe(2);
    expect(stepForError("No face found")).toBe(1);
    expect(stepForError("Could not fetch the product link")).toBe(3);
    expect(stepForError("boom")).toBe(4);
  });

  it("groups pieces by role group, keeping indices", () => {
    const g = groupPieces([{ role: "ring" }, { role: "top" }, { role: "shoes" }, { role: "necklace" }]);
    expect(g.map((x) => x.group)).toEqual(["clothing", "footwear", "jewellery"]);
    expect(g[2].items.map((i) => [i.piece.role, i.index])).toEqual([
      ["ring", 0],
      ["necklace", 3],
    ]);
    expect(groupPieces(undefined)).toEqual([]);
  });

  it("formats metals", () => {
    expect(metalLabel("gold")).toBe("Gold metal");
    expect(metalLabel("rose-gold")).toBe("Rose gold metal");
    expect(metalLabel("dark")).toBe("Dark metal");
    expect(metalLabel(undefined)).toBe("");
  });

  it("checks required photos from ROLE_REQUIRES", () => {
    expect(missingPhotosFor(["top", "necklace"], {})).toEqual([]);
    expect(missingPhotosFor(["bottom", "shoes", "ring"], { body: true })).toEqual([{ role: "ring", photo: "hand" }]);
    const m = missingPhotosFor(["bottom", "shoes", "bracelet"], {});
    expect(m).toHaveLength(3);
    expect(missingMessage(m)).toBe(
      "Bottom and Shoes need the full-body photo from step 2. Bracelet needs the hand photo from step 2. Add the photo, or remove those pieces."
    );
    expect(missingMessage([])).toBe("");
  });

  it("splits stages into outfit and close-ups", () => {
    const s = splitStages([
      { label: "Top", roles: ["top"] },
      { label: "Necklace", roles: ["necklace"], group: "closeup" },
      { label: "+ Shoes", roles: ["top", "shoes"], group: "outfit" },
    ]);
    expect(s.outfit.map((x) => x.label)).toEqual(["Top", "+ Shoes"]);
    expect(s.closeups).toHaveLength(1);
    expect(stepForError("Bracelets need a hand photo")).toBe(2);
    expect(stepForError("Could not read the shoes image")).toBe(3);
  });
});

describe("stepForError: image-quality rejections go to the face photo step", () => {
  it.each([
    "The input image is too dark for accurate analysis.",
    "The input image is too bright.",
    "The photo is blurry.",
    "No face was detected in the source image.",
    "The face in the input image is too small. It needs to take up more than 60% of the image width.",
  ])("%s", (msg) => {
    expect(stepForError(msg)).toBe(1);
  });
});
