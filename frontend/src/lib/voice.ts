/**
 * F09.20: the browser half of the spoken key phrase. Records from the microphone, turns the recording into speech
 * features on this computer (voice-features.ts) and sends only those numbers. The recording never leaves the page.
 */
import { api, post, type SignInResult } from "./api";
import { phraseFeatures, type PhraseFeatures } from "./voice-features";

export interface VoiceStatus {
  enrolled: boolean;
  set_up_at: number | null;
  min_snr_db: number;
  samples: number;
}

export const voiceStatus = () => api<VoiceStatus>("/auth/voice");

export function enrollVoice(takes: PhraseFeatures[]) {
  return post("/auth/voice", { samples: takes.map((t) => t.frames), snr_db: Math.min(...takes.map((t) => t.snrDb)) });
}

export function voiceStep(handle: string, take: PhraseFeatures): Promise<SignInResult> {
  return post<SignInResult>("/auth/voice-step", { handle, frames: take.frames, snr_db: take.snrDb });
}

export interface Microphone {
  /** What the microphone reports about itself. */
  settings: { sampleRate?: number; label: string };
  /** Current loudness, 0 to 1, read from the live signal (for the level meter). */
  level: () => number;
  /** Record until stop() and return the features. */
  record: () => { stop: () => Promise<PhraseFeatures> };
  close: () => void;
}

export async function openMicrophone(): Promise<Microphone> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
    throw new Error("This window cannot use a microphone.");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  const track = stream.getAudioTracks()[0];
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  return {
    settings: { sampleRate: track.getSettings().sampleRate ?? ctx.sampleRate, label: track.label || "Microphone" },
    level: () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      return Math.min(1, Math.sqrt(sum / buf.length) * 4);
    },
    record: () => {
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.start();
      return {
        stop: () =>
          new Promise<PhraseFeatures>((resolve, reject) => {
            rec.onstop = async () => {
              try {
                const audio = await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
                resolve(phraseFeatures(audio.getChannelData(0), audio.sampleRate));
              } catch {
                reject(new Error("The recording could not be read. Try again."));
              }
            };
            rec.stop();
          }),
      };
    },
    close: () => {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
