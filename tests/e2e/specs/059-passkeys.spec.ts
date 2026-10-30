import { expect, test } from "@playwright/test";
import { token } from "./helpers";

// F09.14: a real WebAuthn ceremony against a virtual authenticator (Chromium's built-in test device standing in for
// Windows Hello or a YubiKey): register a passkey, then sign in with it, with no password.
test("register a passkey and sign in with it", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "virtual authenticators are a Chromium feature");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  // Signed in for this page load only (not with an init script), so clearing the token later really signs out.
  await page.goto("/security");
  await page.evaluate((t) => {
    sessionStorage.setItem("vault.token", t);
    sessionStorage.setItem("vault.mode", "demo");
  }, token("viewer"));
  await page.reload();
  await page.getByLabel("Name for this passkey").fill("Virtual key");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("list", { name: "Your passkeys" })).toContainText("Virtual key");

  // Leave without signing out on the server (the shared test token must keep working), then sign in again.
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/");
  await page.getByLabel("Username").fill("viewer");
  await page.getByRole("button", { name: "Sign in with face, fingerprint or security key" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});
