import sharp from "sharp";

/** Solid-colour PNG. */
export function solid(hex: string, w = 200, h = 200): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: hex } })
    .png()
    .toBuffer();
}

/** Image with a coloured centre block on a (default white) background. */
export async function onBackground(centerHex: string, bgHex = "#ffffff", size = 200): Promise<Buffer> {
  const block = await solid(centerHex, size / 2, size / 2);
  return sharp({ create: { width: size, height: size, channels: 3, background: bgHex } })
    .composite([{ input: block, left: size / 4, top: size / 4 }])
    .png()
    .toBuffer();
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
