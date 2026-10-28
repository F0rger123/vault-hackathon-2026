import { expect, test } from "@playwright/test";
import { COLLECTION, token } from "./helpers";

// F10.1 and F10.2: sign in with a pasted token, see the overview of the seeded collection.
test("a bad token is refused and a good one opens the overview", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("API token").fill("vlt_not-a-real-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText("That token was not accepted. Paste a current token.")).toBeVisible();

  await page.getByLabel("API token").fill(token("analyst"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(COLLECTION);
});

test("overview shows the seeded archive, findings and a local-only privacy posture", async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem("vault.token", t), token("viewer"));
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main).toContainText(/Documents\s*150/);
  await expect(main).toContainText(/Findings\s*10/);
  await expect(main).toContainText("Rating conflict");
  await expect(main).toContainText("Remote inference is off");
  await expect(main).toContainText("Rules baseline");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
