import { expect, test } from "@playwright/test";
import { signedIn } from "./helpers";

// F10.3 and F10.7: upload files, start a run with the rule-based lane, watch it finish on the live board.
test("upload five files, start a rule-based run and watch it complete", async ({ page }) => {
  await signedIn(page, "analyst", "/setup");
  await expect(page.getByRole("heading", { name: "Set up a run" })).toBeVisible();
  // F12.9 and F03.6: the one-button start and the local-models card are the first things on the page.
  await expect(page.getByRole("heading", { name: "Quick start" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This computer" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Read everything/ })).toBeEnabled();

  const files = Array.from({ length: 5 }, (_, i) => ({
    name: `e2e-note-${i + 1}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(`E2E test memo ${i + 1}. Project Alpha. Part BV-7891 rated 1500 psi.`),
  }));
  await page.getByLabel("Add files").setInputFiles(files);
  await page.getByRole("button", { name: "Upload 5 files" }).click();
  await expect(page.getByRole("main")).toContainText(/155 documents/);

  // Measuring the machine is an administrator's job; analysts are told so instead of seeing the button.
  await expect(page.getByRole("main")).toContainText("Only administrators can run a measurement.");

  await page.getByText("More options: teach by example").click();
  await page.getByRole("combobox", { name: "Model" }).first().selectOption({ label: "Rules baseline" });
  await page.getByRole("button", { name: "Start run" }).click();

  await expect(page).toHaveURL(/\/run\?job=\d+/);
  await expect(page.getByRole("heading", { name: "Live run board" })).toBeVisible();
  const status = page.getByRole("region", { name: "Run status" });
  await expect(status).toContainText(/Completed/, { timeout: 45_000 });
  await expect(status).toContainText("155 of 155");

  // F10.13: the summary comes from the agents' records, and the coordinator answers questions from it.
  await expect(page.getByRole("heading", { name: "Run summary" })).toBeVisible();
  await page.getByRole("button", { name: "Did anything fail?" }).click();
  await expect(page.getByText("Nothing failed in this run.")).toBeVisible();
  await expect(page.getByText("Rule-based answer, not AI")).toBeVisible();
});

test("an administrator measures this machine with real stored documents", async ({ page }) => {
  await signedIn(page, "admin", "/setup");
  await page.getByText("More options: teach by example").click();
  const rules = page.getByRole("row", { name: /Rules baseline/ });
  await expect(rules).toContainText("Not measured yet");
  await rules.getByRole("button", { name: "Measure" }).click();
  await expect(rules).toContainText("Measured", { timeout: 45_000 });
});
