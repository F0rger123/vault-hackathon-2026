// F09.20 calibration: turns 16-bit mono WAV files into the same key-phrase features the browser sends.
// Usage: node scripts/voice_features.mts <folder-of-wavs> > features.json   (then scripts/calibrate_voice.py)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { phraseFeatures } from "../frontend/src/lib/voice-features.ts";

const dir = process.argv[2];
let seed = 7;
const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 0.004; // quiet room hiss
const out: Record<string, unknown> = {};
for (const name of readdirSync(dir).filter((f) => f.endsWith(".wav")).sort()) {
  const buf = readFileSync(join(dir, name));
  const rate = buf.readUInt32LE(24);
  const dataAt = buf.indexOf("data") + 8;
  const n = (buf.length - dataAt) >> 1;
  // Half a second of room noise before and after, as a real recording has.
  const pad = rate / 2;
  const x = new Float32Array(n + 2 * pad);
  for (let i = 0; i < x.length; i++) x[i] = noise();
  for (let i = 0; i < n; i++) x[pad + i] += buf.readInt16LE(dataAt + 2 * i) / 32768;
  const f = phraseFeatures(x, rate);
  out[name.replace(".wav", "")] = { frames: f.frames, snr_db: f.snrDb, seconds: f.seconds };
}
console.log(JSON.stringify(out));
