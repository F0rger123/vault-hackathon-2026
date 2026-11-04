import { expect, test } from "@playwright/test";
import { COLLECTION, signedIn } from "./helpers";

// F12.17: runs after every other desktop spec, because it removes the shared demo archive (and then restores it).
test("an administrator deletes the demo data with one button and restores it", async ({ page }) => {
  await signedIn(page, "admin", "/");
  const panel = page.locator("#demo-data");
  await expect(panel.getByRole("button", { name: "Delete demo data" })).toBeVisible();

  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.accept();
  });
  await panel.getByRole("button", { name: "Delete demo data" }).click();
  // The session moves to Real mode, where 06-modes left "Our archive".
  await expect(page.locator("#collection-rail")).toContainText("Our archive");
  expect(asked).toContain(COLLECTION);
  expect(asked).toContain("Original files on your disk outside VAULT are not touched.");

  await page.getByRole("group", { name: "Data mode" }).first().getByRole("button", { name: "Demo" }).click();
  await expect(page.locator("#collection-rail")).not.toContainText(COLLECTION);
  const restore = page.locator("#demo-data");
  await expect(restore).toContainText("It stays deleted, even after a restart.");
  await restore.getByRole("button", { name: "Restore demo data" }).click();
  await expect(page.locator("#collection-rail")).toContainText(COLLECTION, { timeout: 60_000 });
});
