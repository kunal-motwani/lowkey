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
  download_url?: string;
}
export interface TaskData {
  task_status?: string;
  error_message?: string;
  error?: string;
  results?: TaskResults | { download_url?: string; url?: string }[];
}
interface TaskPollResponse {
  data?: TaskData;
}

/** A task the YouCam API rejected for a reason the user can act on (e.g. face too small / not detected). */
export class YoucamTaskError extends Error {
  constructor(
    kind: string,
    readonly detail: string
  ) {
    super(`${kind} task failed: ${detail}`);
    this.name = "YoucamTaskError";
  }
}

const mem = new Map<string, unknown>();

/** Per-API keys (YOUCAM_KEY_SKIN etc.) with a single YOUCAM_API_KEY as fallback. */
const KEY_ENV: Record<string, string> = {
  "skin-analysis": "YOUCAM_KEY_SKIN",
  "skin-tone-analysis": "YOUCAM_KEY_TONE",
  "cloth-v4": "YOUCAM_KEY_CLOTHES",
  "makeup-vto": "YOUCAM_KEY_MAKEUP",
  "shoes-transfer": "YOUCAM_KEY_SHOES",
  jewellery: "YOUCAM_KEY_JEWELLERY",
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

/** `taskPath` is the path after /s2s/v2.0/task/ when it differs from `kind` (kind also selects the API key). */
export async function createTask(kind: string, body: Record<string, unknown>, taskPath: string = kind) {
  const r = await api<TaskCreateResponse>(kind, "POST", `/s2s/v2.0/task/${taskPath}`, body);
  return r.data.task_id as string;
}

/** Poll with backoff + timeout. */
export async function pollTask(
  kind: string,
  id: string,
  timeoutMs = 90_000,
  taskPath: string = kind
): Promise<TaskData> {
  const t0 = Date.now();
  let wait = 1500;
  while (Date.now() - t0 < timeoutMs) {
    const r = await api<TaskPollResponse>(kind, "GET", `/s2s/v2.0/task/${taskPath}/${id}`);
    const st = r.data?.task_status;
    if (st === "success") return r.data as TaskData;
    if (st === "error" || st === "failed")
      throw new YoucamTaskError(kind, r.data?.error_message || r.data?.error || "unknown");
    await new Promise((s) => setTimeout(s, wait));
    wait = Math.min(wait * 1.3, 5000);
  }
  throw new Error(`${kind} task timed out`);
}

/** Reported once per high-level call so callers can tell cache hits (free) from live API calls (cost units). */
export interface CallInfo {
  api: "skin" | "tone" | "vto" | "makeup" | "shoes" | "jewellery";
  cached: boolean;
}
export interface CallOpts {
  onCall?: (info: CallInfo) => void;
}

/** Cached run: key = kind + input hash. */
async function cached<T>(kind: string, inputHash: string, run: () => Promise<T>, opts?: CallOpts): Promise<T> {
  const key = `${kind}_${inputHash}`;
  const api = kind as CallInfo["api"];
  const m = mem.get(key) as T | undefined;
  if (m) {
    opts?.onCall?.({ api, cached: true });
    return m;
  }
  const d = cacheGet<T>(key);
  if (d) {
    mem.set(key, d);
    opts?.onCall?.({ api, cached: true });
    return d;
  }
  if (process.env.DEMO_MODE === "1" && !hasYoucamKey()) throw new Error(`DEMO_MODE: no cached result for ${key}`);
  const v = await run();
  opts?.onCall?.({ api, cached: false });
  mem.set(key, v);
  cachePut(key, v);
  return v;
}

export type SkinMetrics = Record<string, number>; // ui_score 1-100; ASSUMED higher = healthier (matches concernSeverity in flattery.ts). UNVERIFIED until a real API response is checked.

export const SKIN_ACTIONS = ["dark_circle_v2", "redness", "oiliness", "texture", "age_spot", "moisture", "radiance"];

/** AI Skin Analysis. ui_score is 1-100 where higher = healthier for most categories. */
export function skinAnalysis(img: Buffer, opts?: CallOpts) {
  return cached<SkinMetrics>(
    "skin",
    sha(img),
    async () => {
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
    },
    opts
  );
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
export function skinTone(img: Buffer, opts?: CallOpts) {
  return cached<ToneResult>(
    "tone",
    sha(img),
    async () => {
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
    },
    opts
  );
}

export type GarmentCategory = "upper_body" | "lower_body" | "full_body" | "shoes";
export type ClothingRole = "top" | "bottom" | "jacket";
export type JewelleryRole = "necklace" | "earrings" | "bracelet" | "ring";

/**
 * The single place to change the garment_category sent to YouCam for each outfit role.
 * NOTE: the YouCam docs do not enumerate the allowed values; these are UNVERIFIED until a real run.
 * Per the docs, bottoms need a worn-outfit reference photo and a full-body person photo.
 */
export const GARMENT_CATEGORY: Record<ClothingRole, GarmentCategory> = {
  top: "upper_body",
  bottom: "lower_body",
  jacket: "upper_body",
};

/** AI Clothes Virtual Try-On. Returns result image bytes (cached) since result URLs expire. The cache key includes the category. */
export function clothesTryOn(
  person: Buffer,
  garment: Buffer,
  category: GarmentCategory = "upper_body",
  opts?: CallOpts
) {
  const h = sha(person) + "_" + sha(garment) + "_" + category;
  return cachedImage(
    "vto",
    h,
    async () => {
      const [s, g] = await Promise.all([uploadFile(person, "cloth-v4"), uploadFile(garment, "cloth-v4")]);
      const t = await createTask("cloth-v4", { src_file_id: s, ref_file_id: g, garment_category: category });
      const d = await pollTask("cloth-v4", t, 120_000);
      return resultUrl(d);
    },
    opts
  );
}

export interface MakeupPlan {
  lip: string;
  blush: string;
  concealer: string;
}

/** AI Makeup Virtual Try-On: lip + blush + concealer on an image. */
export function makeupTryOn(face: Buffer, plan: MakeupPlan, opts?: CallOpts) {
  const h = sha(face) + "_" + sha(JSON.stringify(plan));
  return cachedImage(
    "makeup",
    h,
    async () => {
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
    },
    opts
  );
}

/** Result image URL, defensively: `results.url`, `results.download_url`, or the first array entry's `download_url`/`url`. */
function resultUrl(d: TaskData): string {
  const r = d.results;
  const url = Array.isArray(r) ? (r[0]?.download_url ?? r[0]?.url) : (r?.url ?? r?.download_url);
  if (!url) throw new Error("YouCam task finished without a result URL");
  return url;
}

/** Cache result images as bytes under a content key; returns data URL. */
async function cachedImage(
  kind: string,
  inputHash: string,
  run: () => Promise<string>,
  opts?: CallOpts
): Promise<string> {
  const key = `${kind}_${inputHash}.jpg`;
  const api = kind as CallInfo["api"];
  const hit = cacheGetBin(key);
  if (hit) {
    opts?.onCall?.({ api, cached: true });
    return "data:image/jpeg;base64," + hit.toString("base64");
  }
  if (process.env.DEMO_MODE === "1" && !hasYoucamKey()) throw new Error(`DEMO_MODE: no cached result for ${key}`);
  const url = await run();
  const r = await fetch(url);
  const b = Buffer.from(await r.arrayBuffer());
  cachePutBin(key, b);
  opts?.onCall?.({ api, cached: false });
  return "data:image/jpeg;base64," + b.toString("base64");
}

/** Adds a helpful hint when an endpoint we could not verify is rejected. Task failures pass through untouched. */
async function hintAssumed<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof YoucamTaskError) throw e;
    const m = e instanceof Error ? e.message : String(e);
    if (/-> (404|403)\b|InvalidParameters|invalid_parameter|not.?found/i.test(m)) {
      throw new Error(
        `${what} was rejected (${m}). This API may not be enabled for your key, or its endpoint is assumed: check JEWELLERY_TASK / SHOES_TASK in lib/youcam.ts.`
      );
    }
    throw e;
  }
}

