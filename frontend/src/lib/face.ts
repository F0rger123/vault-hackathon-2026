/**
 * F09.19: the browser half of the face check. The open-source Human library (MIT) runs here, on this computer:
 * it finds the face, scores whether it is a live person and a real face rather than a photo, and turns it into a
 * fingerprint of 1,024 numbers. Only those numbers go to VAULT's server; the camera picture never leaves the page.
 * Models load from VAULT itself (public/models/human), so this works offline.
 */
import type { Human, Config, FaceResult } from "@vladmandic/human";
import { post, type SignInResult } from "./api";

const CONFIG: Partial<Config> = {
  backend: "webgl",
  modelBasePath: "/models/human/",
  debug: false,
  async: true,
  cacheSensitivity: 0,
  // Warm-up fetches a built-in image as a data: URL, which VAULT's security policy blocks; it only saves a second.
  warmup: "none",
  filter: { enabled: true, equalization: true },
  face: {
    enabled: true,
    detector: { rotation: false, maxDetected: 1, minConfidence: 0.5, return: false },
    mesh: { enabled: true },
    iris: { enabled: false },
    attention: { enabled: false },
    description: { enabled: true },
    emotion: { enabled: false },
    antispoof: { enabled: true },
    liveness: { enabled: true },
  } as Config["face"],
  body: { enabled: false } as Config["body"],
  hand: { enabled: false } as Config["hand"],
  object: { enabled: false } as Config["object"],
  gesture: { enabled: false },
  segmentation: { enabled: false } as Config["segmentation"],
};

let loading: Promise<Human> | null = null;

/** Loads the library and its models once (about 12 MB, from VAULT itself). */
export function loadFace(): Promise<Human> {
  // next.config.ts points this import at the library's browser build (its package map only names Node's).
  loading ??= import("@vladmandic/human").then(async ({ Human }) => {
    const human = new Human(CONFIG);
    await human.load();
    return human;
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export interface FaceReading {
  face: FaceResult | null;
  /** 0 to 1: a live, moving person rather than a still image. */
  live: number;
  /** 0 to 1: a real face rather than a photo or a screen. */
  real: number;
  /** The face's share of the picture width, 0 to 1. */
  size: number;
  embedding: number[] | null;
}

export function read(face: FaceResult | undefined, width: number): FaceReading {
  if (!face) return { face: null, live: 0, real: 0, size: 0, embedding: null };
  const emb = face.embedding && face.embedding.length === 1024 ? Array.from(face.embedding) : null;
  return { face, live: face.live ?? 0, real: face.real ?? 0, size: face.box[2] / width, embedding: emb };
}

/** F09.20: what the camera delivers. A poor camera is refused before any face is read. */
export interface CameraQuality {
  width: number;
  height: number;
  fps: number;
  /** Average brightness of the face, 0 to 255. */
  brightness: number;
  /** How sharp the face is (variance of edges); low means blurred or out of focus. */
  sharpness: number;
  /** Face width in pixels. */
  face_px: number;
}

export const QUALITY = { width: 640, height: 360, fps: 12, brightness: [45, 215] as const, sharpness: 12, face_px: 140 };

/** Plain-words problems with the camera picture, empty when it is good enough. */
export function qualityProblems(q: CameraQuality): string[] {
  const out: string[] = [];
  if (q.width < QUALITY.width || q.height < QUALITY.height)
    out.push(`The camera sends ${q.width}×${q.height}; VAULT needs ${QUALITY.width}×${QUALITY.height} or better.`);
  if (q.fps && q.fps < QUALITY.fps) out.push(`The camera runs at ${q.fps.toFixed(0)} frames a second; VAULT needs ${QUALITY.fps}.`);
  if (q.face_px) {
    if (q.brightness < QUALITY.brightness[0]) out.push("Too dark. Face a window or turn on a lamp.");
    else if (q.brightness > QUALITY.brightness[1]) out.push("Too bright. Move away from the light behind the camera.");
    if (q.sharpness < QUALITY.sharpness) out.push("The picture is blurred. Wipe the lens and hold still.");
  }
  return out;
}

/** Brightness and sharpness of the face region, measured on the frame just drawn. */
export function measureFace(ctx: CanvasRenderingContext2D, box: [number, number, number, number]): { brightness: number; sharpness: number } {
  const [x, y, w, h] = box.map((v) => Math.max(0, Math.round(v))) as [number, number, number, number];
  if (w < 8 || h < 8) return { brightness: 0, sharpness: 0 };
  const img = ctx.getImageData(x, y, w, h).data;
  const step = Math.max(1, Math.floor(w / 96));
  const cols = Math.floor(w / step);
  const rows = Math.floor(h / step);
  const g = new Float32Array(cols * rows);
  let sum = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = ((r * step) * w + c * step) * 4;
      const v = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2];
      g[r * cols + c] = v;
      sum += v;
    }
  let lsum = 0;
  let lsq = 0;
  let n = 0;
  for (let r = 1; r < rows - 1; r++)
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c;
      const lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - cols] - g[i + cols];
      lsum += lap;
      lsq += lap * lap;
      n++;
    }
  const mean = n ? lsum / n : 0;
  return { brightness: sum / (cols * rows), sharpness: n ? lsq / n - mean * mean : 0 };
}

export interface FaceSamples {
  samples: number[][];
  live: number;
  real: number;
  quality: CameraQuality;
}

export function enrollFace(s: FaceSamples) {
  return post("/auth/face", { samples: s.samples, live: s.live, real: s.real, quality: s.quality });
}

/** A later sign-in step: send the best reading; VAULT compares it, then asks for the next step or gives a session. */
export function faceStep(handle: string, s: FaceSamples): Promise<SignInResult> {
  return post<SignInResult>("/auth/face-step", { handle, embedding: s.samples[0], live: s.live, real: s.real, quality: s.quality });
}
