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

/** Face photo: space below the chin (fraction of the face-box height) needed to show the neck for necklaces. */
export const NECK_MIN_BELOW_CHIN_RATIO = 0.25;

/** Hand photo (bracelet / ring try-on). The hand box is the bounding box of the 21 landmarks. */
export const HAND_MIN_SIZE_RATIO = 0.35; // hand box width OR height as a fraction of the image; below = FAIL
export const HAND_EDGE_WARN = 0.02; // a landmark closer than this to the edge = touching, WARN
export const HAND_WRIST_EDGE_WARN = 0.05; // wrist this close to an edge = WARN (needs room for a bracelet)
/** Mean gap between adjacent fingertips (index..pinky) / palm width. Fingers pressed together is about 0.33. */
export const HAND_SPREAD_MIN = 0.4;
/** Handedness confidence below this is treated as unknown when judging back-of-hand vs palm. */
export const HAND_HANDEDNESS_MIN_SCORE = 0.6;

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

/** One detected hand: 21 normalised landmarks (MediaPipe layout) plus the model's handedness label, if any. */
export interface HandObservation {
  landmarks: PoseLandmark[];
  /** MediaPipe label. It assumes a MIRRORED (selfie) image; our photos are not mirrored, so it is flipped on use. */
  handedness?: "Left" | "Right";
  score?: number;
}
export interface HandDetection {
  hands: HandObservation[];
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

