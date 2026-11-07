"use client";
import { useEffect, useState } from "react";

import { useMusic } from "@/components/MusicProvider";

export default function MusicToggle() {
  const { playing, waiting, volume, toggle, setVolume } = useMusic();
  const [hint, setHint] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setHint(false), 7000);
    return () => clearTimeout(id);
  }, []);

  const label = playing ? "Turn background music off" : "Turn background music on";
  const showHint = hint && waiting && !playing;

  return (
    <div className="mu-root" data-mu-toggle>
      {showHint && (
        <p className="mu-hint" role="status">
          Tap anywhere to start music
        </p>
      )}
      <div className="mu-panel">
        <label className="mu-sr" htmlFor="mu-volume">
          Music volume
        </label>
        <input
          id="mu-volume"
          className="mu-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
        />
      </div>
      <button type="button" className="mu-btn" aria-pressed={playing} aria-label={label} onClick={toggle}>
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18V5l11-2v13" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="17.5" cy="16" r="2.5" />
          {!playing && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </div>
  );
}
