/**
 * Pure music theory + bar planning for Flattr's procedural ambient score.
 * No DOM, no Web Audio, no Math.random: everything is deterministic for a seed.
 */

export type Mood = "calm" | "focus" | "processing" | "celebrate" | "caution";

export const MOODS: readonly Mood[] = ["calm", "focus", "processing", "celebrate", "caution"];

/** Root of every mood: D. MIDI 50 = D3 (pads), 74 = D5 (plucks). */
export const ROOT_PC = 2;
export const PAD_BASE_MIDI = 50;
export const PLUCK_BASE_MIDI = 74;
export const BEATS_PER_BAR = 4;

export const SCALES = {
  /** D Lydian: bright, floating. */
  lydian: [0, 2, 4, 6, 7, 9, 11],
  /** D major (Ionian). */
  major: [0, 2, 4, 5, 7, 9, 11],
  /** D Dorian: slightly minor-coloured, never dark. */
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydianPentatonic: [0, 2, 4, 7, 9],
  majorPentatonic: [0, 2, 4, 7, 9],
  dorianPentatonic: [0, 2, 5, 7, 10],
} as const;

export interface MoodParams {
  /** Beats per minute (a bar is 4 beats). */
  tempo: number;
  /** Full pitch-class set (semitones above D) that chords must stay inside. */
  scale: readonly number[];
  /** Subset of `scale` used for plucks/arpeggios. */
  pluckScale: readonly number[];
  /** Chords as semitone offsets from D3. One chord per bar, looping. */
  progression: readonly (readonly number[])[];
  /** Lowpass cutoff in Hz. */
  cutoff: number;
  /** 0..1, how many chord voices sound (3..4). */
  padDensity: number;
  /** 0..1, probability of a pluck on each eighth note. */
  pluckDensity: number;
  /** 0..1, share of bell timbre and pluck octave height. */
  brightness: number;
  /** 0..1 reverb send. */
  reverbMix: number;
  /** Steady pulsing arpeggio instead of random plucks. */
  arpeggio: boolean;
}

export const MOOD_PARAMS: Record<Mood, MoodParams> = {
  calm: {
    tempo: 54,
    scale: SCALES.lydian,
    pluckScale: SCALES.lydianPentatonic,
    progression: [
      [0, 7, 11, 14], // Dmaj7(add9)
      [-3, 4, 7, 12], // Bm7
      [2, 9, 14, 18], // E (Lydian II)
      [-5, -1, 2, 4], // A6
    ],
    cutoff: 1800,
    padDensity: 1,
    pluckDensity: 0.1,
    brightness: 0.35,
    reverbMix: 0.55,
    arpeggio: false,
  },
  focus: {
    tempo: 66,
    scale: SCALES.major,
    pluckScale: SCALES.majorPentatonic,
    progression: [
      [0, 7, 11, 14], // Dmaj7(add9)
      [5, 9, 12, 16], // Gmaj7
      [-3, 0, 4, 7], // Bm7
      [-5, 0, 2, 7], // Asus
    ],
    cutoff: 1500,
    padDensity: 0.6,
    pluckDensity: 0.18,
    brightness: 0.4,
    reverbMix: 0.4,
    arpeggio: false,
  },
  processing: {
    tempo: 84,
    scale: SCALES.major,
    pluckScale: SCALES.majorPentatonic,
    progression: [
      [0, 7, 14, 16], // Dadd9
      [-3, 0, 4, 7], // Bm7
      [5, 9, 12, 16], // Gmaj7
      [-5, -3, 2, 7], // Asus2
    ],
    cutoff: 2200,
    padDensity: 0.6,
    pluckDensity: 0.85,
    brightness: 0.5,
    reverbMix: 0.45,
    arpeggio: true,
  },
  celebrate: {
    tempo: 76,
    scale: SCALES.lydian,
    pluckScale: SCALES.lydianPentatonic,
    progression: [
      [0, 4, 9, 14], // D6/9
      [2, 6, 9, 14], // E
      [-5, -1, 2, 4], // A6
      [0, 7, 11, 16], // Dmaj7
    ],
    cutoff: 3200,
    padDensity: 1,
    pluckDensity: 0.45,
    brightness: 0.9,
    reverbMix: 0.6,
    arpeggio: false,
  },
  caution: {
    tempo: 50,
    scale: SCALES.dorian,
    pluckScale: SCALES.dorianPentatonic,
    progression: [
      [0, 2, 7, 12], // Dsus2
      [0, 3, 7, 14], // Dm9
      [5, 7, 12, 14], // Gadd9 (suspended)
      [-5, -2, 2, 5], // Am7
    ],
    cutoff: 1100,
    padDensity: 0.8,
    pluckDensity: 0.08,
    brightness: 0.2,
    reverbMix: 0.6,
    arpeggio: false,
  },
};

