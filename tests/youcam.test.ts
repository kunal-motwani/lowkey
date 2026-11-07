import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "./helpers";

type YouCam = typeof import("../lib/youcam");
const KEYS = [
  "YOUCAM_API_KEY",
  "YOUCAM_KEY_SKIN",
  "YOUCAM_KEY_TONE",
  "YOUCAM_KEY_CLOTHES",
  "YOUCAM_KEY_MAKEUP",
  "YOUCAM_KEY_SHOES",
  "YOUCAM_KEY_JEWELLERY",
];

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

describe("clothesTryOn", () => {
  const runTryOn = (yc: YouCam, category: "upper_body" | "lower_body", onCall: (i: { cached: boolean }) => void) => {
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      const u = String(url);
      if (u.endsWith("/s2s/v2.0/file")) return initOk();
      if (u === "https://upload.test/put") return new Response("", { status: 200 });
      if (u.includes("/task/cloth-v4/task-1"))
        return pollWith({ task_status: "success", results: { url: "https://result.test/r.jpg" } });
      if (u.includes("/task/cloth-v4") && init?.method === "POST") return taskOk();
      if (u === "https://result.test/r.jpg") return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      throw new Error("unexpected " + u);
    });
    return yc.clothesTryOn(Buffer.from("person"), Buffer.from("garment"), category, { onCall });
  };
  const taskBody = () => {
    const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/task/cloth-v4"));
    return JSON.parse((call![1] as { body: string }).body);
  };

  it("maps roles to categories in one place", async () => {
    const yc = await load();
    expect(yc.GARMENT_CATEGORY).toEqual({ top: "upper_body", bottom: "lower_body", jacket: "upper_body" });
  });

  it("sends the category in the request and keys the cache on it", async () => {
    const yc = await load();
    const seen: boolean[] = [];
    const onCall = (i: { cached: boolean }) => seen.push(i.cached);
    const first = await runTryOn(yc, "upper_body", onCall);
    expect(first).toMatch(/^data:image\/jpeg;base64,/);
    expect(taskBody().garment_category).toBe("upper_body");
    expect(fs.readdirSync(dir).some((f) => f.startsWith("vto_") && f.endsWith("_upper_body.jpg"))).toBe(true);

    // same inputs: cache hit, reported as cached, no fetch
    fetchMock.mockClear();
    await runTryOn(yc, "upper_body", onCall);
    expect(fetchMock).not.toHaveBeenCalled();

    // different category: separate cache entry, live call with the new category
    await runTryOn(yc, "lower_body", onCall);
    expect(taskBody().garment_category).toBe("lower_body");
    expect(seen).toEqual([false, true, false]);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith("vto_")).length).toBe(2);
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

