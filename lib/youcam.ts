import crypto from "crypto";
import fs from "fs";
import path from "path";
import { localSkinTone } from "./tone-local";

/**
 * Typed YouCam API client: upload -> create task -> poll, with a disk cache
 * keyed by the hash of the inputs so repeated runs cost zero API units.
 * Endpoint shapes are taken from https://docs.perfectcorp.com (v2.0 s2s API).
 */

const BASE = process.env.YOUCAM_API_BASE || "https://yce-api-01.makeupar.com";
/** Cache directory: FLATTR_CACHE_DIR override (tests, custom deploys), default <cwd>/cache. */
const cacheDir = () => process.env.FLATTR_CACHE_DIR || path.join(process.cwd(), "cache");

export const sha = (b: Buffer | string) => crypto.createHash("sha1").update(b).digest("hex").slice(0, 16);

export function cacheGet<T>(key: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(cacheDir(), key + ".json"), "utf8")) as T;
  } catch {
    return null;
  }
}
export function cachePut(key: string, val: unknown) {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(path.join(cacheDir(), key + ".json"), JSON.stringify(val));
  } catch {
    /* read-only FS (Vercel) - in-memory only */
  }
}
export function cacheGetBin(key: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(cacheDir(), key));
  } catch {
    return null;
  }
}
export function cachePutBin(key: string, b: Buffer) {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(path.join(cacheDir(), key), b);
  } catch {
    /* ignore */
  }
}

/** Shapes of the YouCam v2.0 s2s responses we rely on. */
interface YouCamEnvelope {
  status?: number;
  error?: string;
  error_code?: string;
}
interface FileInitResponse {
  data: {
    files: {
      file_id: string;
      requests: { url: string; method?: string; headers?: Record<string, string> }[];
    }[];
  };
}
interface TaskCreateResponse {
  data: { task_id: string };
}
export interface TaskResults {
  output?: { type: string; ui_score: number }[];
  color?: ToneResult;
  url?: string;
}
export interface TaskData {
  task_status?: string;
  error_message?: string;
  error?: string;
  results?: TaskResults | { download_url?: string }[];
}
interface TaskPollResponse {
  data?: TaskData;
}

const mem = new Map<string, unknown>();

/** Per-API keys (YOUCAM_KEY_SKIN etc.) with a single YOUCAM_API_KEY as fallback. */
const KEY_ENV: Record<string, string> = {
  "skin-analysis": "YOUCAM_KEY_SKIN",
  "skin-tone-analysis": "YOUCAM_KEY_TONE",
  "cloth-v4": "YOUCAM_KEY_CLOTHES",
  "makeup-vto": "YOUCAM_KEY_MAKEUP",
};
export const hasYoucamKey = () => !!process.env.YOUCAM_API_KEY || Object.values(KEY_ENV).some((e) => !!process.env[e]);

function headers(kind: string) {
  const name = KEY_ENV[kind];
  const k = (name && process.env[name]) || process.env.YOUCAM_API_KEY;
  if (!k) throw new Error(`${name ?? "YOUCAM_API_KEY"} missing`);
  return { Authorization: `Bearer ${k}`, "Content-Type": "application/json" };
}