export interface ShoesTaskSpec {
  /** Task path after /s2s/v2.0/task/ (also used for polling). */
  path: string;
  /** true = endpoint and request shape confirmed (docs and/or live probing). */
  verified: boolean;
}

/**
 * Shoes endpoint. VERIFIED (docs + live probe: body {src_file_id, ref_file_id} is accepted, a task was created and ran): POST /s2s/v2.0/task/shoes-transfer {src_file_id (full-body person, foot fully
 * visible), ref_file_id (one shoe product image, >= 512px), gender?, style?}; poll GET .../shoes-transfer/{id};
 * output 1008x1344. The gender/style enum values are NOT documented, so they are omitted unless the caller passes them.
 */
export const SHOES_TASK: ShoesTaskSpec = { path: "shoes-transfer", verified: true };

export interface JewelleryTaskSpec {
  /** Task path after /s2s/v2.0/task/ (also used for polling). */
  path: string;
  /** Body field names for the optional intensity knobs (omitted by default). */
  shadowField: string;
  ambientField: string;
  /** true = endpoint confirmed. All four are verified to EXIST for our key (made-up paths return 404 NotFound). */
  verified: boolean;
}

/**
 * Jewellery endpoints, ONE table so a first real run can correct them in a single place. Request body for all four
 * (verified by live probing to pass the "required fields" validation, NOT yet verified end to end with real face/hand images):
 * {src_file_id, ref_file_ids: [id], source_info: {name: src id}, object_infos: [{name: ref id, parameter?}]}.
 * Optional `parameter` keys (omitted by default): <kind>_need_remove_background, <kind>_shadow_intensity (0-1),
 * <kind>_ambient_light_intensity (0-1), <kind>_wearing_location / <kind>_anchor_point.
 */
