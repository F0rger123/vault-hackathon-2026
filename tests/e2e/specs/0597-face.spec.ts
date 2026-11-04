import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { API, signedIn, token } from "./helpers";

// F09.22: the face check with Chromium's fake camera (a moving test pattern, no face). It proves the camera starts at
// once, the detection loop runs and says what is missing, and the server asks for a random challenge. Following the
// moves needs a real face in front of a real webcam, so that part is checked by hand (see TASKS.md F09.22).
test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["camera"],
});

const shots = process.env.VAULT_SHOTS ? join(__dirname, "..", "..", "..", "docs", "screenshots", "F09.22") : null;

test("face setup starts the camera and waits for a face, with a cancel", async ({ page }) => {
  await signedIn(page, "analyst", "/security");
  await page.getByRole("button", { name: /Face check/ }).first().click();
  await page.getByRole("button", { name: /Set up face check|Set it up again/ }).click();
  // The picture is the live video, shown while the models load, not after.
  await expect(page.locator(".scan-stage video")).toHaveClass(/opacity-100/, { timeout: 20_000 });
  await expect(page.locator(".scan-stage")).toHaveAttribute("data-phase", "lock", { timeout: 45_000 });
  await expect(page.getByLabel("Camera quality")).toBeVisible();
  await expect(page.locator(".scan-stage")).toContainText(/Reading 0 of 5/);
  await expect(page.locator(".scan-stage")).toContainText(/Look at the camera|Come a little closer|photo/);
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.locator(".scan-stage").screenshot({ path: join(shots, "1-setup-waiting-for-a-face.png") });
  }
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".scan-stage")).toHaveCount(0);
});

test("the server issues two random moves for a face challenge", async ({ request }) => {
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const r = await request.post(`${API}/auth/face/challenge`, {
      headers: { Authorization: `Bearer ${token("analyst")}` },
      data: { purpose: "test" },
    });
    expect(r.status()).toBe(200);
    const c = await r.json();
    expect(c.moves).toHaveLength(2);
    seen.add(c.moves.join(","));
  }
  expect(seen.size).toBeGreaterThan(1);
});

test.describe("vault door", () => {
  // Only so this test can add its script; every other test here runs under VAULT's normal security policy.
  test.use({ bypassCSP: true });

  test("the vault door opens on the app (the real styles, played in the page)", async ({ page }) => {
    await signedIn(page, "viewer", "/");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    // The same module the sign-in calls, minus its TypeScript types.
    const src = readFileSync(join(__dirname, "..", "..", "..", "frontend", "src", "lib", "vault-door.ts"), "utf-8")
      .replace(/export function/, "window.playVaultDoor = function")
      .replace(/\(onOpen: \(\) => void \| Promise<void>\): void/, "(onOpen)");
    await page.addScriptTag({ content: src });
    await page.evaluate(() => (window as unknown as { playVaultDoor: (f: () => void) => void }).playVaultDoor(() => {}));
    await expect(page.locator(".vault-door")).toBeVisible();
    await page.waitForTimeout(1100);
    if (shots) await page.screenshot({ path: join(shots, "4-vault-door-unlocking.png") });
    await page.waitForTimeout(350);
    if (shots) await page.screenshot({ path: join(shots, "5-vault-door-opening.png") });
    await expect(page.locator(".vault-door")).toHaveCount(0, { timeout: 5000 });
  });
});

test("demo roles: select, read, then continue", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Demo: admin" }).click();
  await expect(page.getByRole("button", { name: "Continue as admin" })).toBeVisible();
  if (shots) await page.locator(".trim").last().screenshot({ path: join(shots, "0-demo-role-selected.png") });
});