async function api<T>(kind: string, method: string, p: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + p, {
    method,
    headers: headers(kind),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: YouCamEnvelope;
  try {
    json = JSON.parse(text) as YouCamEnvelope;
  } catch {
    throw new Error(`YouCam ${p} -> ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.ok || (json.status && json.status !== 200)) {
    throw new Error(`YouCam ${p} -> ${res.status} ${json.error || json.error_code || text.slice(0, 200)}`);
  }
  return json as T;
}

/** Step 1+2: initialise upload, PUT bytes to the pre-signed URL. Returns file_id. */
export async function uploadFile(buf: Buffer, kind: string, contentType = "image/jpeg", name = "image.jpg") {
  const key = `file_${kind}_` + sha(buf);
  const hit = mem.get(key) as string | undefined;
  if (hit) return hit;
  const init = await api<FileInitResponse>(kind, "POST", "/s2s/v2.0/file", {
    files: [{ content_type: contentType, file_name: name, file_size: buf.length }],
  });
  const f = init.data.files[0];
  const req = f.requests[0];
  const put = await fetch(req.url, {
    method: req.method || "PUT",
    headers: { ...(req.headers || {}), "Content-Type": contentType },
    body: new Uint8Array(buf),
  });
  if (!put.ok) throw new Error(`Upload PUT failed ${put.status}`);
  mem.set(key, f.file_id);
  return f.file_id as string;
}

export async function createTask(kind: string, body: Record<string, unknown>) {
  const r = await api<TaskCreateResponse>(kind, "POST", `/s2s/v2.0/task/${kind}`, body);
  return r.data.task_id as string;
}

/** Poll with backoff + timeout. */
export async function pollTask(kind: string, id: string, timeoutMs = 90_000): Promise<TaskData> {
  const t0 = Date.now();
  let wait = 1500;
  while (Date.now() - t0 < timeoutMs) {
    const r = await api<TaskPollResponse>(kind, "GET", `/s2s/v2.0/task/${kind}/${id}`);
    const st = r.data?.task_status;
    if (st === "success") return r.data as TaskData;
    if (st === "error" || st === "failed")
      throw new Error(`${kind} task failed: ${r.data?.error_message || r.data?.error || "unknown"}`);
    await new Promise((s) => setTimeout(s, wait));
    wait = Math.min(wait * 1.3, 5000);
  }
  throw new Error(`${kind} task timed out`);
}

/** Cached run: key = kind + input hash. */
async function cached<T>(kind: string, inputHash: string, run: () => Promise<T>): Promise<T> {
  const key = `${kind}_${inputHash}`;
  const m = mem.get(key) as T | undefined;
  if (m) return m;
  const d = cacheGet<T>(key);
  if (d) {
    mem.set(key, d);
    return d;
  }
  if (process.env.DEMO_MODE === "1" && !hasYoucamKey()) throw new Error(`DEMO_MODE: no cached result for ${key}`);
  const v = await run();
  mem.set(key, v);
  cachePut(key, v);
  return v;
}

export type SkinMetrics = Record<string, number>; // ui_score 1-100; ASSUMED higher = healthier (matches concernSeverity in flattery.ts). UNVERIFIED until a real API response is checked.

export const SKIN_ACTIONS = ["dark_circle_v2", "redness", "oiliness", "texture", "age_spot", "moisture", "radiance"];

/** AI Skin Analysis. ui_score is 1-100 where higher = healthier for most categories. */
export function skinAnalysis(img: Buffer) {
  return cached<SkinMetrics>("skin", sha(img), async () => {
    const id = await uploadFile(img, "skin-analysis");
    const t = await createTask("skin-analysis", {
      src_file_id: id,
      dst_actions: SKIN_ACTIONS,
      miniserver_args: { enable_mask_overlay: false },
      format: "json",
    });
    const d = await pollTask("skin-analysis", t);
    const out: SkinMetrics = {};
    const res = Array.isArray(d.results) ? undefined : d.results;
    for (const o of res?.output ?? []) out[o.type] = o.ui_score;
    return out;
  });
}

export interface ToneResult {
  skin_color: string;
  source?: "youcam" | "local";
  eye_color?: string;
  lip_color?: string;
  hair_color?: string;
  eye_color_name?: string;
  hair_color_name?: string;
}

/** AI Skin Tone Analysis (Facial Color Tones). Falls back to a local estimate if no key / the call fails. */
export function skinTone(img: Buffer) {
  return cached<ToneResult>("tone", sha(img), async () => {
    const toneKey = process.env.YOUCAM_KEY_TONE || process.env.YOUCAM_API_KEY;
    if (toneKey) {
      try {
        const id = await uploadFile(img, "skin-tone-analysis");
        const t = await createTask("skin-tone-analysis", { src_file_id: id });
        const d = await pollTask("skin-tone-analysis", t);
        const res = Array.isArray(d.results) ? undefined : d.results;
        return { ...(res?.color as ToneResult), source: "youcam" as const };
      } catch {
        /* fall through to local estimate */
      }
    }
    return { ...(await localSkinTone(img)), source: "local" as const };
  });
}

export type GarmentCategory = "upper_body" | "lower_body" | "full_body" | "shoes";

/** AI Clothes Virtual Try-On. Returns result image bytes (cached) since result URLs expire. */
export function clothesTryOn(person: Buffer, garment: Buffer, category: GarmentCategory = "upper_body") {
  const h = sha(person) + "_" + sha(garment) + "_" + category;
  return cachedImage("vto", h, async () => {
    const [s, g] = await Promise.all([uploadFile(person, "cloth-v4"), uploadFile(garment, "cloth-v4")]);
    const t = await createTask("cloth-v4", { src_file_id: s, ref_file_id: g, garment_category: category });
    const d = await pollTask("cloth-v4", t, 120_000);
    return resultUrl(d);
  });
}

export interface MakeupPlan {
  lip: string;
  blush: string;
  concealer: string;
}

/** AI Makeup Virtual Try-On: lip + blush + concealer on an image. */
export function makeupTryOn(face: Buffer, plan: MakeupPlan) {
  const h = sha(face) + "_" + sha(JSON.stringify(plan));
  return cachedImage("makeup", h, async () => {
    // makeup-vto takes src_file_url; a File-API upload is accepted via file id too in v2.0
    const id = await uploadFile(face, "makeup-vto");
    const t = await createTask("makeup-vto", {
      src_file_id: id,
      version: "1.0",
      effects: [
        {
          category: "lip_color",
          shape: { name: "original" },
          style: { type: "full" },
          palettes: [{ color: plan.lip, texture: "matte", colorIntensity: 55 }],
        },
        {
          category: "blush",
          pattern: { name: "1colors1" },
          palettes: [{ color: plan.blush, texture: "matte", colorIntensity: 45 }],
        },
        {
          category: "concealer",
          palettes: [{ color: plan.concealer, colorIntensity: 60, colorUnderEyeIntensity: 70, coverageLevel: 60 }],
        },
      ],
    });
    const d = await pollTask("makeup-vto", t, 120_000);
    return resultUrl(d);
  });
}

/** Result image URL: `results.url` or the first array entry's `download_url`. */
function resultUrl(d: TaskData): string {
  const r = d.results;
  const url = Array.isArray(r) ? r[0]?.download_url : r?.url;
  if (!url) throw new Error("YouCam task finished without a result URL");
  return url;
}

/** Cache result images as bytes under a content key; returns data URL. */
async function cachedImage(kind: string, inputHash: string, run: () => Promise<string>): Promise<string> {
  const key = `${kind}_${inputHash}.jpg`;
  const hit = cacheGetBin(key);
  if (hit) return "data:image/jpeg;base64," + hit.toString("base64");
  if (process.env.DEMO_MODE === "1" && !hasYoucamKey()) throw new Error(`DEMO_MODE: no cached result for ${key}`);
  const url = await run();
  const r = await fetch(url);
  const b = Buffer.from(await r.arrayBuffer());
  cachePutBin(key, b);
  return "data:image/jpeg;base64," + b.toString("base64");
}
