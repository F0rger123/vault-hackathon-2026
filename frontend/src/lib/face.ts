/**
 * F09.19: the browser half of the face check. The open-source Human library (MIT) runs here, on this computer:
 * it finds the face, scores whether it is a live person and a real face rather than a photo, and turns it into a
 * fingerprint of 1,024 numbers. Only those numbers go to VAULT's server; the camera picture never leaves the page.
 * Models load from VAULT itself (public/models/human), so this works offline.
 */
import type { Human, Config, FaceResult } from "@vladmandic/human";
import { post, type SignedIn } from "./api";

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

export interface FaceSamples {
  samples: number[][];
  live: number;
  real: number;
}

export function enrollFace(s: FaceSamples) {
  return post("/auth/face", s);
}

/** The second sign-in step: send the best reading; VAULT compares it and only then issues a session. */
export function faceStep(handle: string, s: FaceSamples): Promise<SignedIn> {
  return post<SignedIn>("/auth/face-step", { handle, embedding: s.samples[0], live: s.live, real: s.real });
}