/** mulberry32 seeded PRNG: returns a function yielding floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Equal temperament, A4 (MIDI 69) = 440 Hz. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Pitch class (0..11) of a MIDI note. */
export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/** Whether a MIDI note belongs to a scale given as semitones above D. */
export function inScale(midi: number, scale: readonly number[]): boolean {
  const rel = (((midi - ROOT_PC) % 12) + 12) % 12;
  return scale.includes(rel);
}

/** The chord for a bar; progressions loop. */
export function chordForBar(mood: Mood, barIndex: number): readonly number[] {
  const prog = MOOD_PARAMS[mood].progression;
  const i = ((Math.floor(barIndex) % prog.length) + prog.length) % prog.length;
  return prog[i];
}

export interface PadNote {
  midi: number;
  /** Start in beats from the bar start. */
  startBeat: number;
  durBeats: number;
  /** 0..1 relative level. */
  gain: number;
}

export interface PluckNote {
  midi: number;
  startBeat: number;
  durBeats: number;
  gain: number;
  kind: "pluck" | "bell";
}

export interface BarPlan {
  mood: Mood;
  barIndex: number;
  beats: number;
  secondsPerBeat: number;
  chord: number[];
  pads: PadNote[];
  plucks: PluckNote[];
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic plan for one bar. Same (mood, barIndex, seed) gives the same output. */
export function planBar(mood: Mood, barIndex: number, seed: number): BarPlan {
  const p = MOOD_PARAMS[mood];
  const rng = mulberry32((seed ^ hashStr(mood) ^ Math.imul(Math.floor(barIndex) + 1, 0x9e3779b1)) >>> 0);
  const chord = chordForBar(mood, barIndex).map((o) => PAD_BASE_MIDI + o);

  const voices = Math.max(3, Math.min(chord.length, Math.round(2 + p.padDensity * 2)));
  const pads: PadNote[] = chord.slice(0, voices).map((midi, i) => ({
    midi,
    startBeat: i * 0.12 + rng() * 0.1,
    durBeats: BEATS_PER_BAR + 0.6,
    gain: i === 0 ? 0.9 : 0.6 + rng() * 0.15,
  }));

  const plucks: PluckNote[] = [];
  if (p.arpeggio) {
    const tones = chord.map((m) => {
      let n = m + 12;
      while (n < PLUCK_BASE_MIDI - 7) n += 12;
      while (n > PLUCK_BASE_MIDI + 7) n -= 12;
      return n;
    });
    const order = [0, 1, 2, 3, 2, 1, 2, 3];
    for (let i = 0; i < 8; i++) {
      if (rng() > p.pluckDensity) continue;
      plucks.push({
        midi: tones[order[i] % tones.length],
        startBeat: i * 0.5,
        durBeats: 1,
        gain: i % 2 === 0 ? 0.55 : 0.38,
        kind: "pluck",
      });
    }
  } else {
    const pool: number[] = [];
    const octaves = p.brightness > 0.6 ? [0, 12] : [0];
    for (const oct of octaves) for (const deg of p.pluckScale) pool.push(PLUCK_BASE_MIDI + oct + deg);
    for (let i = 0; i < 8; i++) {
      if (rng() > p.pluckDensity) continue;
      plucks.push({
        midi: pool[Math.floor(rng() * pool.length)],
        startBeat: i * 0.5,
        durBeats: 2,
        gain: 0.3 + rng() * 0.25,
        kind: rng() < p.brightness ? "bell" : "pluck",
      });
    }
  }
  return {
    mood,
    barIndex,
    beats: BEATS_PER_BAR,
    secondsPerBeat: 60 / p.tempo,
    chord,
    pads,
    plucks,
  };
}
