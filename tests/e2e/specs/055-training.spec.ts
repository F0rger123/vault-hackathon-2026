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

test("the quiz shows a document and VAULT's reading, and Ctrl+K finds places", async ({ page }) => {
  // F07.9: quiz VAULT one document at a time; the command palette jumps anywhere.
  await signedIn(page, "analyst", "/training");
  await expect(page.getByRole("list", { name: "Training steps" })).toBeVisible();
  const quiz = page.locator("section", { has: page.getByRole("heading", { name: "Quiz VAULT" }) });
  await expect(quiz).toContainText("VAULT says this is a");
  await quiz.getByRole("button", { name: "Skip" }).click();
  await expect(quiz).toContainText("VAULT says this is a");
  await page.keyboard.press("Control+k");
  await page.getByLabel("Search VAULT").fill("passkey");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/security/);
});
