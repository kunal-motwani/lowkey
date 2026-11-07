/**
 * Browser-side photo quality gate. Everything here runs on the user's device: the detectors are
 * MediaPipe Tasks Vision models served from /models and /mediapipe/wasm, nothing is uploaded.
 *
 * Layout: pure evaluators (unit-tested, no DOM) -> thin DOM rasteriser -> lazy detector wrappers
 * -> checkPhoto / liveGuidance orchestration. Detector failure never throws; it degrades to a warning.
 */
import type { CheckStatus, PhotoMode, QualityCheck, QualityReport } from "./types";
import { lightingHint, meanLuma } from "./camera";

/* ---------- Thresholds (named, commented) ---------- */

/** YouCam skin analysis rejects faces narrower than 60% of the image width. Below this is a hard FAIL. */
export const FACE_MIN_WIDTH_RATIO = 0.6;
/** Horizontal offset of the face centre from the image centre (fraction of width): warn / fail. */
export const FACE_OFFCENTRE_X_WARN = 0.1;
export const FACE_OFFCENTRE_X_FAIL = 0.2;
/** Vertical target for the face centre (slightly above middle, like the guide oval) and tolerance. */
export const FACE_TARGET_Y = 0.45;
export const FACE_OFFCENTRE_Y_WARN = 0.15;
export const FACE_OFFCENTRE_Y_FAIL = 0.28;
/** Margin between face box and frame edge (fraction of the dimension): below WARN is "touching", <0 is cut off. */
export const FACE_EDGE_WARN = 0.02;
export const FACE_EDGE_FAIL = -0.01;

/** Mean luma 0-255 (see lib/camera.ts lightingHint: <70 dark, >215 bright). */
export const LUMA_FAIL_DARK = 45;
export const LUMA_FAIL_BRIGHT = 240;
/** Left/right half brightness difference that suggests harsh side lighting. */
export const LUMA_UNEVEN_WARN = 60;

/** Laplacian variance on a <=256px grayscale. Below FAIL the photo is clearly blurry; below WARN it is soft. */
export const SHARPNESS_FAIL = 18;
export const SHARPNESS_WARN = 45;
/** Longest side of the grayscale used for sharpness/lighting. */
export const ANALYSIS_MAX_SIDE = 256;
/** Longest side of the image handed to the detectors (they resize internally anyway). */
export const DETECT_MAX_SIDE = 960;

/** Shorter side in pixels: below MIN fails, below GOOD warns. */
export const RESOLUTION_MIN = 512;
export const RESOLUTION_GOOD = 768;

/** Pose landmark must have visibility/presence >= this to count as seen. */
export const LANDMARK_MIN_VISIBILITY = 0.5;
/** Landmarks must be inside the frame (normalised, with a small tolerance). */
export const LANDMARK_FRAME_TOLERANCE = 0.01;
/** Head-to-feet span as a fraction of the image height. */
export const BODY_MIN_HEIGHT_RATIO = 0.7;
/** Shoulder width / torso length. ~0.8-1.3 facing the camera, much lower when turned side-on. */
export const BODY_FACING_WARN = 0.55;
export const BODY_FACING_FAIL = 0.3;
/** Degrees of shoulder-line tilt / torso lean from vertical before warning. */
export const BODY_TILT_WARN_DEG = 12;
export const BODY_LEAN_WARN_DEG = 15;

/* ---------- Types ---------- */

