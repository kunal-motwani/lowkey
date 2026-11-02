import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "./helpers";

type YouCam = typeof import("../lib/youcam");
const KEYS = ["YOUCAM_API_KEY", "YOUCAM_KEY_SKIN", "YOUCAM_KEY_TONE", "YOUCAM_KEY_CLOTHES", "YOUCAM_KEY_MAKEUP"];

let dir: string;
let fetchMock: ReturnType<typeof vi.fn>;

async function load(): Promise<YouCam> {
  vi.resetModules();
  return import("../lib/youcam");
}

const initOk = () =>
  jsonResponse({
    status: 200,
    data: {
      files: [{ file_id: "file-1", requests: [{ url: "https://upload.test/put", method: "PUT", headers: {} }] }],
    },
  });
const taskOk = () => jsonResponse({ status: 200, data: { task_id: "task-1" } });
const pollWith = (data: object) => jsonResponse({ status: 200, data });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "flattr-cache-"));
  vi.stubEnv("FLATTR_CACHE_DIR", dir);
  vi.stubEnv("DEMO_MODE", "");
  for (const k of KEYS) vi.stubEnv(k, "");
  vi.stubEnv("YOUCAM_API_KEY", "test-generic-key");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("skinAnalysis flow", () => {
  it("uploads, creates a task, polls and maps ui_score by type", async () => {
    const yc = await load();
    fetchMock
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(taskOk())
      .mockResolvedValueOnce(
        pollWith({
          task_status: "success",
          results: {
            output: [
              { type: "redness", ui_score: 41 },
              { type: "dark_circle_v2", ui_score: 77 },
            ],
          },
        })
      );
    const m = await yc.skinAnalysis(Buffer.from("selfie-1"));
    expect(m).toEqual({ redness: 41, dark_circle_v2: 77 });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("/s2s/v2.0/file");
    expect(urls[1]).toBe("https://upload.test/put");
    expect(urls[2]).toContain("/s2s/v2.0/task/skin-analysis");
    expect(urls[3]).toContain("/s2s/v2.0/task/skin-analysis/task-1");
    expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
    // result was persisted to the temp cache dir
    expect(fs.readdirSync(dir).some((f) => f.startsWith("skin_"))).toBe(true);
  });

  it("serves a repeat call from the cache with no further fetch", async () => {
    const yc = await load();
    const img = Buffer.from("selfie-cached");
    yc.cachePut("skin_" + yc.sha(img), { redness: 10 });
    const m = await yc.skinAnalysis(img);
    expect(m).toEqual({ redness: 10 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a failed task as an error", async () => {
    const yc = await load();
    fetchMock
      .mockResolvedValueOnce(initOk())
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(taskOk())
      .mockResolvedValueOnce(pollWith({ task_status: "error", error_message: "no face" }));
    await expect(yc.skinAnalysis(Buffer.from("selfie-err"))).rejects.toThrow(/task failed: no face/);
  });

  it("rejects when the upload PUT fails", async () => {
    const yc = await load();
    fetchMock.mockResolvedValueOnce(initOk()).mockResolvedValueOnce(new Response("", { status: 403 }));
    await expect(yc.uploadFile(Buffer.from("x"), "skin-analysis")).rejects.toThrow(/Upload PUT failed 403/);
  });

  it("rejects on API-level error status", async () => {
    const yc = await load();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 400, error: "bad_request" }, 400));
    await expect(yc.createTask("skin-analysis", {})).rejects.toThrow(/bad_request/);
  });
});

describe("pollTask", () => {
  it("keeps polling while the task is running", async () => {
    vi.useFakeTimers();
    const yc = await load();
    fetchMock
      .mockResolvedValueOnce(pollWith({ task_status: "running" }))
      .mockResolvedValueOnce(pollWith({ task_status: "success", results: {} }));
    const p = yc.pollTask("skin-analysis", "t1");
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toMatchObject({ task_status: "success" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("times out when the task never completes", async () => {
    vi.useFakeTimers();
    const yc = await load();
    fetchMock.mockImplementation(async () => pollWith({ task_status: "running" }));
    const assertion = expect(yc.pollTask("skin-analysis", "t1", 5000)).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });
});

describe("API key selection", () => {
  const authOf = (call: unknown[]) => (call[1] as { headers: Record<string, string> }).headers.Authorization;

  it("prefers the per-API key", async () => {
    vi.stubEnv("YOUCAM_KEY_SKIN", "skin-specific");
    const yc = await load();
    fetchMock.mockResolvedValueOnce(initOk()).mockResolvedValueOnce(new Response("", { status: 200 }));
    await yc.uploadFile(Buffer.from("a"), "skin-analysis");
    expect(authOf(fetchMock.mock.calls[0])).toBe("Bearer skin-specific");
  });

  it("falls back to YOUCAM_API_KEY", async () => {
    const yc = await load();
    fetchMock.mockResolvedValueOnce(initOk()).mockResolvedValueOnce(new Response("", { status: 200 }));
    await yc.uploadFile(Buffer.from("b"), "skin-analysis");
    expect(authOf(fetchMock.mock.calls[0])).toBe("Bearer test-generic-key");
  });

  it("uses each API's own key variable", async () => {
    vi.stubEnv("YOUCAM_KEY_CLOTHES", "clothes-specific");
    const yc = await load();
    fetchMock.mockResolvedValueOnce(initOk()).mockResolvedValueOnce(new Response("", { status: 200 }));
    await yc.uploadFile(Buffer.from("c"), "cloth-v4");
    expect(authOf(fetchMock.mock.calls[0])).toBe("Bearer clothes-specific");
  });

  it("throws when no key is configured", async () => {
    vi.stubEnv("YOUCAM_API_KEY", "");
    const yc = await load();
    expect(yc.hasYoucamKey()).toBe(false);
    await expect(yc.uploadFile(Buffer.from("d"), "skin-analysis")).rejects.toThrow(/YOUCAM_KEY_SKIN missing/);
  });
});

describe("DEMO_MODE", () => {
  it("throws on a cache miss when no key is set", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("YOUCAM_API_KEY", "");
    const yc = await load();
    await expect(yc.skinAnalysis(Buffer.from("never-seen"))).rejects.toThrow(/DEMO_MODE: no cached result/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still serves cached results", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("YOUCAM_API_KEY", "");
    const yc = await load();
    const img = Buffer.from("seen");
    yc.cachePut("skin_" + yc.sha(img), { texture: 5 });
    await expect(yc.skinAnalysis(img)).resolves.toEqual({ texture: 5 });
  });
});

describe("skinTone", () => {
  it("falls back to a local estimate when the API fails", async () => {
    const yc = await load();
    fetchMock.mockRejectedValue(new Error("network down"));
    const { default: sharp } = await import("sharp");
    const img = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#d9a07c" } })
      .png()
      .toBuffer();
    const t = await yc.skinTone(img);
    expect(t.source).toBe("local");
    expect(t.skin_color).toBe("#d9a07c");
  });
});

describe("cache dir override", () => {
  it("writes into FLATTR_CACHE_DIR", async () => {
    const yc = await load();
    yc.cachePut("k", { a: 1 });
    yc.cachePutBin("b.jpg", Buffer.from("zz"));
    expect(fs.existsSync(path.join(dir, "k.json"))).toBe(true);
    expect(yc.cacheGet("k")).toEqual({ a: 1 });
    expect(yc.cacheGetBin("b.jpg")?.toString()).toBe("zz");
    expect(yc.cacheGet("missing")).toBeNull();
  });
});
