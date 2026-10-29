import { expect, test } from "@playwright/test";
import { signedIn } from "./helpers";

// F07.7 and F07.8: the collection brain shows what VAULT knows, asks about its gaps, and draws a map.
test("the brain shows its profile, its questions and a map you can click", async ({ page }) => {
  await signedIn(page, "analyst", "/brain");
  const main = page.getByRole("main");
  await expect(page.getByRole("heading", { name: "Brain", exact: true })).toBeVisible();
  await expect(main).toContainText(/\d+ of \d+ documents/);
  await expect(main).toContainText("VAULT's questions");
  await expect(page.getByRole("img", { name: /^Map of \d+ items/ })).toBeVisible();

  // Filtering the map is a toggle.
  const docs = page.getByRole("group", { name: "Show on the map" }).getByRole("button", { name: "Documents" });
  await docs.click();
  await expect(docs).toHaveAttribute("aria-pressed", "false");

  // Teach a meaning and forget it again, so the shared demo data stays as it was.
  await page.getByLabel("Term, marking or code").fill("E2E-TERM");
  await page.getByLabel("What it means").fill("A term taught by the browser test");
  await page.getByRole("button", { name: "Teach", exact: true }).click();
  await expect(main).toContainText("A term taught by the browser test");
  await page.getByRole("button", { name: "Forget" }).first().click();
  await expect(main).not.toContainText("A term taught by the browser test");
});
