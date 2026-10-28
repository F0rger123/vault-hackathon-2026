import { type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Role = "admin" | "analyst" | "viewer";

// Demo tokens written by scripts/demo_reset.py into the git-ignored e2e data directory. Never logged.
export function token(role: Role): string {
  const file = join(__dirname, "..", "..", "..", "data", "e2e", "dev_tokens.json");
  return JSON.parse(readFileSync(file, "utf-8"))[role];
}

/** Open a page already signed in as `role`, the way the UI stores a pasted token. */
export async function signedIn(page: Page, role: Role, path = "/") {
  await page.addInitScript((t) => sessionStorage.setItem("vault.token", t), token(role));
  await page.goto(path);
}

export const COLLECTION = "Halvern Engineering Archive";

export const API = `http://127.0.0.1:${process.env.VAULT_E2E_API_PORT ?? "8100"}/api/v1`;