/** Pixel-space face box. */
export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface FaceDetection {
  faces: FaceBox[];
}
/** Normalised (0-1) pose landmark, MediaPipe layout (33 points). */
export interface PoseLandmark {
  x: number;
  y: number;
  visibility?: number;
  presence?: number;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const chk = (id: string, label: string, status: CheckStatus, message: string, tip?: string): QualityCheck =>
  tip ? { id, label, status, message, tip } : { id, label, status, message };

/* ---------- Pure evaluators ---------- */

export function buildReport(mode: PhotoMode, checks: QualityCheck[]): QualityReport {
  return { mode, ok: !checks.some((c) => c.status === "fail"), checks };
}

export function evaluateFace(detection: FaceDetection | FaceBox[], imgW: number, imgH: number): QualityCheck[] {
  const faces = Array.isArray(detection) ? detection : detection.faces;
  if (faces.length === 0) {
    return [
      chk(
        "face-found",
        "Face",
        "fail",
        "No face found in the photo.",
        "Face the camera in good light, remove sunglasses or a mask, and keep your whole face in the frame."
      ),
    ];
  }
  const out: QualityCheck[] = [];
  if (faces.length > 1) {
    out.push(
      chk(
        "face-count",
        "One person",
        "fail",
        `${faces.length} faces found.`,
        "Make sure only you are in the photo, or crop the photo to just your face."
      )
    );
  } else {
    out.push(chk("face-count", "One person", "pass", "One face found."));
  }
  const f = [...faces].sort((a, b) => b.w * b.h - a.w * a.h)[0];

  const ratio = f.w / imgW;
  out.push(
    ratio + 1e-9 >= FACE_MIN_WIDTH_RATIO
      ? chk("face-size", "Face size", "pass", `Your face fills ${pct(ratio)} of the photo width.`)
      : chk(
          "face-size",
          "Face size",
          "fail",
          `Your face is only ${pct(ratio)} of the photo width; it needs to be at least ${pct(FACE_MIN_WIDTH_RATIO)}.`,
          "Move closer until your face fills the oval"
        )
  );

  const dx = Math.abs((f.x + f.w / 2) / imgW - 0.5);
  const dy = Math.abs((f.y + f.h / 2) / imgH - FACE_TARGET_Y);
  if (dx > FACE_OFFCENTRE_X_FAIL || dy > FACE_OFFCENTRE_Y_FAIL) {
    out.push(chk("face-centre", "Centred", "fail", "Your face is well off-centre.", "Centre your face in the oval."));
  } else if (dx > FACE_OFFCENTRE_X_WARN || dy > FACE_OFFCENTRE_Y_WARN) {
    out.push(
      chk("face-centre", "Centred", "warn", "Your face is a little off-centre.", "Centre your face in the oval.")
    );
  } else {
    out.push(chk("face-centre", "Centred", "pass", "Your face is centred."));
  }

  const margin = Math.min(f.x / imgW, (imgW - f.x - f.w) / imgW, f.y / imgH, (imgH - f.y - f.h) / imgH);
  if (margin < FACE_EDGE_FAIL) {
    out.push(
      chk(
        "face-edge",
        "Whole face in frame",
        "fail",
        "Part of your face is cut off.",
        "Move back slightly or re-centre so your whole face is inside the frame."
      )
    );
  } else if (margin < FACE_EDGE_WARN) {
    out.push(
      chk(
        "face-edge",
        "Whole face in frame",
        "warn",
        "Your face is touching the edge of the photo.",
        "Leave a little space around your head."
      )
    );
  } else {
    out.push(chk("face-edge", "Whole face in frame", "pass", "Your whole face is inside the frame."));
  }
  return out;
}

const L = { nose: 0, lShoulder: 11, rShoulder: 12, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28 };
const REQUIRED: { name: string; idx: number[] }[] = [
  { name: "head", idx: [L.nose] },
  { name: "shoulders", idx: [L.lShoulder, L.rShoulder] },
  { name: "hips", idx: [L.lHip, L.rHip] },
  { name: "knees", idx: [L.lKnee, L.rKnee] },
  { name: "ankles", idx: [L.lAnkle, L.rAnkle] },
];

const seen = (p: PoseLandmark | undefined): p is PoseLandmark => {
  if (!p) return false;
  const v = Math.min(p.visibility ?? 1, p.presence ?? 1);
  return v >= LANDMARK_MIN_VISIBILITY;
};
const inFrame = (p: PoseLandmark) =>
  p.x >= -LANDMARK_FRAME_TOLERANCE &&
  p.x <= 1 + LANDMARK_FRAME_TOLERANCE &&
  p.y >= -LANDMARK_FRAME_TOLERANCE &&
  p.y <= 1 + LANDMARK_FRAME_TOLERANCE;

const spanY = (pose: PoseLandmark[]) => {
  const ys = pose.filter(seen).map((p) => p.y);
  return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
};

/** `landmarks` is one pose (33 points) or a list of poses (one entry per person). */
export function evaluateBody(landmarks: PoseLandmark[] | PoseLandmark[][], imgW: number, imgH: number): QualityCheck[] {
  const poses: PoseLandmark[][] =
    landmarks.length > 0 && Array.isArray(landmarks[0])
      ? (landmarks as PoseLandmark[][])
      : landmarks.length
        ? [landmarks as PoseLandmark[]]
        : [];
  if (poses.length === 0) {
    return [
      chk(
        "body-found",
        "Person",
        "fail",
        "No person found in the photo.",
        "Stand fully in the frame, facing the camera, in good light."
      ),
    ];
  }
  const out: QualityCheck[] = [];
  if (poses.length > 1) {
    out.push(
      chk("body-count", "One person", "fail", `${poses.length} people found.`, "Make sure only you are in the photo.")
    );
  } else {
    out.push(chk("body-count", "One person", "pass", "One person found."));
  }
  const p = [...poses].sort((a, b) => spanY(b) - spanY(a))[0];

  // Which key body parts are missing (low visibility) or outside the frame?
  const missing = REQUIRED.filter(({ idx }) => idx.some((i) => !seen(p[i]) || !inFrame(p[i]))).map((r) => r.name);
  if (missing.length) {
    out.push(
      chk(
        "body-visible",
        "Whole body in frame",
        "fail",
        `Can't see your ${missing.join(", ")}.`,
        "Step back so your whole body fits, head to feet, with nothing blocking you."
      )
    );
  } else {
    out.push(chk("body-visible", "Whole body in frame", "pass", "Head to feet are visible."));
  }

  const nose = p[L.nose];
  const sh = [p[L.lShoulder], p[L.rShoulder]];
  const hip = [p[L.lHip], p[L.rHip]];
  const ank = [p[L.lAnkle], p[L.rAnkle]];
  if (seen(nose) && sh.every(seen) && ank.some(seen)) {
    const shMidY = (sh[0].y + sh[1].y) / 2;
    // The nose sits below the top of the head by roughly 0.8x the nose-to-shoulder distance.
    const top = nose.y - 0.8 * Math.max(0, shMidY - nose.y);
    const bottom = Math.max(...ank.filter(seen).map((a) => a.y));
    const ratio = Math.max(0, bottom - Math.max(top, 0));
    out.push(
      ratio >= BODY_MIN_HEIGHT_RATIO
        ? chk("body-height", "Body size", "pass", `You fill about ${pct(ratio)} of the photo height.`)
        : chk(
            "body-height",
            "Body size",
            "fail",
            `You fill only about ${pct(ratio)} of the photo height; aim for at least ${pct(BODY_MIN_HEIGHT_RATIO)}.`,
            "Move closer or lower the camera so head to feet fills most of the frame."
          )
    );
  } else if (!missing.length) {
    out.push(chk("body-height", "Body size", "warn", "Couldn't measure your height in the frame."));
  }

  if (sh.every(seen) && hip.every(seen)) {
    const swx = (sh[1].x - sh[0].x) * imgW;
    const swy = (sh[1].y - sh[0].y) * imgH;
    const shoulderW = Math.hypot(swx, swy);
    const mx = ((sh[0].x + sh[1].x) / 2 - (hip[0].x + hip[1].x) / 2) * imgW;
    const my = ((sh[0].y + sh[1].y) / 2 - (hip[0].y + hip[1].y) / 2) * imgH;
    const torso = Math.hypot(mx, my) || 1e-6;
    const facing = shoulderW / torso;
    if (facing < BODY_FACING_FAIL) {
      out.push(
        chk(
          "body-facing",
          "Facing forward",
          "fail",
          "You look turned sideways.",
          "Face the camera with your shoulders square to it."
        )
      );
    } else if (facing < BODY_FACING_WARN) {
      out.push(
        chk(
          "body-facing",
          "Facing forward",
          "warn",
          "You look slightly turned.",
          "Face the camera with your shoulders square to it."
        )
      );
    } else {
      out.push(chk("body-facing", "Facing forward", "pass", "You are facing the camera."));
    }
    const tilt = Math.abs((Math.atan2(swy, Math.abs(swx) || 1e-6) * 180) / Math.PI);
    const lean = Math.abs((Math.atan2(mx, Math.abs(my) || 1e-6) * 180) / Math.PI);
    if (tilt > BODY_TILT_WARN_DEG || lean > BODY_LEAN_WARN_DEG) {
      out.push(
        chk(
          "body-upright",
          "Standing upright",
          "warn",
          "You look tilted or leaning.",
          "Stand straight, weight even on both feet, and hold the camera level."
        )
      );
    } else {
      out.push(chk("body-upright", "Standing upright", "pass", "You are standing upright."));
    }
  }
  return out;
}

export function resolutionCheck(w: number, h: number): QualityCheck {
  const short = Math.min(w, h);
  if (short < RESOLUTION_MIN) {
    return chk(
      "resolution",
      "Resolution",
      "fail",
      `The photo is small (${w}x${h}).`,
      `Use a photo whose shorter side is at least ${RESOLUTION_MIN}px.`
    );
  }
  if (short < RESOLUTION_GOOD) {
    return chk(
      "resolution",
      "Resolution",
      "warn",
      `The photo is on the small side (${w}x${h}).`,
      `Results are best at ${RESOLUTION_GOOD}px or more on the shorter side.`
    );
  }
  return chk("resolution", "Resolution", "pass", `Resolution is good (${w}x${h}).`);
}

/** Body photos work best in portrait; landscape wastes frame width. */
export function orientationCheck(w: number, h: number): QualityCheck {
  return w >= h
    ? chk(
        "orientation",
        "Portrait photo",
        "warn",
        "The photo is landscape.",
        "A portrait (3:4) photo fits head to feet better."
      )
    : chk("orientation", "Portrait photo", "pass", "Portrait orientation.");
}

/** `leftRightDiff` is |left half luma - right half luma|. */
export function lightingCheck(luma: number, leftRightDiff = 0): QualityCheck {
  const hint = lightingHint(luma);
  if (luma < LUMA_FAIL_DARK) {
    return chk(
      "lighting",
      "Lighting",
      "fail",
      "The photo is too dark.",
      "Face a window or move to brighter, natural light."
    );
  }
  if (luma > LUMA_FAIL_BRIGHT) {
    return chk("lighting", "Lighting", "fail", "The photo is too bright.", "Step back from direct light or glare.");
  }
  if (hint === "dark") {
    return chk(
      "lighting",
      "Lighting",
      "warn",
      "The photo is a bit dark.",
      "Face a window or move to brighter, natural light."
    );
  }
  if (hint === "bright") {
    return chk("lighting", "Lighting", "warn", "The photo is a bit bright.", "Step back from direct light or glare.");
  }
  if (leftRightDiff > LUMA_UNEVEN_WARN) {
    return chk(
      "lighting",
      "Lighting",
      "warn",
      "One side is much brighter than the other.",
      "Face the light source so both sides are evenly lit."
    );
  }
  return chk("lighting", "Lighting", "pass", "Lighting looks good.");
}

/** Variance of the 4-neighbour Laplacian over a grayscale image (row-major, w*h). Higher = sharper. */
export function sharpnessScore(gray: ArrayLike<number>, w: number, h: number): number {
  if (w < 3 || h < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export function sharpnessCheck(score: number): QualityCheck {
  if (score < SHARPNESS_FAIL) {
    return chk(
      "sharpness",
      "Sharpness",
      "fail",
      "The photo is blurry.",
      "Hold the phone steady, clean the lens, and tap to focus before shooting."
    );
  }
  if (score < SHARPNESS_WARN) {
    return chk(
      "sharpness",
      "Sharpness",
      "warn",
      "The photo is slightly soft.",
      "Hold still and make sure the camera has focused."
    );
  }
  return chk("sharpness", "Sharpness", "pass", "The photo is sharp.");
}

/** RGBA -> grayscale (Rec.709 weights) plus overall and left/right-half brightness. */
export function analyzePixels(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number) {
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    gray[p] = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  const half = Math.floor(w / 2);
  let l = 0;
  let r = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < half) l += gray[y * w + x];
      else if (x >= w - half) r += gray[y * w + x];
    }
  }
  const denom = Math.max(1, half * h);
  return { gray, luma: meanLuma(rgba), leftRightDiff: Math.abs(l - r) / denom };
}

