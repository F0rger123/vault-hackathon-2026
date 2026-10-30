import { expect, test } from "@playwright/test";
import { COLLECTION, signedIn } from "./helpers";

// F10.12: the collection switcher lists every collection with its size and offers a new one.
test("the collection switcher lists collections and offers a new one", async ({ page }) => {
  await signedIn(page, "analyst", "/");
  const button = page.locator("#collection-rail");
  await expect(button).toContainText(COLLECTION);
  await button.click();
  const list = page.getByRole("listbox", { name: "Collections" });
  await expect(list).toBeVisible();
  await expect(list.getByRole("option", { selected: true })).toContainText(COLLECTION);
  await page.getByRole("button", { name: /New collection/ }).click();
  await expect(page.getByLabel(/Name of the new/)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
});
