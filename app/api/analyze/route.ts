import { runStylist } from "@/lib/agent";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

async function load(form: FormData, field: string, sampleField: string, dir: string): Promise<Buffer> {
  const f = form.get(field);
  if (f && typeof f !== "string") return Buffer.from(await f.arrayBuffer());
  const url = form.get(field + "Url");
  if (typeof url === "string" && url.startsWith("http")) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Could not fetch ${field} URL`);
    return Buffer.from(await r.arrayBuffer());
  }
  const sample = form.get(sampleField);
  if (typeof sample === "string" && /^[a-z0-9_-]+\.(jpg|png)$/i.test(sample))
    return fs.readFileSync(path.join(process.cwd(), "public", dir, sample));
  throw new Error(`Missing ${field}`);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) =>
        ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const selfie = await load(form, "selfie", "sampleSelfie", "samples");
        const garment = await load(form, "garment", "sampleGarment", "samples");
        const result = await runStylist(selfie, garment, (e) => send("step", e));
        send("result", result);
      } catch (e: any) {
        send("fail", { message: e.message });
      }
      ctrl.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