/* ---------- Live guidance (pure) ---------- */

export interface LiveGuidance {
  message: string;
  ready: boolean;
  /** The check that drives the message, if any. */
  check?: QualityCheck;
}

const LIVE_PRIORITY = [
  "face-found",
  "body-found",
  "face-count",
  "body-count",
  "body-visible",
  "body-height",
  "face-size",
  "face-edge",
  "face-centre",
  "body-facing",
  "body-upright",
  "lighting",
  "detector",
];
const LIVE_MESSAGE: Record<string, string> = {
  "face-found": "Show your face to the camera",
  "body-found": "Step into the frame",
  "face-count": "Only one person in the frame, please",
  "body-count": "Only one person in the frame, please",
  "face-size": "Move closer",
  "face-edge": "Move back slightly, your face is cut off",
  "face-centre": "Centre your face",
  "body-visible": "Step back so your whole body fits",
  "body-height": "Move closer or tilt the phone so head to feet fills the frame",
  "body-facing": "Face the camera",
  "body-upright": "Stand straight",
};

/** Pick the single most important message from live checks. */
export function guidanceFromChecks(checks: QualityCheck[], mode: PhotoMode): LiveGuidance {
  const bad = checks.filter((c) => c.status !== "pass" && c.id !== "detector");
  if (bad.length === 0) {
    const unchecked = checks.some((c) => c.id === "detector");
    return {
      message: unchecked
        ? "Line up in the frame, then take the photo"
        : mode === "face"
          ? "Perfect, hold still"
          : "Great, hold still",
      ready: !unchecked,
    };
  }
  const rank = (c: QualityCheck) => {
    const i = LIVE_PRIORITY.indexOf(c.id);
    return (c.status === "fail" ? 0 : 100) + (i < 0 ? 50 : i);
  };
  const top = [...bad].sort((a, b) => rank(a) - rank(b))[0];
  let message = LIVE_MESSAGE[top.id] ?? top.message;
  if (top.id === "lighting") {
    message = /dark/i.test(top.message)
      ? "Too dark: face a window"
      : /bright/i.test(top.message) && !/other/i.test(top.message)
        ? "Too bright: step out of the glare"
        : "Face the light so both sides are even";
  }
  return { message, ready: false, check: top };
}

