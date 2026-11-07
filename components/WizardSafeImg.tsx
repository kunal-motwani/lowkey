/* eslint-disable @next/next/no-img-element */
"use client";
import { useEffect, useState } from "react";

/** Object URL tied to a File lifetime: created in an effect, revoked on change/unmount. */
export function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url;
}

/** Image that degrades to a neutral "Preview unavailable" placeholder instead of a broken icon. */
export default function WizardSafeImg({
  src,
  alt,
  className = "",
  placeholder = "Preview unavailable",
}: {
  src?: string | null;
  alt: string;
  className?: string;
  placeholder?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <div
        role="img"
        aria-label={`${alt}: ${placeholder.toLowerCase()}`}
        className={`skeleton muted flex items-center justify-center p-2 text-center text-xs ${className}`}
      >
        {placeholder}
      </div>
    );
  }
  return <img src={src} alt={alt} onError={() => setFailedSrc(src)} className={`object-cover ${className}`} />;
}
