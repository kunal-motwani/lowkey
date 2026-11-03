"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CAMERA_ERROR_MESSAGE,
  LIGHTING_MESSAGE,
  classifyCameraError,
  lightingHint,
  meanLuma,
  type CameraErrorKind,
  type LightingHint,
} from "@/lib/camera";

type Phase = "starting" | "live" | "countdown" | "review" | "error";

interface Props {
  /** Called with the captured JPEG when the user accepts the photo. */
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Label for the accept button, e.g. "Use photo & analyse". */
  acceptLabel?: string;
}

const COUNTDOWN_SECONDS = 3;
const MAX_SIDE = 1280;

export default function CameraCapture({ onCapture, onClose, acceptLabel = "Use this photo" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [errorKind, setErrorKind] = useState<CameraErrorKind>("error");
  const [count, setCount] = useState(COUNTDOWN_SECONDS);
  const [light, setLight] = useState<LightingHint>("ok");
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setPhase("starting");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorKind("unsupported");
      setPhase("error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => undefined);
      }
      setPhase("live");
    } catch (e) {
      setErrorKind(classifyCameraError(e));
      setPhase("error");
    }
  }, []);

  // Open the camera on mount (this triggers the browser's permission prompt); always release it on unmount.
  useEffect(() => {
    void start();
    return stopStream;
  }, [start, stopStream]);

  // Revoke the preview URL when it changes or on unmount.
  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url);
    };
  }, [shot]);

  // Lightweight lighting check while the preview is live.
  useEffect(() => {
    if (phase !== "live" && phase !== "countdown") return;
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 24;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (!ctx || !v || v.videoWidth === 0) return;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      setLight(lightingHint(meanLuma(ctx.getImageData(0, 0, canvas.width, canvas.height).data)));
    }, 600);
    return () => window.clearInterval(id);
  }, [phase]);

  const snap = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    // Preview is mirrored for natural framing; the captured image is NOT mirrored.
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setErrorKind("error");
          setPhase("error");
          return;
        }
        const file = new File([blob], `selfie-${Date.now()}.jpg`, { type: "image/jpeg" });
        setShot({ file, url: URL.createObjectURL(file) });
        setPhase("review");
      },
      "image/jpeg",
      0.92
    );
  }, []);

  // Countdown so the user can settle before the shot.
  useEffect(() => {
    if (phase !== "countdown") return;
    if (count <= 0) {
      snap();
      return;
    }
    const id = window.setTimeout(() => setCount((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [phase, count, snap]);

  // Esc closes; move focus into the dialog.
  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const live = phase === "live" || phase === "countdown";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cam-h"
        className="card w-full max-w-md space-y-3 rounded-b-none outline-none sm:rounded-b-[1.25rem]"
      >
        <div className="flex items-center justify-between">
          <h2 id="cam-h" className="font-bold">
            Take a selfie
          </h2>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Live camera preview"
            className={`h-full w-full -scale-x-100 object-cover ${live || phase === "starting" ? "" : "hidden"}`}
          />
          {phase === "review" && shot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot.url} alt="Captured selfie" className="h-full w-full -scale-x-100 object-cover" />
          )}
          {live && (
            <svg viewBox="0 0 100 75" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
              <ellipse
                cx="50"
                cy="36"
                rx="19"
                ry="25"
                fill="none"
                stroke="white"
                strokeOpacity=".85"
                strokeWidth=".8"
                strokeDasharray="3 2"
              />
            </svg>
          )}
          {phase === "countdown" && count > 0 && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-extrabold text-white"
              aria-hidden="true"
            >
              {count}
            </div>
          )}
          {phase === "starting" && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white">
              Waiting for camera permission…
            </div>
          )}
          {phase === "error" && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white">
              {CAMERA_ERROR_MESSAGE[errorKind]}
            </div>
          )}
        </div>

        <p className="muted min-h-5 text-sm" role="status" aria-live="polite">
          {live && LIGHTING_MESSAGE[light]}
          {live && light === "ok" && " Centre your face in the oval."}
          {phase === "review" && "Happy with it? Your photo is only used for this analysis."}
        </p>

        <div className="flex gap-2">
          {live && (
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={phase === "countdown"}
              onClick={() => {
                setCount(COUNTDOWN_SECONDS);
                setPhase("countdown");
              }}
            >
              {phase === "countdown" ? `Hold still… ${Math.max(count, 0)}` : `Take photo (${COUNTDOWN_SECONDS}s timer)`}
            </button>
          )}
          {phase === "review" && shot && (
            <>
              <button
                type="button"
                className="btn-ghost flex-1"
                onClick={() => {
                  setShot(null);
                  setPhase("live");
                }}
              >
                Retake
              </button>
              <button type="button" className="btn-primary flex-1" onClick={() => onCapture(shot.file)}>
                {acceptLabel}
              </button>
            </>
          )}
          {phase === "error" && (
            <button type="button" className="btn-primary flex-1" onClick={() => void start()}>
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