/* ---------- DOM rasteriser ---------- */

export type PhotoSource = HTMLImageElement | HTMLVideoElement | ImageBitmap | HTMLCanvasElement;

export interface Raster {
  /** Canvas handed to the detectors. */
  detect: HTMLCanvasElement;
  w: number;
  h: number;
  /** Original pixel size of the source (before downscale / crop). */
  origW: number;
  origH: number;
  /** Small RGBA buffer for lighting + sharpness. */
  small: { data: Uint8ClampedArray; width: number; height: number };
}

function sourceSize(s: PhotoSource): { w: number; h: number } {
  const a = s as HTMLVideoElement & HTMLImageElement;
  if ("videoWidth" in a && a.videoWidth) return { w: a.videoWidth, h: a.videoHeight };
  if ("naturalWidth" in a && a.naturalWidth) return { w: a.naturalWidth, h: a.naturalHeight };
  return { w: (s as HTMLCanvasElement).width, h: (s as HTMLCanvasElement).height };
}

/** Draw `source` (optionally centre-cropped to 3:4 portrait, as the capture does) onto a bounded canvas. */
export function rasterize(source: PhotoSource, maxSide = DETECT_MAX_SIDE, cropPortrait = false): Raster | null {
  if (typeof document === "undefined") return null;
  const { w: ow, h: oh } = sourceSize(source);
  if (!ow || !oh) return null;
  let sx = 0;
  let sy = 0;
  let sw = ow;
  let sh = oh;
  if (cropPortrait) {
    sw = Math.min(ow, oh * 0.75);
    sh = sw / 0.75;
    sx = (ow - sw) / 2;
    sy = (oh - sh) / 2;
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const detect = document.createElement("canvas");
  detect.width = w;
  detect.height = h;
  const ctx = detect.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  const k = Math.min(1, ANALYSIS_MAX_SIDE / Math.max(w, h));
  const aw = Math.max(1, Math.round(w * k));
  const ah = Math.max(1, Math.round(h * k));
  const small = document.createElement("canvas");
  small.width = aw;
  small.height = ah;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;
  sctx.drawImage(detect, 0, 0, aw, ah);
  const img = sctx.getImageData(0, 0, aw, ah);
  return {
    detect,
    w,
    h,
    origW: cropPortrait ? Math.round(sw) : ow,
    origH: cropPortrait ? Math.round(sh) : oh,
    small: { data: img.data, width: aw, height: ah },
  };
}

/* ---------- Lazy detectors ---------- */

export const WASM_PATH = "/mediapipe/wasm";
export const FACE_MODEL_PATH = "/models/blaze_face_short_range.tflite";
export const POSE_MODEL_PATH = "/models/pose_landmarker_lite.task";

type Vision = typeof import("@mediapipe/tasks-vision");
let visionPromise: Promise<{
  lib: Vision;
  fileset: Awaited<ReturnType<Vision["FilesetResolver"]["forVisionTasks"]>>;
} | null> | null = null;
let facePromise: Promise<import("@mediapipe/tasks-vision").FaceDetector | null> | null = null;
let posePromise: Promise<import("@mediapipe/tasks-vision").PoseLandmarker | null> | null = null;

function loadVision() {
  visionPromise ??= (async () => {
    try {
      const lib = await import("@mediapipe/tasks-vision");
      const fileset = await lib.FilesetResolver.forVisionTasks(WASM_PATH);
      return { lib, fileset };
    } catch {
      return null;
    }
  })();
  return visionPromise;
}

async function withDelegateFallback<T>(make: (delegate: "GPU" | "CPU") => Promise<T>): Promise<T | null> {
  for (const d of ["GPU", "CPU"] as const) {
    try {
      return await make(d);
    } catch {
      /* try the next delegate */
    }
  }
  return null;
}

/** Face boxes in pixels of `source`, or null if the detector is unavailable. Never throws. */
export async function detectFaces(
  source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | ImageBitmap
): Promise<FaceDetection | null> {
  try {
    facePromise ??= (async () => {
      const v = await loadVision();
      if (!v) return null;
      return withDelegateFallback((delegate) =>
        v.lib.FaceDetector.createFromOptions(v.fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate },
          runningMode: "IMAGE",
          minDetectionConfidence: 0.5,
        })
      );
    })();
    const det = await facePromise;
    if (!det) return null;
    const res = det.detect(source);
    return {
      faces: res.detections
        .filter((d) => d.boundingBox)
        .map((d) => ({
          x: d.boundingBox!.originX,
          y: d.boundingBox!.originY,
          w: d.boundingBox!.width,
          h: d.boundingBox!.height,
        })),
    };
  } catch {
    return null;
  }
}

