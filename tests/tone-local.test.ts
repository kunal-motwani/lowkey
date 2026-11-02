import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { hexToRgb } from "../lib/color";
import { localSkinTone } from "../lib/tone-local";
import { onBackground, solid } from "./helpers";

describe("localSkinTone", () => {
  it("recovers a skin colour from the face region", async () => {
    const img = await onBackground("#d9a07c", "#2a4d8f", 400);
    // central block covers the sampled region (30%-70%)
    const { skin_color } = await localSkinTone(img);
    const got = hexToRgb(skin_color),
      want = hexToRgb("#d9a07c");
    got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(3));
  });

  it("works on JPEG input", async () => {
    const jpg = await sharp(await solid("#c68642", 300, 300))
      .jpeg()
      .toBuffer();
    const { skin_color } = await localSkinTone(jpg);
    expect(skin_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("falls back to a neutral-warm default when no skin pixels exist", async () => {
    const { skin_color } = await localSkinTone(await solid("#0000ff"));
    expect(skin_color).toBe("#d9a07c");
  });
});
