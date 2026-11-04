import { expect, test } from "@playwright/test";
import { signedIn } from "./helpers";

const PRESSURE = "Which parts have conflicting pressure ratings? Show the exact values and cite the original documents.";

// F10.20, F10.23 and F10.25: Ask Keeper shows the plan, each helper's real work, a cited answer, and beside it the
// Brain page's own 3D brain.
test("a question shows the helpers at work and an answer with sources", async ({ page }) => {
  await signedIn(page, "viewer", "/chat");
  await expect(page.getByRole("heading", { name: "Ask Keeper" })).toBeVisible();

  // The example prompts are grouped; the pressure question is the first one, and clicking it sends it.
  const brain = page.getByRole("region", { name: "Keeper's brain" });
  await expect(brain.locator("canvas")).toBeVisible();
  const groups = page.getByRole("region", { name: "Engineering and conflicts" });
  await expect(groups.getByRole("button").first()).toHaveText(PRESSURE);
  for (const title of ["Documents and research", "File organization", "Security and privacy"]) {
    await expect(page.getByRole("region", { name: title })).toBeVisible();
  }
  await groups.getByRole("button", { name: PRESSURE }).click();

  const reply = page.getByRole("article", { name: "Keeper's reply" }).last();
  await expect(reply.getByText("Keeper", { exact: true })).toBeVisible();
  // Each card turns finished only when the server's "finished" event for that helper has arrived.
  for (const helper of ["finder", "conflicts", "answer", "facts"]) {
    await expect(reply.locator(`[data-helper="${helper}"]`)).toHaveAttribute("data-status", "finished", { timeout: 30_000 });
  }
  await expect(reply).toContainText("run at the same time");
  await expect(reply).toContainText(/\d+ ms/);

  // The brain beside the chat is the 3D space (one canvas). Each helper's line finishes from the same events, the
  // recorded rows fly a labelled craft for the Finder and the Conflict checker, and the cited documents are listed.
  await expect(brain.locator("canvas")).toHaveCount(1);
  for (const helper of ["finder", "conflicts", "answer", "facts"]) {
    await expect(brain.locator(`[data-helper-line="${helper}"]`)).toHaveAttribute("data-status", "finished");
  }
  await expect(brain.locator('[data-craft="Finder"]').first()).toBeAttached();
  await expect(brain.locator('[data-craft="Conflict checker"]').first()).toBeAttached();
  const cited = brain.locator("[data-cited-doc]").first();
  await expect(cited).toBeVisible();
  await cited.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

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
  await expect(page.getByRole("article", { name: "Keeper's reply" })).toHaveCount(1);
});

test("the chat page fits a phone screen, with the brain behind a button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedIn(page, "viewer", "/chat");
  await expect(page.getByRole("region", { name: "Keeper's brain" })).toHaveCount(0);
  await page.getByRole("button", { name: "Find drawings for Project Alpha, newest first" }).click();
  const reply = page.getByRole("article", { name: "Keeper's reply" }).last();
  await expect(reply.locator('[data-helper="sorter"]')).toHaveAttribute("data-status", "finished", { timeout: 30_000 });
  await page.getByRole("button", { name: "Show the brain" }).click();
  await expect(page.getByRole("region", { name: "Keeper's brain" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Keeper's brain" }).locator("canvas")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

// F10.25: the reply belongs to the app, not to the chat page, so visiting another page does not stop it.
test("a reply keeps going while you visit another page, and is there when you come back", async ({ page }) => {
  await signedIn(page, "viewer", "/chat");
  await page.getByRole("button", { name: PRESSURE }).click();
  // Leave at once, through the app's own navigation (no reload).
  await page.locator("nav").getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.locator("nav").getByRole("link", { name: "Ask Keeper" }).click();
  const reply = page.getByRole("article", { name: "Keeper's reply" }).last();
  await expect(reply.getByText(/s in all/)).toBeVisible({ timeout: 30_000 });
  await expect(reply).not.toContainText("Stopped");
  await expect(reply.locator("[data-source]").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Keeper's brain" }).locator("[data-cited-doc]").first()).toBeVisible();
});
