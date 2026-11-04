import { expect, test } from "@playwright/test";
import { signedIn } from "./helpers";

// Phone width: the rail collapses into a menu that still reaches every screen, with no sideways scrolling.
test("menu opens on a phone and navigates to Ask Keeper", async ({ page }) => {
  await signedIn(page, "viewer", "/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Menu" }).click();
  await page.locator("#mobile-nav").getByRole("link", { name: "Ask Keeper" }).click();
  await expect(page.getByRole("heading", { name: "Ask Keeper" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
