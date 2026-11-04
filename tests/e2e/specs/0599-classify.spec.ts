import { expect, test, type Page } from "@playwright/test";
import { signedIn } from "./helpers";

// F09.23: Keeper proposes labels and redactions from the chat, an admin approves them, and each role then sees only
// what its clearance allows. Fictional demo data only.

async function send(page: Page, message: string) {
  const input = page.getByLabel("Message");
  await input.fill(message);
  await input.press("Enter");
  return page.getByRole("article", { name: "Keeper's reply" }).last();
}

test("an analyst asks Keeper to mark the contracts confidential and gets a proposal", async ({ page }) => {
  await signedIn(page, "analyst", "/chat");
  const reply = await send(page, "mark the pricing contracts as confidential");
  await expect(reply).toContainText("Nothing changes until an administrator approves it", { timeout: 30_000 });
  await expect(reply.locator('[data-helper="classifier"]')).toHaveAttribute("data-status", "finished");
});

test("an admin approves the labels and redactions", async ({ page }) => {
  await signedIn(page, "admin", "/approvals");
  const main = page.getByRole("main");
  await expect(main).toContainText("to black out", { timeout: 15_000 });
  await page.getByRole("button", { name: "Approve labels and redactions" }).first().click();
  await expect(main).toContainText("Labels set and redactions applied");
});

test("an analyst sees the label and black bars; the original stays with admins", async ({ page }) => {
  await signedIn(page, "analyst", "/chat");
  const reply = await send(page, "find contracts");
  const rows = reply.getByTestId("keeper-results").locator("li button.w-full");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await expect(rows.first()).toContainText("confidential");
  await rows.first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Classification and redactions")).toBeVisible();
  const bar = drawer.locator('[data-redaction="applied"]').first();
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("title", /^Redacted: /);
  await expect(drawer.getByRole("button", { name: "Open the original" })).toBeDisabled();
});

test("a viewer cannot find confidential contracts at all", async ({ page }) => {
  await signedIn(page, "viewer", "/chat");
  const reply = await send(page, "find contracts");
  await expect(reply).toContainText(/No contracts/, { timeout: 30_000 });
});
