import { describe, expect, it } from "vitest";

import {
  BEATS_PER_BAR,
  MOODS,
  MOOD_PARAMS,
  chordForBar,
  inScale,
  midiToFreq,
  mulberry32,
  planBar,
} from "@/lib/music-theory";

describe("music-theory", () => {
  it("mulberry32 is deterministic and in [0,1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("converts MIDI to frequency with A4 = 440", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(81)).toBeCloseTo(880, 6);
    expect(midiToFreq(57)).toBeCloseTo(220, 6);
  });

  it("defines every mood with sane parameters", () => {
    expect(MOODS.length).toBe(5);
    for (const m of MOODS) {
      const p = MOOD_PARAMS[m];
      expect(p.tempo).toBeGreaterThanOrEqual(40);
      expect(p.tempo).toBeLessThanOrEqual(100);
      expect(p.cutoff).toBeGreaterThan(500);
      expect(p.cutoff).toBeLessThan(8000);
      for (const v of [p.padDensity, p.pluckDensity, p.brightness, p.reverbMix]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(p.progression.length).toBeGreaterThanOrEqual(2);
      for (const d of p.pluckScale) expect(p.scale).toContain(d);
    }
    expect(MOOD_PARAMS.caution.tempo).toBeLessThan(MOOD_PARAMS.celebrate.tempo);
    expect(MOOD_PARAMS.celebrate.brightness).toBeGreaterThan(MOOD_PARAMS.caution.brightness);
  });

  it("keeps chords and plucks inside the mood scale", () => {
    for (const m of MOODS) {
      const p = MOOD_PARAMS[m];
      for (let bar = 0; bar < 16; bar++) {
        const plan = planBar(m, bar, 7);
        for (const n of plan.chord) expect(inScale(n, p.scale)).toBe(true);
        for (const n of plan.pads) expect(inScale(n.midi, p.scale)).toBe(true);
        for (const n of plan.plucks) {
          expect(inScale(n.midi, p.arpeggio ? p.scale : p.pluckScale)).toBe(true);
        }
      }
    }
  });

  it("is deterministic per seed and varies across seeds", () => {
    for (const m of MOODS) {
      expect(planBar(m, 3, 99)).toEqual(planBar(m, 3, 99));
    }
    const diff = Array.from({ length: 8 }, (_, i) => JSON.stringify(planBar("focus", i, 1)));
    const other = Array.from({ length: 8 }, (_, i) => JSON.stringify(planBar("focus", i, 2)));
    expect(diff).not.toEqual(other);
  });

  it("loops progressions", () => {
    for (const m of MOODS) {
      const n = MOOD_PARAMS[m].progression.length;
      expect(chordForBar(m, 0)).toEqual(chordForBar(m, n));
      expect(chordForBar(m, 1)).toEqual(chordForBar(m, 1 + 3 * n));
    }
  });

  it("returns a well-formed plan", () => {
    for (const m of MOODS) {
      const plan = planBar(m, 0, 5);
      expect(plan.mood).toBe(m);
      expect(plan.beats).toBe(BEATS_PER_BAR);
      expect(plan.secondsPerBeat).toBeCloseTo(60 / MOOD_PARAMS[m].tempo, 9);
      expect(plan.pads.length).toBeGreaterThanOrEqual(3);
      for (const n of [...plan.pads, ...plan.plucks]) {
        expect(n.startBeat).toBeGreaterThanOrEqual(0);
        expect(n.startBeat).toBeLessThan(BEATS_PER_BAR);
        expect(n.durBeats).toBeGreaterThan(0);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("AmbientMusic on the server", () => {
  it("imports and constructs without touching window", async () => {
    expect(typeof window).toBe("undefined");
    const mod = await import("@/lib/ambient-music");
    const m = new mod.AmbientMusic();
    expect(m.start()).toBe(false);
    m.setMood("celebrate");
    m.setVolume(0.5);
    m.duck(true);
    m.stop();
    m.dispose();
    expect(m.isPlaying).toBe(false);
  });
});