  // Neck / shoulders: the space under the chin must be at least ~25% of the face height (WARN only).
  const below = (imgH - (f.y + f.h)) / Math.max(f.h, 1e-6);
  out.push(
    below >= NECK_MIN_BELOW_CHIN_RATIO
      ? chk("neck-visible", "Neck and shoulders", "pass", "There is room below your chin to show your neck.")
      : chk(
          "neck-visible",
          "Neck and shoulders",
          "warn",
          "Your neck and shoulders look cropped.",
          "Include your neck and shoulders so necklaces can be shown"
        )
  );
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

/* Hand landmarks: 0 wrist, 5 index mcp, 17 pinky mcp, tips 4/8/12/16/20, pips 6/10/14/18. */
const H = {
  wrist: 0,
  indexMcp: 5,
  pinkyMcp: 17,
  tips: [4, 8, 12, 16, 20],
  fingerTips: [8, 12, 16, 20],
  pips: [6, 10, 14, 18],
};
const HAND_TIP = "Place your hand flat, back of the hand towards the camera, fingers slightly apart, wrist in view";

function handBoxSize(h: HandObservation) {
  const xs = h.landmarks.map((p) => p.x);
  const ys = h.landmarks.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/**
 * Is the back of the hand towards the camera? true / false, or null when it cannot be told.
 * Image y points down. For a RIGHT hand seen from the palm side, (wrist->index_mcp) x (wrist->pinky_mcp)
 * is negative and for the back it is positive (signs swap for a left hand). MediaPipe's handedness
 * assumes a mirrored image and our photos are not mirrored, so the label is flipped.
 */
export function backOfHandFacing(h: HandObservation, imgW: number, imgH: number): boolean | null {
  const lm = h.landmarks;
  if (lm.length < 21 || !h.handedness || (h.score ?? 1) < HAND_HANDEDNESS_MIN_SCORE) return null;
  const w = lm[H.wrist];
  const ax = (lm[H.indexMcp].x - w.x) * imgW;
  const ay = (lm[H.indexMcp].y - w.y) * imgH;
  const bx = (lm[H.pinkyMcp].x - w.x) * imgW;
  const by = (lm[H.pinkyMcp].y - w.y) * imgH;
  const cross = ax * by - ay * bx;
  if (Math.abs(cross) < 1e-6) return null;
  const actualRight = h.handedness === "Left"; // flipped: the image is not mirrored
  return actualRight ? cross > 0 : cross < 0;
}

export function evaluateHand(detection: HandDetection | HandObservation[], imgW: number, imgH: number): QualityCheck[] {
  const hands = (Array.isArray(detection) ? detection : detection.hands).filter((h) => h.landmarks.length >= 21);
  if (hands.length === 0) {
    return [chk("hand-found", "Hand", "fail", "No hand found in the photo.", `${HAND_TIP}. Use good light.`)];
  }
  const out: QualityCheck[] = [];
  if (hands.length > 1) {
    out.push(chk("hand-count", "One hand", "fail", `${hands.length} hands found.`, "Show only one hand in the photo."));
  } else {
    out.push(chk("hand-count", "One hand", "pass", "One hand found."));
  }
  const hand = [...hands].sort((a, b) => handBoxSize(b) - handBoxSize(a))[0];
  const lm = hand.landmarks;

  // All five fingertips must be inside the frame.
  const tipsOut = H.tips.filter((i) => !inFrame(lm[i])).length;
  const outside = lm.filter((p) => !inFrame(p)).length;
  const margin = Math.min(...lm.flatMap((p) => [p.x, 1 - p.x, p.y, 1 - p.y]));
  if (tipsOut > 0 || outside > 2) {
    out.push(
      chk(
        "hand-fingers",
        "All fingers in frame",
        "fail",
        tipsOut > 0 ? "Some fingertips are cut off." : "Part of your hand is cut off.",
        "Move your hand back a little so all five fingers are inside the frame."
      )
    );
  } else if (margin < HAND_EDGE_WARN) {
    out.push(
      chk(
        "hand-fingers",
        "All fingers in frame",
        "warn",
        "Your hand is touching the edge of the photo.",
        "Leave a little space around your fingers."
      )
    );
  } else {
    out.push(chk("hand-fingers", "All fingers in frame", "pass", "All five fingers are inside the frame."));
  }

  const size = handBoxSize(hand);
  out.push(
    size >= HAND_MIN_SIZE_RATIO
      ? chk("hand-size", "Hand size", "pass", `Your hand fills about ${pct(size)} of the photo.`)
      : chk(
          "hand-size",
          "Hand size",
          "fail",
          `Your hand fills only about ${pct(size)} of the photo; it needs to be at least ${pct(HAND_MIN_SIZE_RATIO)}.`,
          "Move closer so your hand fills more of the frame."
        )
  );

  const wr = lm[H.wrist];
  if (!inFrame(wr)) {
    out.push(
      chk(
        "hand-wrist",
        "Wrist visible",
        "fail",
        "Your wrist is outside the frame.",
        "Show your wrist, with a little forearm, so a bracelet can be placed."
      )
    );
  } else if (Math.min(wr.x, 1 - wr.x, wr.y, 1 - wr.y) < HAND_WRIST_EDGE_WARN) {
    out.push(
      chk(
        "hand-wrist",
        "Wrist visible",
        "warn",
        "Your wrist is right at the edge of the photo.",
        "Leave room below your hand so your wrist is clearly in view."
      )
    );
  } else {
    out.push(chk("hand-wrist", "Wrist visible", "pass", "Your wrist is in view."));
  }

  // Back of the hand: a heuristic, so uncertainty or a palm reading is only ever a warning.
  const back = backOfHandFacing(hand, imgW, imgH);
  if (back === true) {
    out.push(chk("hand-back", "Back of hand", "pass", "The back of your hand faces the camera."));
  } else if (back === false) {
    out.push(chk("hand-back", "Back of hand", "warn", "This looks like the palm side of your hand.", HAND_TIP));
  } else {
    out.push(
      chk(
        "hand-back",
        "Back of hand",
        "warn",
        "We couldn't tell which side of your hand faces the camera.",
        "Make sure the back of your hand faces the camera."
      )
    );
  }

  // Fingers flat and slightly apart (heuristic warning).
  const d = (a: number, b: number) => Math.hypot((lm[a].x - lm[b].x) * imgW, (lm[a].y - lm[b].y) * imgH);
  const curled = H.fingerTips.some((tip, k) => d(H.wrist, tip) <= d(H.wrist, H.pips[k]));
  const palmW = d(H.indexMcp, H.pinkyMcp) || 1e-6;
  const gap = (d(8, 12) + d(12, 16) + d(16, 20)) / 3 / palmW;
  if (curled) {
    out.push(chk("hand-spread", "Fingers flat", "warn", "Some fingers look curled.", HAND_TIP));
  } else if (gap < HAND_SPREAD_MIN) {
    out.push(
      chk(
        "hand-spread",
        "Fingers flat",
        "warn",
        "Your fingers are pressed together.",
        "Spread your fingers slightly apart."
      )
    );
  } else {
    out.push(chk("hand-spread", "Fingers flat", "pass", "Your hand is flat with fingers apart."));
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
  "hand-found",
  "hand-count",
  "hand-fingers",
  "hand-wrist",
  "hand-size",
  "hand-back",
  "hand-spread",
  "neck-visible",
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
  "hand-found": "Show the back of your hand to the camera",
  "hand-count": "Only one hand in the frame, please",
  "hand-fingers": "Keep all five fingers inside the frame",
  "hand-wrist": "Show your wrist in the frame",
  "hand-size": "Move your hand closer",
  "hand-back": "Turn your hand so the back faces the camera",
  "hand-spread": "Spread your fingers slightly",
  "neck-visible": "Include your neck and shoulders",
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
export const HAND_MODEL_PATH = "/models/hand_landmarker.task";

type Vision = typeof import("@mediapipe/tasks-vision");
let visionPromise: Promise<{
  lib: Vision;
  fileset: Awaited<ReturnType<Vision["FilesetResolver"]["forVisionTasks"]>>;
} | null> | null = null;
let facePromise: Promise<import("@mediapipe/tasks-vision").FaceDetector | null> | null = null;
let handPromise: Promise<import("@mediapipe/tasks-vision").HandLandmarker | null> | null = null;
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

/** Hands (landmarks + handedness), or null if the detector is unavailable. Never throws. */
export async function detectHands(
  source: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | ImageBitmap
): Promise<HandDetection | null> {
  try {
    handPromise ??= (async () => {
      const v = await loadVision();
      if (!v) return null;
      return withDelegateFallback((delegate) =>
        v.lib.HandLandmarker.createFromOptions(v.fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL_PATH, delegate },
          runningMode: "IMAGE",
          numHands: 2,
          minHandDetectionConfidence: 0.5,
        })
      );
    })();
    const det = await handPromise;
    if (!det) return null;
    const res = det.detect(source);
    return {
      hands: res.landmarks.map((lm, i) => {
        const cat = res.handedness?.[i]?.[0];
        const label = cat?.categoryName === "Left" || cat?.categoryName === "Right" ? cat.categoryName : undefined;
        return { landmarks: lm.map((p) => ({ x: p.x, y: p.y })), handedness: label, score: cat?.score };
      }),
    };
  } catch {
    return null;
  }
}

/* ---------- Orchestration ---------- */

export interface Deps {
  rasterize: typeof rasterize;
  detectFaces: typeof detectFaces;
  detectPoses: typeof detectPoses;
  detectHands: typeof detectHands;
}
const defaultDeps: Deps = { rasterize, detectFaces, detectPoses, detectHands };

const UNAVAILABLE = chk(
  "detector",
  "Automatic check",
  "warn",
  "Automatic face/body check unavailable",
  "We couldn't run the automatic check, so make sure the guide above is satisfied by eye."
);

/** Run the detector for `mode` and evaluate it; a missing detector becomes a single warn check. */
async function detectorChecks(d: Deps, r: Raster, mode: PhotoMode): Promise<QualityCheck[]> {
  if (mode === "face") {
    const det = await d.detectFaces(r.detect);
    return det ? evaluateFace(det, r.w, r.h) : [UNAVAILABLE];
  }
  if (mode === "hand") {
    const det = await d.detectHands(r.detect);
    return det ? evaluateHand(det, r.w, r.h) : [UNAVAILABLE];
  }
  const poses = await d.detectPoses(r.detect);
  return poses ? evaluateBody(poses, r.w, r.h) : [UNAVAILABLE];
}

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
    checks.push(...(await detectorChecks(d, r, mode)));
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
  checks.push(...(await detectorChecks(d, r, mode)));
  const px = analyzePixels(r.small.data, r.small.width, r.small.height);
  checks.push(lightingCheck(px.luma, px.leftRightDiff));
  return guidanceFromChecks(checks, mode);
}
