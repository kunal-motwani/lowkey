import { beforeEach, describe, expect, it, vi } from "vitest";
import { solid } from "./helpers";
import type { OutfitScore, PieceRole, PieceScore } from "../lib/types";

vi.mock("../lib/youcam", () => ({
  GARMENT_CATEGORY: { top: "upper_body", bottom: "lower_body", jacket: "upper_body" },
  skinAnalysis: vi.fn(),
  skinTone: vi.fn(),
  clothesTryOn: vi.fn(),
  makeupTryOn: vi.fn(),
}));
vi.mock("../lib/outfit", () => ({ scoreOutfit: vi.fn(), rescueMakeupFor: vi.fn() }));
vi.mock("../lib/makeup-tips", () => ({ makeupTips: vi.fn() }));

import { InputError, runStylist, type AgentEvent } from "../lib/agent";
import { makeupTips } from "../lib/makeup-tips";
import { rescueMakeupFor, scoreOutfit } from "../lib/outfit";
import * as yc from "../lib/youcam";

const dataUrl = (s: string) => `data:image/jpeg;base64,${Buffer.from(s).toString("base64")}`;
const decode = (b: Buffer) => b.toString();
const PLAN = { lip: "#aa3355", blush: "#dd8877", concealer: "#e0b090", note: "Soften the contrast." };

function piece(role: PieceRole, score: number, withCf = true): PieceScore {
  return {
    role,
    hex: "#7d8239",
    score,
    weight: 1,
    base: 80,
    rules: [],
    reasons: [],
    counterfactuals: withCf ? [{ hex: "#1f2f5c", name: "Navy", score: 88, delta: 88 - score, why: "Cooler." }] : [],
  };
}
function outfit(score: number, pieces: PieceScore[]): OutfitScore {
  return {
    score,
    verdict: score >= 70 ? "buy" : "fix",
    threshold: 70,
    undertone: "warm",
    concerns: {},
    pieces,
    summary: ["Sentence one.", "Sentence two."],
  };
}

let n: number;
let tryOnCalls: { person: string; category: string }[];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  n = 0;
  tryOnCalls = [];
  vi.mocked(yc.skinAnalysis).mockResolvedValue({});
  vi.mocked(yc.skinTone).mockResolvedValue({ skin_color: "#e8c4b0", source: "local" });
  vi.mocked(yc.clothesTryOn).mockImplementation(async (person, _garment, category, opts) => {
    tryOnCalls.push({ person: decode(person), category: category as string });
    opts?.onCall?.({ api: "vto", cached: false });
    return dataUrl(`stage-${++n}`);
  });
  vi.mocked(yc.makeupTryOn).mockResolvedValue(dataUrl("makeup"));
  vi.mocked(rescueMakeupFor).mockReturnValue(PLAN);
  vi.mocked(makeupTips).mockReturnValue([{ area: "lip", tip: "t", why: "w" }]);
  vi.mocked(scoreOutfit).mockImplementation((ps) =>
    outfit(
      85,
      ps.map((p) => piece(p.role, 85, false))
    )
  );
});

const run = async (
  input: { body?: Buffer; roles: PieceRole[] },
  emit: (e: AgentEvent) => void = () => {},
  face?: Buffer
) =>
  runStylist(
    {
      face: face ?? Buffer.from("FACE"),
      body: input.body,
      pieces: await Promise.all(input.roles.map(async (role) => ({ role, image: await solid("#7d8239") }))),
    },
    emit
  );

describe("input validation", () => {
  it("throws InputError when there are no pieces", async () => {
    await expect(run({ roles: [] })).rejects.toBeInstanceOf(InputError);
    expect(yc.skinAnalysis).not.toHaveBeenCalled();
  });
  it("throws InputError for a bottom without a body photo", async () => {
    await expect(run({ roles: ["top", "bottom"] })).rejects.toThrow("Add a full-body photo to try on bottoms");
    expect(yc.skinAnalysis).not.toHaveBeenCalled();
  });
});

describe("buy path", () => {
  it("skips recolor and rescue and emits the other steps", async () => {
    const events: AgentEvent[] = [];
    const r = await run({ roles: ["top"] }, (e) => events.push(e));
    expect(r.outfit.verdict).toBe("buy");
    expect(r.better).toBeUndefined();
    expect(r.rescue).toBeUndefined();
    expect(yc.makeupTryOn).not.toHaveBeenCalled();
    expect(yc.clothesTryOn).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.status === "skipped").map((e) => e.step)).toEqual(["recolor", "rescue"]);
    const done = new Set(events.filter((e) => e.status === "done").map((e) => e.step));
    for (const s of ["perceive", "garments", "score", "decide", "tryon", "tips", "explain"]) {
      expect(done.has(s as never)).toBe(true);
    }
    expect(r.explanation).toMatch(/buy it/);
    expect(r.makeupTips).toHaveLength(1);
    expect(r.photoNotes).toContain("No body photo: chest-up try-on only");
    expect(r.errors).toEqual([]);
  });

  it("runs perceive on the face photo only", async () => {
    const face = Buffer.from("FACE-ONLY");
    await run({ body: Buffer.from("BODY"), roles: ["top"] }, () => {}, face);
    expect(vi.mocked(yc.skinAnalysis).mock.calls[0][0]).toBe(face);
    expect(vi.mocked(yc.skinTone).mock.calls[0][0]).toBe(face);
  });
});