describe("shoesTryOn and jewelleryTryOn", () => {
  const mockFlow = (pollPath: string, result: object = { url: "https://result.test/r.jpg" }) => {
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      const u = String(url);
      if (u.endsWith("/s2s/v2.0/file")) return initOk();
      if (u === "https://upload.test/put") return new Response("", { status: 200 });
      if (u.endsWith(pollPath + "/task-1")) return pollWith({ task_status: "success", results: result });
      if (u.endsWith(pollPath) && init?.method === "POST") return taskOk();
      if (u === "https://result.test/r.jpg") return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      throw new Error("unexpected " + u);
    });
  };
  const postBody = (suffix: string) => {
    const call = fetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith(suffix) && (c[1] as { method?: string }).method === "POST"
    );
    return JSON.parse((call![1] as { body: string }).body);
  };
  const authFor = (suffix: string) =>
    (fetchMock.mock.calls.find((c) => String(c[0]).endsWith(suffix))![1] as { headers: Record<string, string> }).headers
      .Authorization;

  it("keeps endpoints in exported tables", async () => {
    const yc = await load();
    expect(yc.SHOES_TASK.path).toBe("shoes-transfer");
    expect(Object.fromEntries(Object.entries(yc.JEWELLERY_TASK).map(([k, v]) => [k, v.path]))).toEqual({
      necklace: "2d-vto/necklace",
      earrings: "2d-vto/earring",
      bracelet: "2d-vto/bracelet",
      ring: "2d-vto/ring",
    });
  });

  it("shoes: posts src_file_id + ref_file_id only, caches by both images, reports cached", async () => {
    const yc = await load();
    mockFlow("/task/shoes-transfer");
    const seen: boolean[] = [];
    const onCall = (i: { cached: boolean }) => seen.push(i.cached);
    const img = await yc.shoesTryOn(Buffer.from("body"), Buffer.from("shoe"), { onCall });
    expect(img).toMatch(/^data:image\/jpeg;base64,/);
    expect(postBody("/task/shoes-transfer")).toEqual({ src_file_id: "file-1", ref_file_id: "file-1" });
    fetchMock.mockClear();
    await yc.shoesTryOn(Buffer.from("body"), Buffer.from("shoe"), { onCall });
    expect(fetchMock).not.toHaveBeenCalled();
    await yc.shoesTryOn(Buffer.from("body"), Buffer.from("other-shoe"), { onCall });
    expect(seen).toEqual([false, true, false]);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith("shoes_")).length).toBe(2);
  });

  it("shoes: sends gender/style only when given and uses the per-API key", async () => {
    vi.stubEnv("YOUCAM_KEY_SHOES", "shoes-specific");
    const yc = await load();
    mockFlow("/task/shoes-transfer");
    await yc.shoesTryOn(Buffer.from("b2"), Buffer.from("s2"), { gender: "female", style: "random" });
    expect(postBody("/task/shoes-transfer")).toMatchObject({ gender: "female", style: "random" });
    expect(authFor("/s2s/v2.0/file")).toBe("Bearer shoes-specific");
  });

  it.each([
    ["necklace", "/task/2d-vto/necklace"],
    ["earrings", "/task/2d-vto/earring"],
    ["bracelet", "/task/2d-vto/bracelet"],
    ["ring", "/task/2d-vto/ring"],
  ] as const)("%s: posts both file-id and info forms to %s and polls the same path", async (role, suffix) => {
    vi.stubEnv("YOUCAM_KEY_JEWELLERY", "jewel-specific");
    const yc = await load();
    mockFlow(suffix);
    const img = await yc.jewelleryTryOn(role, Buffer.from("person"), Buffer.from("jewel"));
    expect(img).toMatch(/^data:image\/jpeg;base64,/);
    expect(postBody(suffix)).toEqual({
      src_file_id: "file-1",
      ref_file_ids: ["file-1"],
      source_info: { name: "file-1" },
      object_infos: [{ name: "file-1" }],
    });
    expect(authFor("/s2s/v2.0/file")).toBe("Bearer jewel-specific");
    expect(fs.readdirSync(dir).some((f) => f.startsWith(`jewellery_${role}_`))).toBe(true);
  });

  it("jewellery: optional intensities go into object_infos[].parameter with role-specific names", async () => {
    const yc = await load();
    mockFlow("/task/2d-vto/bracelet");
    await yc.jewelleryTryOn("bracelet", Buffer.from("p3"), Buffer.from("j3"), {
      shadowIntensity: 0.4,
      ambientLightIntensity: 0.6,
    });
    expect(postBody("/task/2d-vto/bracelet").object_infos[0].parameter).toEqual({
      bracelet_shadow_intensity: 0.4,
      bracelet_ambient_light_intensity: 0.6,
    });
  });

  it("jewellery: the role is part of the cache key", async () => {
    const yc = await load();
    mockFlow("/task/2d-vto/necklace");
    await yc.jewelleryTryOn("necklace", Buffer.from("p4"), Buffer.from("j4"));
    mockFlow("/task/2d-vto/earring");
    const seen: boolean[] = [];
    await yc.jewelleryTryOn("earrings", Buffer.from("p4"), Buffer.from("j4"), { onCall: (i) => seen.push(i.cached) });
    expect(seen).toEqual([false]);
  });

  it("accepts result URLs in alternative shapes", async () => {
    const yc = await load();
    mockFlow("/task/2d-vto/ring", [{ download_url: "https://result.test/r.jpg" }] as never);
    await expect(yc.jewelleryTryOn("ring", Buffer.from("p5"), Buffer.from("j5"))).resolves.toMatch(/^data:image/);
  });

  it("turns a 404 from an endpoint into a helpful failure message", async () => {
    const yc = await load();
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/s2s/v2.0/file")) return initOk();
      if (u === "https://upload.test/put") return new Response("", { status: 200 });
      return jsonResponse({ status: 404, error: "NotFound" }, 404);
    });
    await expect(yc.jewelleryTryOn("ring", Buffer.from("p6"), Buffer.from("j6"))).rejects.toThrow(
      /may not be enabled for your key/
    );
  });
});