export const JEWELLERY_TASK: Record<JewelleryRole, JewelleryTaskSpec> = {
  // VERIFIED-FROM-DOCS: src_file_id front-facing, neck clearly visible (neck width >= 15% of image width, head
  // rotation <= 20deg); ref_file_ids: necklace image, front-facing, background removed.
  necklace: {
    path: "2d-vto/necklace",
    shadowField: "necklace_shadow_intensity",
    ambientField: "necklace_ambient_light_intensity",
    verified: true,
  },
  // VERIFIED-FROM-DOCS: src_file_id = back of wrist, all five fingers visible; ref_file_ids: bracelet in 3/4 front view (~45deg).
  bracelet: {
    path: "2d-vto/bracelet",
    shadowField: "bracelet_shadow_intensity",
    ambientField: "bracelet_ambient_light_intensity",
    verified: true,
  },
  // VERIFIED-TO-EXIST by live probing (400 InvalidParameters, not 404); docs page not found, so the path spelling
  // "earring" was inferred and the optional parameter names are ASSUMED-by-analogy. Fix here after a real run.
  earrings: {
    path: "2d-vto/earring",
    shadowField: "earring_shadow_intensity",
    ambientField: "earring_ambient_light_intensity",
    verified: true,
  },
  // VERIFIED-TO-EXIST by live probing (400 InvalidParameters, not 404); optional parameter names are
  // ASSUMED-by-analogy. Fix here after a real run.
  ring: {
    path: "2d-vto/ring",
    shadowField: "ring_shadow_intensity",
    ambientField: "ring_ambient_light_intensity",
    verified: true,
  },
};

export interface ShoesOpts extends CallOpts {
  gender?: string;
  style?: string;
}

/** Shoes try-on: person = full-body photo with the foot fully visible; shoe = one product image. Cached as bytes. */
export function shoesTryOn(person: Buffer, shoe: Buffer, opts?: ShoesOpts) {
  const extra = opts?.gender || opts?.style ? "_" + sha(`${opts?.gender}|${opts?.style}`) : "";
  const h = sha(person) + "_" + sha(shoe) + "_shoes" + extra;
  return cachedImage(
    "shoes",
    h,
    () =>
      hintAssumed("Shoes try-on", async () => {
        const [s, r] = await Promise.all([uploadFile(person, "shoes-transfer"), uploadFile(shoe, "shoes-transfer")]);
        const body: Record<string, unknown> = { src_file_id: s, ref_file_id: r };
        if (opts?.gender) body.gender = opts.gender;
        if (opts?.style) body.style = opts.style;
        const t = await createTask("shoes-transfer", body, SHOES_TASK.path);
        return resultUrl(await pollTask("shoes-transfer", t, 120_000, SHOES_TASK.path));
      }),
    opts
  );
}

export interface JewelleryOpts extends CallOpts {
  shadowIntensity?: number;
  ambientLightIntensity?: number;
}

/** Jewellery try-on (necklace | earrings | bracelet | ring) on a face/neck or hand photo. The cache key includes the role. */
export function jewelleryTryOn(role: JewelleryRole, person: Buffer, jewellery: Buffer, opts?: JewelleryOpts) {
  const spec = JEWELLERY_TASK[role];
  if (!spec) return Promise.reject(new Error(`Unsupported jewellery role: ${role}`));
  const knobs =
    opts?.shadowIntensity != null || opts?.ambientLightIntensity != null
      ? "_" + sha(`${opts?.shadowIntensity}|${opts?.ambientLightIntensity}`)
      : "";
  const h = `${role}_` + sha(person) + "_" + sha(jewellery) + knobs;
  return cachedImage(
    "jewellery",
    h,
    () =>
      hintAssumed(`${role} try-on`, async () => {
        const [s, r] = await Promise.all([uploadFile(person, "jewellery"), uploadFile(jewellery, "jewellery")]);
        // The live API wants BOTH the file-id form and the source_info/object_infos form.
        const parameter: Record<string, unknown> = {};
        if (opts?.shadowIntensity != null) parameter[spec.shadowField] = opts.shadowIntensity;
        if (opts?.ambientLightIntensity != null) parameter[spec.ambientField] = opts.ambientLightIntensity;
        const body: Record<string, unknown> = {
          src_file_id: s,
          ref_file_ids: [r],
          source_info: { name: s },
          object_infos: [{ name: r, ...(Object.keys(parameter).length ? { parameter } : {}) }],
        };
        const t = await createTask("jewellery", body, spec.path);
        return resultUrl(await pollTask("jewellery", t, 120_000, spec.path));
      }),
    opts
  );
}
