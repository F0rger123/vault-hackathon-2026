/**
 * F09.20: turns a recording of the key phrase into the numbers VAULT compares, on this computer. Standard speech
 * features (MFCC): every 20 ms, 13 values describing the shape of the sound. Also measures the recording's quality
 * so a muted, clipped or noisy microphone is refused before anything is sent. Pure functions, no browser APIs, so
 * the same code runs in tests and in the calibration script.
 */

export const RATE = 16000;
const FRAME = 512; // 32 ms
const HOP = 320; // 20 ms
const MELS = 26;
const DIMS = 13;

export interface PhraseFeatures {
  /** One row of 13 values per 20 ms of speech, silence trimmed from both ends. */
  frames: number[][];
  /** How far the speech stands above the room noise, in decibels. */
  snrDb: number;
  /** Seconds of speech kept. */
  seconds: number;
  /** Loudest sample, 0 to 1. */
  peak: number;
  /** Share of samples at full scale (clipping). */
  clipped: number;
}

/** Linear resampling to 16 kHz, enough for speech features. */
export function resample(input: Float32Array, rate: number): Float32Array {
  if (rate === RATE) return input;
  const n = Math.floor((input.length * RATE) / rate);
  const out = new Float32Array(n);
  const step = rate / RATE;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = (input[j] ?? 0) * (1 - f) + (input[j + 1] ?? input[j] ?? 0) * f;
  }
  return out;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const ai = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
      }
    }
  }
}

const mel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const hz = (m: number) => 700 * (10 ** (m / 2595) - 1);

let filters: number[][] | null = null;
function melFilters(): number[][] {
  if (filters) return filters;
  const lo = mel(80);
  const hi = mel(7600);
  const points = Array.from({ length: MELS + 2 }, (_, i) => Math.floor(((FRAME + 1) * hz(lo + ((hi - lo) * i) / (MELS + 1))) / RATE));
  filters = Array.from({ length: MELS }, (_, m) => {
    const row = new Array(FRAME / 2 + 1).fill(0);
    const [a, b, c] = [points[m], points[m + 1], points[m + 2]];
    for (let k = a; k < b; k++) row[k] = (k - a) / Math.max(1, b - a);
    for (let k = b; k <= c; k++) row[k] = (c - k) / Math.max(1, c - b);
    return row;
  });
  return filters;
}

/** Features and quality numbers for one recording (any sample rate, mono). */
export function phraseFeatures(input: Float32Array, rate: number): PhraseFeatures {
  let peak = 0;
  let clip = 0;
  for (const s of input) {
    const a = Math.abs(s);
    if (a > peak) peak = a;
    if (a >= 0.99) clip++;
  }
  const x = resample(input, rate);
  const win = Array.from({ length: FRAME }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
  const fb = melFilters();
  const all: number[][] = [];
  const energy: number[] = [];
  for (let start = 0; start + FRAME <= x.length; start += HOP) {
    const re = new Float64Array(FRAME);
    const im = new Float64Array(FRAME);
    let e = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = x[start + i] - 0.97 * (start + i > 0 ? x[start + i - 1] : 0);
      re[i] = s * win[i];
      e += x[start + i] * x[start + i];
    }
    energy.push(e / FRAME + 1e-12);
    fft(re, im);
    const power = Array.from({ length: FRAME / 2 + 1 }, (_, k) => (re[k] * re[k] + im[k] * im[k]) / FRAME);
    const logMel = fb.map((row) => Math.log(row.reduce((sum, w, k) => sum + w * power[k], 0) + 1e-10));
    // DCT-II, keeping coefficients 1 to 13 (coefficient 0 is loudness, which says nothing about the phrase).
    all.push(
      Array.from({ length: DIMS }, (_, n) =>
        logMel.reduce((sum, v, m) => sum + v * Math.cos((Math.PI * (n + 1) * (m + 0.5)) / MELS), 0),
      ),
    );
  }
  if (!all.length) return { frames: [], snrDb: 0, seconds: 0, peak, clipped: clip / Math.max(1, input.length) };
  // Room noise is the quietest tenth of the recording; speech is what stands well above it.
  const sorted = [...energy].sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.1)];
  const speechAt = energy.map((e) => e > noise * 10);
  const first = speechAt.indexOf(true);
  const last = speechAt.lastIndexOf(true);
  if (first < 0) return { frames: [], snrDb: 0, seconds: 0, peak, clipped: clip / input.length };
  const a = Math.max(0, first - 2);
  const b = Math.min(all.length, last + 3);
  const speech = energy.slice(a, b).filter((_, i) => speechAt[a + i]);
  const snrDb = 10 * Math.log10(speech.reduce((s, e) => s + e, 0) / speech.length / noise);
  return {
    frames: all.slice(a, b).map((f) => f.map((v) => Math.round(v * 1000) / 1000)),
    snrDb: Math.round(snrDb * 10) / 10,
    seconds: ((b - a) * HOP) / RATE,
    peak,
    clipped: clip / input.length,
  };
}

/** Plain-words reasons a recording should not be used, empty when it is fine. */
export function phraseProblems(f: PhraseFeatures, minSnrDb: number): string[] {
  const out: string[] = [];
  if (f.peak < 0.02) out.push("VAULT heard almost nothing. Check the microphone is on and not muted.");
  else if (f.clipped > 0.01) out.push("The recording was too loud and distorted. Move back from the microphone.");
  if (f.seconds < 0.8) out.push("Say the whole phrase; VAULT heard less than a second of speech.");
  if (f.seconds > 6) out.push("Keep the phrase under six seconds.");
  if (f.peak >= 0.02 && f.snrDb < minSnrDb)
    out.push(`Too much background noise (${f.snrDb.toFixed(0)} dB above it; VAULT needs ${minSnrDb}). Move somewhere quieter.`);
  return out;
}