/** Pose landmarks (one array per person), or null if the detector is unavailable. Never throws. */
export async function detectPoses(
  source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | ImageBitmap
): Promise<PoseLandmark[][] | null> {
  try {
    posePromise ??= (async () => {
      const v = await loadVision();
      if (!v) return null;
      return withDelegateFallback((delegate) =>
        v.lib.PoseLandmarker.createFromOptions(v.fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate },
          runningMode: "IMAGE",
          numPoses: 2,
          minPoseDetectionConfidence: 0.5,
        })
      );
    })();
    const det = await posePromise;
    if (!det) return null;
    const res = det.detect(source);
    return res.landmarks.map((pose) => pose.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility })));
  } catch {
    return null;
  }
}

/* ---------- Orchestration ---------- */

export interface Deps {
  rasterize: typeof rasterize;
  detectFaces: typeof detectFaces;
  detectPoses: typeof detectPoses;
}
const defaultDeps: Deps = { rasterize, detectFaces, detectPoses };

const UNAVAILABLE = chk(
  "detector",
  "Automatic check",
  "warn",
  "Automatic face/body check unavailable",
  "We couldn't run the automatic check, so make sure the guide above is satisfied by eye."
);

/** Same as checkPhoto with injectable dependencies (used by tests). */
export async function checkPhotoWith(
  source: PhotoSource,
  mode: PhotoMode,
  deps: Partial<Deps> = {}
): Promise<QualityReport> {
  const d = { ...defaultDeps, ...deps };
  const checks: QualityCheck[] = [];
  try {
    const r = d.rasterize(source, DETECT_MAX_SIDE, false);
    if (!r) {
      checks.push(UNAVAILABLE);
      const { w, h } = sourceSize(source);
      if (w && h) checks.push(resolutionCheck(w, h));
      return buildReport(mode, checks);
    }
    if (mode === "face") {
      const det = await d.detectFaces(r.detect);
      checks.push(...(det ? evaluateFace(det, r.w, r.h) : [UNAVAILABLE]));
    } else {
      const poses = await d.detectPoses(r.detect);
      checks.push(...(poses ? evaluateBody(poses, r.w, r.h) : [UNAVAILABLE]));
    }
    const px = analyzePixels(r.small.data, r.small.width, r.small.height);
    checks.push(lightingCheck(px.luma, px.leftRightDiff));
    checks.push(sharpnessCheck(sharpnessScore(px.gray, r.small.width, r.small.height)));
    checks.push(resolutionCheck(r.origW, r.origH));
    if (mode === "body") checks.push(orientationCheck(r.origW, r.origH));
  } catch {
    if (!checks.some((c) => c.id === "detector")) checks.push(UNAVAILABLE);
  }
  return buildReport(mode, checks);
}

/** Full quality report for a photo. Never throws; detector failure becomes a warn check. */
export function checkPhoto(source: PhotoSource, mode: PhotoMode): Promise<QualityReport> {
  return checkPhotoWith(source, mode);
}

/** Fast checks for the live preview (detector + lighting) on the same 3:4 crop the capture uses. */
export async function liveCheck(
  video: HTMLVideoElement,
  mode: PhotoMode,
  deps: Partial<Deps> = {}
): Promise<LiveGuidance> {
  const d = { ...defaultDeps, ...deps };
  const r = d.rasterize(video, 480, true);
  if (!r) return { message: "Starting camera", ready: false };
  const checks: QualityCheck[] = [];
  if (mode === "face") {
    const det = await d.detectFaces(r.detect);
    checks.push(...(det ? evaluateFace(det, r.w, r.h) : [UNAVAILABLE]));
  } else {
    const poses = await d.detectPoses(r.detect);
    checks.push(...(poses ? evaluateBody(poses, r.w, r.h) : [UNAVAILABLE]));
  }
  const px = analyzePixels(r.small.data, r.small.width, r.small.height);
  checks.push(lightingCheck(px.luma, px.leftRightDiff));
  return guidanceFromChecks(checks, mode);
}
