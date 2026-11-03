// F09.19: copy the face models VAULT uses from the Human package into public/, so the browser loads them from
// VAULT itself (never a CDN) and the installed app works offline. Runs before dev and build.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "@vladmandic", "human", "models");
const to = join(root, "public", "models", "human");
const MODELS = ["blazeface", "facemesh", "faceres", "antispoof", "liveness"];

mkdirSync(to, { recursive: true });
for (const m of MODELS) {
  for (const ext of [".json", ".bin"]) {
    const src = join(from, m + ext);
    if (!existsSync(src)) throw new Error(`face model missing: ${src}. Run npm install.`);
    copyFileSync(src, join(to, m + ext));
  }
}
console.log(`face models ready in public/models/human (${MODELS.length})`);
