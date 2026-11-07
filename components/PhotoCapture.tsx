"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CAMERA_ERROR_MESSAGE, classifyCameraError, type CameraErrorKind } from "@/lib/camera";
import { checkPhoto, liveCheck, type LiveGuidance } from "@/lib/photo-quality";
import type { PhotoMode, QualityReport } from "@/lib/types";

type Phase = "starting" | "live" | "countdown" | "checking" | "review" | "error";

interface Props {
  mode: PhotoMode;
  /** Called with the captured JPEG and its quality report when the user accepts the photo. */
  onCapture: (file: File, report: QualityReport) => void;
  onClose: () => void;
}

const COUNTDOWN_SECONDS = 3;
const MAX_SIDE = 1600;
const LIVE_INTERVAL_MS = 250; // about 4 checks per second

const ICON = { pass: "✓", warn: "!", fail: "✕" } as const;
const STATUS_WORD = { pass: "Passed", warn: "Warning", fail: "Failed" } as const;

/** Checklist used by the camera review screen and the picker. */
export function QualityChecklist({ report }: { report: QualityReport }) {
  return (
    <ul className="pq-list" aria-label="Photo checks">
      {report.checks.map((c) => (
        <li key={c.id} className={`pq-item pq-${c.status}`}>
          <span className="pq-icon" aria-hidden="true">
            {ICON[c.status]}
          </span>
          <span>
            <span className="sr-only-live">{STATUS_WORD[c.status]}: </span>
            <strong>{c.label}.</strong> {c.message}
            {c.status !== "pass" && c.tip && <span className="muted"> {c.tip}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function PhotoCapture({ mode, onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const [phase, setPhase] = useState<Phase>("starting");
  const [errorKind, setErrorKind] = useState<CameraErrorKind>("error");
  const [count, setCount] = useState(COUNTDOWN_SECONDS);
  const [guide, setGuide] = useState<LiveGuidance>({ message: "Starting camera", ready: false });
  const [shot, setShot] = useState<{ file: File; url: string; report: QualityReport } | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setPhase("starting");
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
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

  useEffect(() => {
    void start();
    return stopStream; // always release the camera
  }, [start, stopStream]);

  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url);
    };
  }, [shot]);

  // Live guidance on the preview, about 4 times per second, never overlapping.
  useEffect(() => {
    if (phase !== "live" && phase !== "countdown") return;
    let cancelled = false;
    const id = window.setInterval(async () => {
      const v = videoRef.current;
      if (busyRef.current || !v || v.videoWidth === 0) return;
      busyRef.current = true;
      try {
        const g = await liveCheck(v, mode);
        if (!cancelled) setGuide((prev) => (prev.message === g.message && prev.ready === g.ready ? prev : g));
      } catch {
        /* guidance is best-effort */
      } finally {
        busyRef.current = false;
      }
    }, LIVE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [phase, mode]);

  const snap = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) {
      setPhase("live");
      return;
    }
    // Centre-crop to 3:4 portrait; the preview uses the same crop. The saved image is NOT mirrored.
    const sw = Math.min(v.videoWidth, v.videoHeight * 0.75);
    const sh = sw / 0.75;
    const scale = Math.min(1, MAX_SIDE / sh);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    canvas
      .getContext("2d")
      ?.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    setPhase("checking");
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          setErrorKind("error");
          setPhase("error");
          return;
        }
        const file = new File([blob], `${mode === "face" ? "selfie" : "body"}-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        const report = await checkPhoto(canvas, mode);
        setShot({ file, url: URL.createObjectURL(file), report });
        setPhase("review");
      },
      "image/jpeg",
      0.92
    );
  }, [mode]);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (count <= 0) {
      snap();
      return;
    }
    const id = window.setTimeout(() => setCount((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [phase, count, snap]);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const live = phase === "live" || phase === "countdown";
  const title = mode === "face" ? "Take a close-up selfie" : "Take a full-body photo";
  const failed = shot ? !shot.report.ok : false;

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
        aria-labelledby="pcap-h"
        className="card max-h-[100dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-b-none outline-none sm:rounded-b-[1.25rem]"
      >
        <div className="flex items-center justify-between">
          <h2 id="pcap-h" className="font-bold">
            {title}
          </h2>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="relative mx-auto aspect-[3/4] h-[min(58vh,34rem)] overflow-hidden rounded-2xl bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Live camera preview"
            className={`h-full w-full -scale-x-100 object-cover ${live || phase === "starting" || phase === "checking" ? "" : "hidden"}`}
          />
          {phase === "review" && shot && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot.url} alt="Captured photo" className="h-full w-full object-cover" />
          )}
          {live && (
            <svg viewBox="0 0 75 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
              {mode === "face" ? (
                // A face that fills this oval is about 64% of the frame width, above the 60% requirement.
                <ellipse
                  cx="37.5"
                  cy="45"
                  rx="24"
                  ry="31"
                  fill="none"
                  stroke={guide.ready ? "#4ade80" : "white"}
                  strokeOpacity=".9"
                  strokeWidth=".8"
                  strokeDasharray="3 2"
                />
              ) : (
                <g
                  fill="none"
                  stroke={guide.ready ? "#4ade80" : "white"}
                  strokeOpacity=".9"
                  strokeWidth=".8"
                  strokeDasharray="3 2"
                >
                  <circle cx="37.5" cy="14" r="5.5" />
                  <path d="M25 24 Q37.5 21 50 24 L53 52 L48 52 L47 94 L38.5 94 L37.5 60 L36.5 94 L28 94 L27 52 L22 52 Z" />
                  <line x1="12" y1="95" x2="63" y2="95" />
                </g>
              )}
            </svg>
          )}
          {live && (
            <div className="pq-guidance" data-ready={guide.ready} aria-hidden="true">
              {phase === "countdown" ? "Hold still" : guide.message}
            </div>
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
          {phase === "checking" && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 p-4 text-sm text-white">
              <span className="pq-spinner" aria-hidden="true" /> Checking your photo…
            </div>
          )}
          {phase === "error" && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white">
              {CAMERA_ERROR_MESSAGE[errorKind]}
            </div>
          )}
        </div>

        <p className="muted min-h-5 text-sm" role="status" aria-live="polite">
          {live && (phase === "countdown" ? "Hold still" : guide.message)}
          {phase === "checking" && "Checking your photo…"}
          {phase === "review" &&
            shot &&
            (shot.report.ok
              ? shot.report.checks.some((c) => c.status === "warn")
                ? "Usable, with a few notes."
                : "Looks good."
              : "This photo needs a retake.")}
        </p>

        {phase === "review" && shot && <QualityChecklist report={shot.report} />}

        <div className="flex gap-2">
          {live && (
            <button
              type="button"
              className={`btn-primary flex-1 ${guide.ready ? "pq-ready" : ""}`}
              disabled={phase === "countdown"}
              onClick={() => {
                setCount(COUNTDOWN_SECONDS);
                setPhase("countdown");
              }}
            >
              {phase === "countdown"
                ? `Hold still… ${Math.max(count, 0)}`
                : guide.ready
                  ? `Ready: take photo (${COUNTDOWN_SECONDS}s timer)`
                  : `Take photo (${COUNTDOWN_SECONDS}s timer)`}
            </button>
          )}
          {phase === "review" && shot && (
            <>
              <button
                type="button"
                className={failed ? "btn-primary flex-1" : "btn-ghost flex-1"}
                onClick={() => {
                  setShot(null);
                  setPhase("live");
                }}
              >
                Retake
              </button>
              {!failed && (
                <button type="button" className="btn-primary flex-1" onClick={() => onCapture(shot.file, shot.report)}>
                  {shot.report.checks.some((c) => c.status === "warn") ? "Use anyway" : "Use photo"}
                </button>
              )}
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
