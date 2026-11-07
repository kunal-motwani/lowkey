import { describe, expect, it } from "vitest";
import {
  analyzePixels,
  buildReport,
  checkPhotoWith,
  evaluateBody,
  evaluateFace,
  guidanceFromChecks,
  lightingCheck,
  resolutionCheck,
  sharpnessCheck,
  sharpnessScore,
  type PoseLandmark,
  type Raster,
} from "@/lib/photo-quality";

const status = (checks: { id: string; status: string }[], id: string) => checks.find((c) => c.id === id)?.status;

/** Centred face box with the given width ratio on a 1000x1333 image. */
const faceBox = (ratio: number, W = 1000, H = 1333) => {
  const w = ratio * W;
  const h = w * 1.25;
  return { x: (W - w) / 2, y: H * 0.45 - h / 2, w, h };
};

describe("evaluateFace", () => {
  it("fails below 0.60, passes at 0.60 and above", () => {
    expect(status(evaluateFace([faceBox(0.59)], 1000, 1333), "face-size")).toBe("fail");
    expect(status(evaluateFace([faceBox(0.6)], 1000, 1333), "face-size")).toBe("pass");
    expect(status(evaluateFace([faceBox(0.61)], 1000, 1333), "face-size")).toBe("pass");
  });

  it("gives the move-closer tip when too small", () => {
    const c = evaluateFace([faceBox(0.4)], 1000, 1333).find((x) => x.id === "face-size");
    expect(c?.tip).toBe("Move closer until your face fills the oval");
  });

  it("fails when no face is found", () => {
    const r = evaluateFace({ faces: [] }, 1000, 1333);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "face-found", status: "fail" });
  });

  it("fails on multiple faces", () => {
    expect(status(evaluateFace([faceBox(0.7), faceBox(0.3)], 1000, 1333), "face-count")).toBe("fail");
    expect(status(evaluateFace([faceBox(0.7)], 1000, 1333), "face-count")).toBe("pass");
  });

  it("flags off-centre faces", () => {
    const f = faceBox(0.62);
    expect(status(evaluateFace([{ ...f, x: f.x + 130 }], 1000, 1333), "face-centre")).toBe("warn");
    expect(status(evaluateFace([{ ...f, x: f.x + 250 }], 1000, 1333), "face-centre")).toBe("fail");
    expect(status(evaluateFace([f], 1000, 1333), "face-centre")).toBe("pass");
  });

  it("flags a face cut off at the frame edge", () => {
    const f = faceBox(0.7);
    expect(status(evaluateFace([{ ...f, x: -50 }], 1000, 1333), "face-edge")).toBe("fail");
    expect(status(evaluateFace([{ ...f, x: 5 }], 1000, 1333), "face-edge")).toBe("warn");
    expect(status(evaluateFace([f], 1000, 1333), "face-edge")).toBe("pass");
  });
});

/** A well-framed standing pose, normalised coordinates on a 750x1000 image. */
function pose(over: Record<number, Partial<PoseLandmark>> = {}): PoseLandmark[] {
  const p: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }));
  const set = (i: number, x: number, y: number) => (p[i] = { x, y, visibility: 0.99 });
  set(0, 0.5, 0.12);
  set(11, 0.62, 0.22);
  set(12, 0.38, 0.22);
  set(23, 0.57, 0.5);
  set(24, 0.43, 0.5);
  set(25, 0.57, 0.72);
  set(26, 0.43, 0.72);
  set(27, 0.57, 0.93);
  set(28, 0.43, 0.93);
  for (const [i, o] of Object.entries(over)) p[Number(i)] = { ...p[Number(i)], ...o };
  return p;
}

describe("evaluateBody", () => {
  it("passes a full upright frontal body", () => {
    const r = evaluateBody([pose()], 750, 1000);
    expect(r.filter((c) => c.status !== "pass")).toEqual([]);
  });

  it("fails when no person is found", () => {
    expect(evaluateBody([], 750, 1000)[0]).toMatchObject({ id: "body-found", status: "fail" });
  });

  it("fails when ankles have low visibility", () => {
    const r = evaluateBody([pose({ 27: { visibility: 0.2 }, 28: { visibility: 0.3 } })], 750, 1000);
    const c = r.find((x) => x.id === "body-visible");
    expect(c?.status).toBe("fail");
    expect(c?.message).toMatch(/ankles/);
  });

  it("fails when a landmark is outside the frame", () => {
    expect(status(evaluateBody([pose({ 27: { y: 1.1 }, 28: { y: 1.1 } })], 750, 1000), "body-visible")).toBe("fail");
  });

  it("fails when the body is too small in frame", () => {
    const small = pose({ 0: { y: 0.3 }, 11: { y: 0.36 }, 12: { y: 0.36 }, 27: { y: 0.75 }, 28: { y: 0.75 } });
    expect(status(evaluateBody([small], 750, 1000), "body-height")).toBe("fail");
  });

  it("fails on more than one person", () => {
    expect(status(evaluateBody([pose(), pose()], 750, 1000), "body-count")).toBe("fail");
  });

  it("detects a body turned sideways", () => {
    const side = pose({ 11: { x: 0.52 }, 12: { x: 0.48 } });
    expect(status(evaluateBody([side], 750, 1000), "body-facing")).toBe("fail");
  });

  it("warns on tilted shoulders", () => {
    const tilt = pose({ 11: { y: 0.3 }, 12: { y: 0.16 } });
    expect(status(evaluateBody([tilt], 750, 1000), "body-upright")).toBe("warn");
  });
});

