import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { InvalidImageError, normalizeImage } from "../lib/image";
import { solid } from "./helpers";

describe("normalizeImage", () => {
  it("rejects non-image bytes", async () => {
    await expect(normalizeImage(Buffer.from("definitely not an image"))).rejects.toThrow(InvalidImageError);
    await expect(normalizeImage(Buffer.alloc(0))).rejects.toThrow(InvalidImageError);
  });

  it("bounds the longest side to 1024 and keeps aspect ratio", async () => {
    const out = await normalizeImage(await solid("#336699", 3000, 1500));
    const m = await sharp(out).metadata();
    expect(m.width).toBe(1024);
    expect(m.height).toBe(512);
  });

  it("does not upscale small images", async () => {
    const m = await sharp(await normalizeImage(await solid("#336699", 100, 80))).metadata();
    expect([m.width, m.height]).toEqual([100, 80]);
  });

  it("outputs JPEG", async () => {
    const m = await sharp(await normalizeImage(await solid("#336699"))).metadata();
    expect(m.format).toBe("jpeg");
  });

  it("flattens transparency onto white", async () => {
    const png = await sharp({
      create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const { data } = await sharp(await normalizeImage(png))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(250);
  });

  it("applies EXIF rotation", async () => {
    const src = await sharp(await solid("#336699", 100, 50))
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(src).metadata()).orientation).toBe(6);
    const m = await sharp(await normalizeImage(src)).metadata();
    expect([m.width, m.height]).toEqual([50, 100]);
    expect(m.orientation ?? 1).toBe(1);
  });
});
