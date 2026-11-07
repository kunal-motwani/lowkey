"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import PhotoCapture, { QualityChecklist } from "@/components/PhotoCapture";
import { checkPhoto } from "@/lib/photo-quality";
import type { PhotoMode, QualityReport } from "@/lib/types";

interface Props {
  mode: PhotoMode;
  label: string;
  hint: string;
  value: File | null;
  /** Called with the accepted file, or (null, report) when a photo failed its checks. */
  onChange: (file: File | null, report: QualityReport | null) => void;
  optional?: boolean;
  /** Called with true when the camera modal opens and false when it closes (also on unmount while open). */
  onCameraOpenChange?: (open: boolean) => void;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  });
}

export default function PhotoPicker({ mode, label, hint, value, onChange, optional, onCameraOpenChange }: Props) {
  const uid = useRef(`pp-${Math.random().toString(36).slice(2, 8)}`).current;
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<QualityReport | null>(null);
  const [rejected, setRejected] = useState<{ url: string } | null>(null);
  const [decodeError, setDecodeError] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  // Report camera open/close; the cleanup also fires when the picker unmounts while the camera is open.
  const cameraCbRef = useRef(onCameraOpenChange);
  useEffect(() => {
    cameraCbRef.current = onCameraOpenChange;
  });
  useEffect(() => {
    if (!camera) return;
    cameraCbRef.current?.(true);
    return () => cameraCbRef.current?.(false);
  }, [camera]);

  // Object URL for the accepted file, revoked when it changes or on unmount.
  useEffect(() => {
    if (!value) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(value);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [value]);

  // Parent cleared the value (e.g. form reset): drop a stale accepted report.
  useEffect(() => {
    if (!value) setReport((r) => (r?.ok ? null : r));
  }, [value]);

  // Object URL for a rejected photo so the user can see what to fix.
  useEffect(() => {
    return () => {
      if (rejected) URL.revokeObjectURL(rejected.url);
    };
  }, [rejected]);

  const accept = useCallback(
    (file: File, rep: QualityReport) => {
      setRejected(null);
      setDecodeError(false);
      setReport(rep);
      onChange(rep.ok ? file : null, rep);
      if (!rep.ok) setRejected({ url: URL.createObjectURL(file) });
    },
    [onChange]
  );

  const handleFile = useCallback(
    async (file: File) => {
      setChecking(true);
      setDecodeError(false);
      const tmp = URL.createObjectURL(file);
      try {
        const img = await loadImage(tmp);
        accept(file, await checkPhoto(img, mode));
      } catch {
        setReport(null);
        setRejected(null);
        setDecodeError(true);
        onChange(null, null);
      } finally {
        URL.revokeObjectURL(tmp);
        setChecking(false);
      }
    },
    [accept, mode, onChange]
  );

  const failed = report && !report.ok;
  const preview = failed ? rejected?.url : url;
  const canRetake = failed || decodeError;

  return (
    <section className="card space-y-3" aria-labelledby={`${uid}-l`}>
      <div>
        <h3 id={`${uid}-l`} className="font-bold">
          {label}
          {optional && <span className="muted text-sm font-normal"> (optional)</span>}
        </h3>
        <p className="muted text-sm">{hint}</p>
      </div>

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt={failed ? `${label}: photo needs a retake` : `${label}: selected photo`}
          className="thumb mx-auto aspect-[3/4] max-h-72 w-auto"
        />
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={() => setCamera(true)} disabled={checking}>
          {canRetake ? "Retake" : value ? "Retake with camera" : "Open camera"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={checking}>
          {canRetake ? "Choose another photo" : value ? "Replace photo" : "Upload photo"}
        </button>
        {optional && (value || failed) && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setReport(null);
              setRejected(null);
              setDecodeError(false);
              onChange(null, null);
            }}
          >
            Remove
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          aria-label={`Upload ${label}`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void handleFile(f);
          }}
        />
      </div>

      <div role="status" aria-live="polite" className="space-y-2">
        {checking && (
          <p className="flex items-center gap-2 text-sm">
            <span className="pq-spinner" aria-hidden="true" /> Checking your photo…
          </p>
        )}
        {decodeError && (
          <p className="text-sm" style={{ color: "var(--bad)" }}>
            We couldn&apos;t read that file. Choose a JPEG, PNG or WebP photo.
          </p>
        )}
        {!checking && report && (
          <>
            <p className="text-sm font-semibold" style={{ color: report.ok ? "var(--good)" : "var(--bad)" }}>
              {report.ok
                ? report.checks.some((c) => c.status === "warn")
                  ? "Photo accepted, with a few notes."
                  : "Photo looks good."
                : "This photo can't be used yet. Fix the items below, then retake or choose another."}
            </p>
            <QualityChecklist report={report} />
          </>
        )}
      </div>

      {camera && (
        <PhotoCapture
          mode={mode}
          onClose={() => setCamera(false)}
          onCapture={(file, rep) => {
            setCamera(false);
            accept(file, rep);
          }}
        />
      )}
    </section>
  );
}
