import { expect, test } from "@playwright/test";
import { signedIn } from "./helpers";

// F10.20: the Ask VAULT page shows the coordinator's plan, each helper's real work, and a cited answer.
test("a question shows the helpers at work and an answer with sources", async ({ page }) => {
  await signedIn(page, "viewer", "/chat");
  await expect(page.getByRole("heading", { name: "Ask VAULT" })).toBeVisible();

  const input = page.getByLabel("Message");
  await input.fill("Which parts have conflicting pressure ratings?");
  await input.press("Enter");

  const reply = page.getByRole("article", { name: "VAULT's reply" }).last();
  await expect(reply.getByText("Coordinator", { exact: true })).toBeVisible();
  // Each card turns finished only when the server's "finished" event for that helper has arrived.
  for (const helper of ["finder", "conflicts", "answer", "facts"]) {
    await expect(reply.locator(`[data-helper="${helper}"]`)).toHaveAttribute("data-status", "finished", { timeout: 30_000 });
  }
  await expect(reply).toContainText("run at the same time");
  await expect(reply).toContainText(/\d+ ms/);

  // A card opens to show what the helper did.
  await reply.locator('[data-helper="conflicts"] button').click();
  await expect(reply.locator('[data-helper="conflicts"]')).toContainText("because the question asks about conflicts");

  // The answer cites numbered sources, and a source opens its document.
  const source = reply.locator("[data-source]").first();
  await expect(source).toBeVisible();
  const name = (await source.locator(".font-mono").nth(1).innerText()).trim();
  await source.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(name);
  await page.keyboard.press("Escape");

  // The thread is kept for this collection when the page reloads.
  await page.reload();
  await expect(page.getByRole("article", { name: "VAULT's reply" })).toHaveCount(1);
});

test("the chat page fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedIn(page, "viewer", "/chat");
  await page.getByRole("button", { name: "Find drawings for Alpha, newest first" }).click();
  const reply = page.getByRole("article", { name: "VAULT's reply" }).last();
  await expect(reply.locator('[data-helper="sorter"]')).toHaveAttribute("data-status", "finished", { timeout: 30_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