describe("sharpness", () => {
  const W = 64;
  const H = 64;
  const sharp = new Float32Array(W * H).map((_, i) => ((((i % W) >> 2) + (Math.floor(i / W) >> 2)) % 2 ? 230 : 20));
  const blurred = (() => {
    let cur = sharp;
    for (let pass = 0; pass < 40; pass++) {
      const next = new Float32Array(cur);
      for (let y = 1; y < H - 1; y++)
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          next[i] = (cur[i] + cur[i - 1] + cur[i + 1] + cur[i - W] + cur[i + W]) / 5;
        }
      cur = next;
    }
    return cur;
  })();

  it("scores a sharp pattern far above a blurred one", () => {
    const s = sharpnessScore(sharp, W, H);
    const b = sharpnessScore(blurred, W, H);
    expect(s).toBeGreaterThan(b * 10);
    expect(sharpnessCheck(s).status).toBe("pass");
    expect(sharpnessCheck(b).status).toBe("fail");
  });

  it("scores a flat image 0 and handles tiny images", () => {
    expect(sharpnessScore(new Float32Array(100).fill(128), 10, 10)).toBe(0);
    expect(sharpnessScore([1, 2], 2, 1)).toBe(0);
  });

  it("has a warn band", () => {
    expect(sharpnessCheck(30).status).toBe("warn");
  });
});

describe("resolution and lighting", () => {
  it("grades resolution by shorter side", () => {
    expect(resolutionCheck(400, 600).status).toBe("fail");
    expect(resolutionCheck(512, 900).status).toBe("warn");
    expect(resolutionCheck(768, 1024).status).toBe("pass");
  });

  it("grades lighting", () => {
    expect(lightingCheck(30).status).toBe("fail");
    expect(lightingCheck(60).status).toBe("warn");
    expect(lightingCheck(250).status).toBe("fail");
    expect(lightingCheck(230).status).toBe("warn");
    expect(lightingCheck(130, 90).status).toBe("warn");
    expect(lightingCheck(130, 5).status).toBe("pass");
  });

  it("measures left/right brightness difference", () => {
    const px = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
    expect(analyzePixels(px, 4, 1).leftRightDiff).toBeGreaterThan(200);
  });
});

describe("buildReport and guidance", () => {
  it("is ok only with no fails", () => {
    expect(buildReport("face", [lightingCheck(130), resolutionCheck(512, 900)]).ok).toBe(true);
    expect(buildReport("face", [lightingCheck(130), resolutionCheck(100, 100)]).ok).toBe(false);
  });

  it("picks the most important live message", () => {
    const checks = evaluateFace([faceBox(0.4)], 1000, 1333);
    expect(guidanceFromChecks([...checks, lightingCheck(30)], "face").message).toBe("Move closer");
    expect(guidanceFromChecks([lightingCheck(30)], "face").message).toBe("Too dark: face a window");
    expect(guidanceFromChecks(evaluateFace([faceBox(0.7)], 1000, 1333), "face").ready).toBe(true);
    expect(guidanceFromChecks(evaluateBody([pose({ 27: { visibility: 0 } })], 750, 1000), "body").message).toBe(
      "Step back so your whole body fits"
    );
  });
});

describe("checkPhotoWith", () => {
  const flat = (v: number) => {
    const n = 16 * 16;
    const data = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) data.set([v, v, v, 255], i * 4);
    return data;
  };
  const raster = (origW: number, origH: number): Raster => ({
    detect: {} as HTMLCanvasElement,
    w: 1000,
    h: 1333,
    origW,
    origH,
    small: { data: flat(128), width: 16, height: 16 },
  });
  const src = {} as HTMLCanvasElement;

  it("combines detector and heuristic checks", async () => {
    const r = await checkPhotoWith(src, "face", {
      rasterize: () => raster(900, 1200),
      detectFaces: async () => ({ faces: [faceBox(0.7)] }),
    });
    expect(r.mode).toBe("face");
    expect(status(r.checks, "face-size")).toBe("pass");
    expect(status(r.checks, "sharpness")).toBe("fail"); // flat synthetic image
    expect(r.ok).toBe(false);
  });

  it("degrades to a warning when the detector is unavailable, never throws", async () => {
    const r = await checkPhotoWith(src, "body", {
      rasterize: () => raster(900, 1200),
      detectPoses: async () => null,
    });
    const d = r.checks.find((c) => c.id === "detector");
    expect(d).toMatchObject({ status: "warn", message: "Automatic face/body check unavailable" });
    expect(status(r.checks, "resolution")).toBe("pass");
    const r2 = await checkPhotoWith(src, "face", {
      rasterize: () => raster(900, 1200),
      detectFaces: async () => {
        throw new Error("boom");
      },
    });
    expect(r2.checks.some((c) => c.id === "detector")).toBe(true);
  });

  it("warns on landscape body photos", async () => {
    const r = await checkPhotoWith(src, "body", {
      rasterize: () => raster(1600, 1200),
      detectPoses: async () => [pose()],
    });
    expect(status(r.checks, "orientation")).toBe("warn");
  });
});
