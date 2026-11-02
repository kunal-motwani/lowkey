import { runStylist } from "@/lib/agent";
import { InvalidImageError, normalizeImage } from "@/lib/image";
import { fetchImageSafely, UnsafeUrlError } from "@/lib/safe-fetch";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_UPLOAD = 8 * 1024 * 1024;
const SAMPLE_RE = /^[a-z0-9_-]+\.(jpg|png)$/i;

class BadRequest extends Error {}

/** Simple per-IP sliding window limiter. In-memory, so per instance on serverless; use a shared store at scale. */
const hits = new Map<string, number[]>();
function rateLimited(ip: string, limit = 6, windowMs = 60_000) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return recent.length > limit;
}

async function load(form: FormData, field: "selfie" | "garment"): Promise<Buffer> {
  const sampleKey = field === "selfie" ? "sampleSelfie" : "sampleGarment";
  const file = form.get(field);
  let raw: Buffer;
  if (file && typeof file !== "string") {
    if (file.size > MAX_UPLOAD) throw new BadRequest(`The ${field} image is too large (max 8 MB).`);
    raw = Buffer.from(await file.arrayBuffer());
  } else if (
    field === "garment" &&
    typeof form.get("garmentUrl") === "string" &&
    String(form.get("garmentUrl")).trim()
  ) {
    raw = await fetchImageSafely(String(form.get("garmentUrl")).trim());
  } else {
    const sample = form.get(sampleKey);
    if (typeof sample !== "string" || !SAMPLE_RE.test(sample)) throw new BadRequest(`Missing ${field} image.`);
    const samplePath = path.join(process.cwd(), "public", "samples", path.basename(sample));
    if (!fs.existsSync(samplePath)) throw new BadRequest(`Sample image "${sample}" is not available.`);
    raw = fs.readFileSync(samplePath);
  }
  return normalizeImage(raw);
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  if (rateLimited(ip)) {
    return Response.json(
      { error: "Too many requests. Please wait a minute and try again." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (event: string, data: unknown) =>
        ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const [selfie, garment] = await Promise.all([load(form, "selfie"), load(form, "garment")]);
        const result = await runStylist(selfie, garment, (e) => send("step", e));
        send("result", result);
      } catch (e) {
        if (e instanceof BadRequest || e instanceof UnsafeUrlError || e instanceof InvalidImageError) {
          send("fail", { message: e.message });
        } else {
          console.error("[analyze] unexpected error:", e instanceof Error ? e.message : e);
          send("fail", { message: "Something went wrong while analysing. Please try again." });
        }
      }
      ctrl.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
