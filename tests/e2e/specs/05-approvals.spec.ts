import { expect, test } from "@playwright/test";
import { signedIn } from "./helpers";

// F10.8: an analyst can only propose; an administrator approves and VAULT exports copies.
test("analyst cannot approve the seeded proposal", async ({ page }) => {
  await signedIn(page, "analyst", "/approvals");
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toContainText("Waiting for an administrator");
  await expect(main).toContainText("Only an administrator can approve or reject this proposal.");
  await expect(page.getByRole("button", { name: "Approve and export copies" })).toHaveCount(0);
});

test("a plain-language request becomes a suggested pattern the analyst can check", async ({ page }) => {
  await signedIn(page, "analyst", "/approvals");
  await page.getByLabel("What should change").fill("Group everything by year first, then by project");
  await page.getByRole("button", { name: "Suggest a pattern from this request" }).click();
  // Locally this may be Llama 3 through Ollama; in CI, without Ollama, it is the rule-based reader.
  await expect(page.getByRole("status").filter({ hasText: "Suggested" })).toContainText("{year}/{project}", {
    timeout: 30_000,
  });
  await expect(page.getByLabel("Folder pattern")).toHaveValue("{year}/{project}");
});

test("admin approves, files are copied and originals stay untouched", async ({ page }) => {
  await signedIn(page, "admin", "/approvals");
  await page.getByRole("button", { name: "Approve and export copies" }).first().click();
  const main = page.getByRole("main");
  await expect(main).toContainText("Approved and exported");
  await expect(main).toContainText("The originals were not touched.");
});