describe("layering", () => {
  it("orders top, bottom, jacket, feeds each output into the next and uses categories", async () => {
    const r = await run({ body: Buffer.from("BODY"), roles: ["jacket", "bottom", "top"] });
    expect(tryOnCalls.map((c) => c.category)).toEqual(["upper_body", "lower_body", "upper_body"]);
    expect(tryOnCalls[0].person).toBe("BODY");
    expect(tryOnCalls[1].person).toBe("stage-1");
    expect(tryOnCalls[2].person).toBe("stage-2");
    expect(r.stages.map((s) => s.label)).toEqual(["Top", "+ Bottom", "+ Jacket"]);
    expect(r.stages.map((s) => s.roles)).toEqual([["top"], ["top", "bottom"], ["top", "bottom", "jacket"]]);
    expect(r.stages.every((s) => s.image)).toBe(true);
    expect(r.photoNotes).toEqual([]);
  });

  it("uses the face photo as the base person when there is no body photo", async () => {
    await run({ roles: ["top", "jacket"] });
    expect(tryOnCalls[0].person).toBe("FACE");
  });

  it("a failed stage records an error and the chain continues with the previous person image", async () => {
    vi.mocked(yc.clothesTryOn).mockReset();
    let call = 0;
    vi.mocked(yc.clothesTryOn).mockImplementation(async (person) => {
      tryOnCalls.push({ person: decode(person), category: "" });
      call++;
      if (call === 2) throw new Error("boom");
      return dataUrl(`stage-${call}`);
    });
    const r = await run({ body: Buffer.from("BODY"), roles: ["top", "bottom", "jacket"] });
    expect(r.stages[1].image).toBeUndefined();
    expect(r.stages[2].image).toBeDefined();
    expect(tryOnCalls[2].person).toBe("stage-1"); // stage 2 failed, so stage 3 builds on stage 1
    expect(r.errors).toContain("Try-on (Bottom): boom");
  });
});

describe("fix path", () => {
  beforeEach(() => {
    vi.mocked(scoreOutfit).mockImplementation((ps) =>
      outfit(
        50,
        ps.map((p, i) => piece(p.role, 40 + i * 10))
      )
    );
  });

  it("produces better and rescue for the lowest-scoring face-adjacent piece", async () => {
    const r = await run({ body: Buffer.from("BODY"), roles: ["top", "bottom", "jacket"] });
    expect(r.outfit.verdict).toBe("fix");
    expect(r.better).toMatchObject({ role: "top", hex: "#1f2f5c", name: "Navy", score: 88 });
    expect(r.better!.image).toBeDefined();
    // the recolour try-on runs on the FACE photo
    expect(tryOnCalls.slice(3).some((c) => c.person === "FACE")).toBe(true);
    expect(r.rescue?.image).toBe(dataUrl("makeup"));
    expect(r.rescue?.plan).toEqual(PLAN);
    expect(r.rescue?.baselineScore).toBe(50);
    expect(rescueMakeupFor).toHaveBeenCalledWith(r.outfit);
    expect(yc.makeupTryOn).toHaveBeenCalledTimes(1);
  });

  it("reuses the last stage image for rescue when the base person was the face photo", async () => {
    await run({ roles: ["top", "jacket"] });
    // 2 layering + 1 recolour; no extra rescue try-ons
    expect(yc.clothesTryOn).toHaveBeenCalledTimes(3);
    expect(decode(vi.mocked(yc.makeupTryOn).mock.calls[0][0] as Buffer)).toBe("stage-2");
  });

  it("falls back to makeup on the bare face photo when the try-on fails", async () => {
    vi.mocked(yc.clothesTryOn).mockRejectedValue(new Error("down"));
    const r = await run({ body: Buffer.from("BODY"), roles: ["top"] });
    expect(decode(vi.mocked(yc.makeupTryOn).mock.calls[0][0] as Buffer)).toBe("FACE");
    expect(r.rescue?.plan).toEqual(PLAN);
    expect(r.errors.some((e) => e.startsWith("Try-on (Top)"))).toBe(true);
  });

  it("a failing makeup try-on is recorded without throwing", async () => {
    vi.mocked(yc.makeupTryOn).mockRejectedValue(new Error("no makeup"));
    const r = await run({ roles: ["top"] });
    expect(r.errors).toContain("Makeup try-on: no makeup");
    expect(r.rescue?.image).toBeUndefined();
    expect(r.rescue?.plan.note).toBeTruthy();
  });

  it("skips recolor when only a bottom is present", async () => {
    const events: AgentEvent[] = [];
    const r = await run({ body: Buffer.from("BODY"), roles: ["bottom"] }, (e) => events.push(e));
    expect(r.better).toBeUndefined();
    expect(events.find((e) => e.step === "recolor" && e.status === "skipped")).toBeDefined();
  });
});

describe("unitsEstimate", () => {
  it("counts only calls that were not served from cache", async () => {
    vi.mocked(yc.skinAnalysis).mockImplementation(async (_i, opts) => {
      opts?.onCall?.({ api: "skin", cached: true });
      return {};
    });
    vi.mocked(yc.skinTone).mockImplementation(async (_i, opts) => {
      opts?.onCall?.({ api: "tone", cached: false });
      return { skin_color: "#e8c4b0", source: "local" };
    });
    let i = 0;
    vi.mocked(yc.clothesTryOn).mockImplementation(async (_p, _g, _c, opts) => {
      opts?.onCall?.({ api: "vto", cached: i++ === 0 }); // first try-on cached, second live
      return dataUrl("x");
    });
    const r = await run({ body: Buffer.from("BODY"), roles: ["top", "jacket"] });
    // tone (live) + one live try-on; skin and the other try-on were cache hits
    expect(r.unitsEstimate).toBe(2);
  });
});
