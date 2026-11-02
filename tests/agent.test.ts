import { beforeEach, describe, expect, it, vi } from "vitest";
import { solid } from "./helpers";

vi.mock("../lib/youcam", () => ({
  skinAnalysis: vi.fn(),
  skinTone: vi.fn(),
  clothesTryOn: vi.fn(),
  makeupTryOn: vi.fn(),
}));

import { runStylist, type AgentEvent } from "../lib/agent";
import * as yc from "../lib/youcam";

const IMG = "data:image/jpeg;base64,AAAA";
const lowConcern = {
  dark_circle_v2: 85,
  redness: 85,
  radiance: 80,
  moisture: 80,
  oiliness: 80,
  texture: 80,
  age_spot: 80,
};
const darkCircles = { ...lowConcern, dark_circle_v2: 25 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.mocked(yc.skinTone).mockResolvedValue({ skin_color: "#e8c4b0", source: "local" });
  vi.mocked(yc.clothesTryOn).mockResolvedValue(IMG);
  vi.mocked(yc.makeupTryOn).mockResolvedValue(IMG);
});

describe("runStylist", () => {
  it("buy path (score >= 70) skips recolor and rescue", async () => {
    vi.mocked(yc.skinAnalysis).mockResolvedValue(lowConcern);
    const events: AgentEvent[] = [];
    const r = await runStylist(await solid("#ffffff"), await solid("#1f2f5c"), (e) => events.push(e));
    expect(r.flattery.score).toBeGreaterThanOrEqual(70);
    expect(r.verdict).toBe("buy");
    expect(r.better).toBeUndefined();
    expect(r.rescue).toBeUndefined();
    expect(yc.clothesTryOn).toHaveBeenCalledTimes(1);
    expect(yc.makeupTryOn).not.toHaveBeenCalled();
    expect(events.filter((e) => e.status === "skipped").map((e) => e.step)).toEqual(["recolor", "rescue"]);
    expect(r.explanation).toMatch(/buy it/);
    expect(r.errors).toEqual([]);
  });

  it("fix path produces a better colour and a rescue plan", async () => {
    vi.mocked(yc.skinAnalysis).mockResolvedValue(darkCircles);
    const r = await runStylist(await solid("#ffffff"), await solid("#7d8239"), () => {});
    expect(r.flattery.score).toBeLessThan(70);
    expect(r.verdict).toBe("fix");
    expect(r.better).toBeDefined();
    expect(r.better!.score).toBeGreaterThan(r.flattery.score);
    expect(r.better!.image).toBe(IMG);
    expect(r.better!.alternatives).toHaveLength(3);
    expect(r.rescue?.image).toBe(IMG);
    expect(r.rescue?.baselineScore).toBe(r.flattery.score);
    expect(yc.clothesTryOn).toHaveBeenCalledTimes(2);
    expect(yc.makeupTryOn).toHaveBeenCalledTimes(1);
  });

  it("a failing try-on still returns score and reasons and records the error", async () => {
    vi.mocked(yc.skinAnalysis).mockResolvedValue(darkCircles);
    vi.mocked(yc.clothesTryOn).mockRejectedValue(new Error("boom"));
    const r = await runStylist(await solid("#ffffff"), await solid("#7d8239"), () => {});
    expect(r.flattery.score).toBeGreaterThanOrEqual(0);
    expect(r.flattery.reasons.length).toBeGreaterThan(0);
    expect(r.originalTryOn).toBeUndefined();
    expect(r.errors).toContain("Clothes try-on: boom");
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
    expect(r.explanation.length).toBeGreaterThan(0);
  });

  it("a failing makeup try-on is recorded without throwing", async () => {
    vi.mocked(yc.skinAnalysis).mockResolvedValue(darkCircles);
    vi.mocked(yc.makeupTryOn).mockRejectedValue(new Error("no makeup"));
    const r = await runStylist(await solid("#ffffff"), await solid("#7d8239"), () => {});
    expect(r.errors).toContain("Makeup try-on: no makeup");
    expect(r.rescue?.image).toBeUndefined();
    expect(r.rescue?.plan.note).toBeTruthy();
  });
});
