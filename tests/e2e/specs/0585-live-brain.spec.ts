import { expect, test } from "@playwright/test";
import { signedIn } from "./helpers";

// F10.22: what the Ask VAULT helpers really did is recorded, and the brain's ticker lists it in words.
test("a chat question shows up in the brain's activity ticker", async ({ page }) => {
  await signedIn(page, "viewer", "/chat");
  const input = page.getByLabel("Message");
  await input.fill("Which parts have conflicting pressure ratings?");
  await input.press("Enter");
  const reply = page.getByRole("article", { name: "VAULT's reply" }).last();
  await expect(reply.locator('[data-helper="finder"]')).toHaveAttribute("data-status", "finished", { timeout: 30_000 });
  await expect(reply.locator('[data-helper="facts"]')).toHaveAttribute("data-status", "finished", { timeout: 30_000 });
  const watch = reply.getByRole("link", { name: "Watch in the brain" });
  await expect(watch).toBeVisible();
  const href = await watch.getAttribute("href");
  expect(href).toMatch(/^\/brain\?run=ask-[0-9a-f]+$/);

  // The whole collection's feed: the Finder row is there, and nothing is replayed, so it says it is idle.
  await page.goto("/brain");
  const ticker = page.getByRole("region", { name: "What VAULT is doing" });
  await expect(ticker).toBeVisible();
  await expect(ticker.getByRole("list", { name: "Activity" })).toContainText(/Finder looked at \d+ documents?/);
  await expect(ticker.getByRole("list", { name: "Activity" })).toContainText(/Fact checker checked \d+ of \d+ cited sentences?/);
  await expect(ticker.getByRole("status")).toHaveText("Idle: nothing is happening right now");

  // The link from the reply opens the brain on that reply's own record only.
  await page.goto(href!);
  await expect(ticker).toContainText("Showing only the helpers' work for one reply");
  const rows = ticker.getByRole("list", { name: "Activity" }).locator("li[data-action]");
  await expect(rows.first()).toBeVisible();
  const actions = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-action")));
  expect(new Set(actions)).toEqual(new Set(["looked_at", "checked_conflicts", "cited", "fact_checked"]));
});

test("the live brain fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signedIn(page, "viewer", "/brain");
  await expect(page.getByRole("region", { name: "What VAULT is doing" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
