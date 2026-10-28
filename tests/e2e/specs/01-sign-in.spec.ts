import { expect, test } from "@playwright/test";
import { API, COLLECTION, token } from "./helpers";

// F10.1, F10.2 and F10.11: sign in without handling tokens, see the overview of the seeded collection.
test("one-click demo sign-in opens the overview in Demo mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByText("No API key or internet account needed")).toBeVisible();
  await page.getByRole("button", { name: "Demo: analyst" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(COLLECTION);
  await expect(page.getByRole("note")).toContainText("Demo mode");

  // Signing out ends this session on the server, not just in the browser.
  const session = await page.evaluate(() => sessionStorage.getItem("vault.token"));
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  const after = await page.request.get(`${API}/me`, { headers: { Authorization: `Bearer ${session}` } });
  expect(after.status()).toBe(401);
});

test("a wrong password is refused with a clear message", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("analyst");
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("wrong username or password")).toBeVisible();
});

test("a bad token is refused and a good one still works", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Use an API token instead").click();
  await page.getByLabel("API token").fill("vlt_not-a-real-token");
  await page.getByRole("button", { name: "Sign in with token" }).click();
  await expect(page.getByText("That token was not accepted. Paste a current token.")).toBeVisible();

  if (!(await page.getByLabel("API token").isVisible())) await page.getByText("Use an API token instead").click();
  await page.getByLabel("API token").fill(token("analyst"));
  await page.getByRole("button", { name: "Sign in with token" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

test("overview shows the seeded archive, findings and a local-only privacy posture", async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem("vault.token", t), token("viewer"));
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main).toContainText(/Documents\s*150/);
  await expect(main).toContainText(/Findings\s*10/);
  await expect(main).toContainText("Rating conflict");
  await expect(main).toContainText("Remote inference is off");
  // F04.8: each provider is labelled with where document text goes.
  await expect(main).toContainText(/Meta Llama 3 via Ollama\s*On this machine/);
  await expect(main).toContainText(/Meta Model API \(Muse Spark\)\s*Remote/);
  await expect(main).toContainText(/Rules baseline\s*On this machine/);
});
