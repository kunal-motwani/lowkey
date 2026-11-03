export type LightingHint = "dark" | "bright" | "ok";

/** Mean perceptual luma (0-255) of RGBA pixel data. */
export function meanLuma(data: Uint8ClampedArray | Uint8Array): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    n++;
  }
  return n ? sum / n : 0;
}

/** Lighting guidance for a selfie: skin analysis and colour estimates degrade in dim or blown-out light. */
export function lightingHint(luma: number): LightingHint {
  if (luma < 70) return "dark";
  if (luma > 215) return "bright";
  return "ok";
}

export const LIGHTING_MESSAGE: Record<LightingHint, string> = {
  dark: "Too dark. Face a window or move to brighter, natural light.",
  bright: "Too bright. Step back from direct light or glare.",
  ok: "Lighting looks good.",
};

export type CameraErrorKind = "denied" | "unsupported" | "no-camera" | "busy" | "error";

/** Map a getUserMedia failure to a friendly, actionable error kind. */
export function classifyCameraError(err: unknown): CameraErrorKind {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError")
    return "no-camera";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
  return "error";
}

export const CAMERA_ERROR_MESSAGE: Record<CameraErrorKind, string> = {
  denied: "Camera access was blocked. Allow the camera for this site in your browser settings, then try again.",
  unsupported: "Your browser can't open the camera here (it needs HTTPS or localhost). You can upload a photo instead.",
  "no-camera": "No camera was found on this device. You can upload a photo instead.",
  busy: "The camera is in use by another app. Close it and try again.",
  error: "Could not start the camera. You can upload a photo instead.",
};
