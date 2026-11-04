import { expect, test } from "@playwright/test";
import { signedIn } from "./helpers";

// F12.16: the Overview in Demo mode offers the fictional demo files as a ZIP built by VAULT itself.
test("downloads the Quick Demo Dataset from the Overview", async ({ page }) => {
  await signedIn(page, "viewer", "/");
  const panel = page.locator("#demo-dataset");
  await expect(panel.getByRole("heading", { name: "Download Demo Dataset" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Complete Demo Dataset" })).toBeVisible();
  const download = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Quick Demo Dataset" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("vault-demo-dataset-quick.zip");
  const bytes = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c));
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  await expect(panel.getByRole("status")).toContainText("Downloaded the Quick Demo Dataset");
});
