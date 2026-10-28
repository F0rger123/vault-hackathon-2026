import { expect, test } from "@playwright/test";
import { signedIn } from "./helpers";

// F07.6: grade, let VAULT suggest rules, re-read, and see the held-out score go up in the history.
test("graded test, suggested rules and a re-test improve the held-out score", async ({ page }) => {
  test.setTimeout(120_000);
  await signedIn(page, "analyst", "/training");
  await expect(page.getByRole("heading", { name: "Training" })).toBeVisible();
  await expect(page.getByText("does not change the model's weights")).toBeVisible();

  await page.getByRole("button", { name: "Run graded test" }).click();
  await expect(page.getByRole("main")).toContainText("against demo ground truth");
  await expect(page.getByRole("main")).toContainText(/Planted conflicts found: 10 of 10/);
  await expect(page.getByRole("list", { name: "Graded test history" }).getByRole("listitem")).toHaveCount(1);

  await page.getByRole("button", { name: "Suggest rules" }).click();
  await page.getByRole("button", { name: /^Apply \d+ rules?$/ }).click();
  await expect(page.getByRole("status")).toContainText("published");

  await page.getByRole("button", { name: /^Re-read with/ }).click();
  await page.getByRole("link", { name: /^Watch run \d+/ }).click();
  await expect(page.getByRole("region", { name: "Run status" })).toContainText(/Completed/, { timeout: 60_000 });

  await page.goto("/training");
  await page.getByRole("button", { name: "Run graded test" }).click();
  const history = page.getByRole("list", { name: "Graded test history" }).getByRole("listitem");
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText(/\(\+\d+\.\d\)/); // held-out document type went up
});
