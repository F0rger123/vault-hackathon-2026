import { expect, test } from "@playwright/test";
import { token } from "./helpers";

// F10.11: runs last, because it creates a real collection that changes the default mode.
test("Real mode hides the demo archive until you create your own collection", async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem("vault.token", t), token("analyst"));
  await page.goto("/setup");
  await page.getByRole("group", { name: "Data mode" }).first().getByRole("button", { name: "Real" }).click();
  await expect(page.getByRole("heading", { name: "Create your first collection" })).toBeVisible();
  await page.getByLabel("Collection name").fill("Our archive");
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page.getByRole("main")).toContainText("0 documents");
  await expect(page.getByRole("note")).toHaveCount(0);
  await page.getByRole("group", { name: "Data mode" }).first().getByRole("button", { name: "Demo" }).click();
  await expect(page.getByRole("main")).toContainText("Halvern Engineering Archive");
});
