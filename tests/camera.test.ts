import { describe, expect, it } from "vitest";
import { classifyCameraError, lightingHint, meanLuma } from "@/lib/camera";

const named = (name: string) => Object.assign(new Error("x"), { name });

describe("meanLuma", () => {
  it("is 0 for empty data and black, ~255 for white", () => {
    expect(meanLuma(new Uint8ClampedArray([]))).toBe(0);
    expect(meanLuma(new Uint8ClampedArray([0, 0, 0, 255]))).toBe(0);
    expect(meanLuma(new Uint8ClampedArray([255, 255, 255, 255]))).toBeCloseTo(255, 0);
  });

  it("weights green above red above blue", () => {
    const r = meanLuma(new Uint8ClampedArray([255, 0, 0, 255]));
    const g = meanLuma(new Uint8ClampedArray([0, 255, 0, 255]));
    const b = meanLuma(new Uint8ClampedArray([0, 0, 255, 255]));
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
  });

  it("averages across pixels", () => {
    const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(meanLuma(px)).toBeCloseTo(127.5, 0);
  });
});

describe("lightingHint", () => {
  it("flags dark, bright and ok light", () => {
    expect(lightingHint(30)).toBe("dark");
    expect(lightingHint(69.9)).toBe("dark");
    expect(lightingHint(70)).toBe("ok");
    expect(lightingHint(140)).toBe("ok");
    expect(lightingHint(215)).toBe("ok");
    expect(lightingHint(240)).toBe("bright");
  });
});

describe("classifyCameraError", () => {
  it("maps browser errors to friendly kinds", () => {
    expect(classifyCameraError(named("NotAllowedError"))).toBe("denied");
    expect(classifyCameraError(named("SecurityError"))).toBe("denied");
    expect(classifyCameraError(named("NotFoundError"))).toBe("no-camera");
    expect(classifyCameraError(named("NotReadableError"))).toBe("busy");
    expect(classifyCameraError(named("SomethingElse"))).toBe("error");
    expect(classifyCameraError("not an error")).toBe("error");
  });
});
