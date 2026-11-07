import { InputError, runStylist } from "@/lib/agent";
import { PIECE_ROLES, ROLE_REQUIRES } from "@/lib/types";
import { InvalidImageError, normalizeImage } from "@/lib/image";
import { YoucamTaskError } from "@/lib/youcam";
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

const isFile = (v: FormDataEntryValue | null): v is File => !!v && typeof v !== "string";
const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function loadSample(sample: string): Buffer {
  if (!SAMPLE_RE.test(sample)) throw new BadRequest(`Sample image "${sample}" is not valid.`);
  const samplePath = path.join(process.cwd(), "public", "samples", path.basename(sample));
  if (!fs.existsSync(samplePath)) throw new BadRequest(`Sample image "${sample}" is not available.`);
  return fs.readFileSync(samplePath);
}

async function readFile(file: File, label: string): Promise<Buffer> {
  if (file.size > MAX_UPLOAD) throw new BadRequest(`The ${label} image is too large (max 8 MB).`);
  return Buffer.from(await file.arrayBuffer());
}

/** Resolve one image from `<field>` (File), optionally `<field>Url`, or `sample<Field>`; undefined if none supplied. */
async function load(
  form: FormData,
  field: string,
  opts: { url?: boolean; fileOnly?: boolean } = {}
): Promise<Buffer | undefined> {
  const file = form.get(field);
  let raw: Buffer;
  if (isFile(file) && file.size > 0) {
    raw = await readFile(file, field);
  } else if (opts.url && str(form, `${field}Url`)) {
    raw = await fetchImageSafely(str(form, `${field}Url`)!);
  } else if (!opts.fileOnly && str(form, `sample${cap(field)}`)) {
    raw = loadSample(str(form, `sample${cap(field)}`)!);
  } else {
    return undefined;
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
        const face = await load(form, "face");
        if (!face) throw new BadRequest("Missing face photo.");
        const body = await load(form, "body");
        const hand = await load(form, "hand", { fileOnly: true });
        const loaded = await Promise.all(
          PIECE_ROLES.map(async (role) => ({ role, image: await load(form, role, { url: true }) }))
        );
        const pieces = loaded.flatMap((p) => (p.image ? [{ role: p.role, image: p.image }] : []));
        if (!pieces.length) throw new BadRequest("Add at least one piece (clothing, shoes or jewellery).");
        const photos = { face, body, hand };
        const missing = new Set(pieces.map((p) => ROLE_REQUIRES[p.role]).filter((k) => k && !photos[k]));
        if (missing.has("body"))
          throw new BadRequest("Add a full-body photo (head to feet) to try on bottoms and shoes");
        if (missing.has("hand")) {
          throw new BadRequest("Add a photo of the back of your hand to try on bracelets and rings");
        }
        const result = await runStylist({ face, body, hand, pieces }, (e) => send("step", e));
        send("result", result);
      } catch (e) {
        if (e instanceof YoucamTaskError) {
          send("fail", { message: e.detail });
        } else if (
          e instanceof BadRequest ||
          e instanceof InputError ||
          e instanceof UnsafeUrlError ||
          e instanceof InvalidImageError
        ) {
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
