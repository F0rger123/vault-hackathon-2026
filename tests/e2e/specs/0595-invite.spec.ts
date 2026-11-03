import { expect, test } from "@playwright/test";
import { API, signedIn } from "./helpers";

// F09.21: an admin walks through "Invite someone", copies the one-time link, and the invited person opens it in a
// separate browser, picks a password and lands signed in. Then the link no longer works.
test("invite someone with a one-time link", async ({ page, context, browser, browserName }) => {
  test.skip(browserName !== "chromium", "clipboard permissions are granted the Chromium way");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signedIn(page, "admin", "/security");
  await page.getByRole("button", { name: "Invite someone" }).click();
  const wizard = page.getByRole("region", { name: "Invite someone" });

  // 1. Who
  await wizard.getByLabel("Username").fill("nora.k");
  await wizard.getByLabel("Note for admins (optional)").fill("Site engineer, north yard");
  await wizard.getByRole("button", { name: "Next" }).click();
  // 2. What they can do: the permissions come from the server, in plain words.
  await wizard.getByRole("radio", { name: /^analyst/i }).check();
  await expect(wizard.getByRole("list", { name: "What analyst can do" })).toContainText("Add files");
  await expect(wizard.getByRole("list", { name: "What analyst cannot do" })).toContainText("Approve or reject suggested changes");
  await wizard.getByRole("button", { name: "Next" }).click();
  // 3. How they sign in: password only, the default. Back and forward keeps the answers.
  await expect(wizard.getByRole("heading", { name: /How will they sign in/ })).toBeFocused();
  await wizard.getByRole("button", { name: "Back", exact: true }).click();
  await expect(wizard.getByRole("radio", { name: /^analyst/i })).toBeChecked();
  await wizard.getByRole("button", { name: "Next" }).click();
  await wizard.getByRole("button", { name: "Next" }).click();
  // 4. How they get in: the one-time link, the default.
  await expect(wizard.getByRole("radio", { name: /One-time invite link/ })).toBeChecked();
  await wizard.getByRole("button", { name: "Next" }).click();
  // 5. Review and create.
  await expect(wizard).toContainText("nora.k");
  await expect(wizard).toContainText("One-time link and code, valid 48 hours");
  await wizard.getByRole("button", { name: "Create invite" }).click();

  await expect(wizard.getByRole("heading", { name: "Invite ready for nora.k" })).toBeVisible();
  await expect(wizard.getByRole("img", { name: /QR code of the invite link/ })).toBeVisible();
  await wizard.getByRole("button", { name: "Copy invite link" }).click();
  await expect(wizard.getByRole("button", { name: "Copy invite link" })).toHaveText("Copied");
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/join#[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/);
  await expect(wizard.getByRole("textbox", { name: "Invite link" })).toHaveValue(link);
  await expect(page.getByRole("list", { name: "Invites waiting" })).toContainText("nora.k");

  // The invited person, in a fresh browser with nothing stored.
  const theirs = await browser.newContext();
  const them = await theirs.newPage();
  await them.goto(link);
  await expect(them.getByText(/admin\s+invited you to VAULT as\s+analyst/)).toBeVisible();
  await them.getByLabel("Choose a password").fill("north yard lantern 42");
  await them.getByLabel("Type it again").fill("north yard lantern 42");
  await them.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(them).toHaveURL(/\/security\?joined=1$/);
  await expect(them.getByText("You are signed in. Welcome to VAULT.")).toBeVisible();
  const me = await them.evaluate(async (api) => {
    const r = await fetch(`${api}/me`, { headers: { Authorization: `Bearer ${sessionStorage.getItem("vault.token")}` } });
    return r.json();
  }, API);
  expect(me).toMatchObject({ username: "nora.k", role: "analyst" });

  // Used once, it is gone: from the admin's list, and for anyone opening it again.
  const again = await theirs.newPage();
  await again.goto(link);
  await expect(again.getByRole("heading", { name: "This invite cannot be used" })).toBeVisible();
  await theirs.close();
  await page.reload();
  await expect(page.getByRole("list", { name: "People" })).toContainText("nora.k");
  await expect(page.getByRole("list", { name: "Invites waiting" })).toHaveCount(0);
});
