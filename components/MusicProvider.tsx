"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { AUDIO_TUNING, AmbientMusic } from "@/lib/ambient-music";
import type { Mood } from "@/lib/music-theory";

const STORAGE_KEY = "flattr:music";

export interface MusicState {
  /** User preference (default on). */
  enabled: boolean;
  /** Audio is actually sounding. */
  playing: boolean;
  /** Preference is on but waiting for the first user gesture. */
  waiting: boolean;
  volume: number;
  toggle: () => void;
  setVolume: (v: number) => void;
}

interface Internal extends MusicState {
  setMood: (m: Mood) => void;
  duckDelta: (d: 1 | -1) => void;
}

const NOOP: Internal = {
  enabled: false,
  playing: false,
  waiting: false,
  volume: AUDIO_TUNING.defaultVolume,
  toggle: () => undefined,
  setVolume: () => undefined,
  setMood: () => undefined,
  duckDelta: () => undefined,
};

const Ctx = createContext<Internal>(NOOP);

function readPref(): { on: boolean; volume: number } {
  const out: { on: boolean; volume: number } = { on: true, volume: AUDIO_TUNING.defaultVolume };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as { on?: unknown; volume?: unknown };
      if (typeof j.on === "boolean") out.on = j.on;
      if (typeof j.volume === "number" && j.volume >= 0 && j.volume <= 1) out.volume = j.volume;
    }
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return out;
}

function writePref(on: boolean, volume: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ on, volume }));
  } catch {
    /* ignore */
  }
}

export default function MusicProvider({ children }: { children: React.ReactNode }) {
  const engine = useRef<AmbientMusic | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState<number>(AUDIO_TUNING.defaultVolume);
  const enabledRef = useRef(true);
  const volumeRef = useRef<number>(AUDIO_TUNING.defaultVolume);
  const duckCount = useRef(0);

  const get = useCallback((): AmbientMusic => {
    if (!engine.current) engine.current = new AmbientMusic();
    return engine.current;
  }, []);

  const begin = useCallback((): boolean => {
    const m = get();
    m.setVolume(volumeRef.current);
    m.duck(duckCount.current > 0);
    const ok = m.start();
    setPlaying(ok);
    return ok;
  }, [get]);

  useEffect(() => {
    const pref = readPref();
    let silent = false;
    try {
      silent = new URLSearchParams(window.location.search).get("music") === "off";
    } catch {
      /* ignore */
    }
    const on = pref.on && !silent;
    enabledRef.current = on;
    volumeRef.current = pref.volume;
    setEnabled(on);
    setVolumeState(pref.volume);

    let armed = on;
    const onGesture = (e: Event) => {
      if (!armed) return;
      const t = e.target;
      if (t instanceof Element && t.closest("[data-mu-toggle]")) return;
      disarm();
      if (enabledRef.current) begin();
    };
    const disarm = () => {
      armed = false;
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    if (on) {
      window.addEventListener("pointerdown", onGesture);
      window.addEventListener("keydown", onGesture);
    }
    return () => {
      disarm();
      engine.current?.dispose();
      engine.current = null;
    };
  }, [begin]);

  const toggle = useCallback(() => {
    if (engine.current?.isPlaying) {
      enabledRef.current = false;
      setEnabled(false);
      setPlaying(false);
      engine.current.stop();
      writePref(false, volumeRef.current);
    } else {
      enabledRef.current = true;
      setEnabled(true);
      writePref(true, volumeRef.current);
      begin();
    }
  }, [begin]);

  const setVolume = useCallback((v: number) => {
    const n = Math.min(1, Math.max(0, v));
    volumeRef.current = n;
    setVolumeState(n);
    engine.current?.setVolume(n);
    writePref(enabledRef.current, n);
  }, []);

  const setMood = useCallback((m: Mood) => get().setMood(m), [get]);

  const duckDelta = useCallback((d: 1 | -1) => {
    duckCount.current = Math.max(0, duckCount.current + d);
    engine.current?.duck(duckCount.current > 0);
  }, []);

  const value = useMemo<Internal>(
    () => ({
      enabled,
      playing,
      waiting: enabled && !playing,
      volume,
      toggle,
      setVolume,
      setMood,
      duckDelta,
    }),
    [enabled, playing, volume, toggle, setVolume, setMood, duckDelta]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMusic(): MusicState {
  return useContext(Ctx);
}

/** Set the score's mood (crossfades). No-op outside a provider. */
export function useMusicMood(mood: Mood): void {
  const { setMood } = useContext(Ctx);
  useEffect(() => {
    setMood(mood);
  }, [mood, setMood]);
}

/** Lower the music while `active` (e.g. camera open). No-op outside a provider. */
export function useMusicDuck(active: boolean): void {
  const { duckDelta } = useContext(Ctx);
  useEffect(() => {
    if (!active) return;
    duckDelta(1);
    return () => duckDelta(-1);
  }, [active, duckDelta]);
}
