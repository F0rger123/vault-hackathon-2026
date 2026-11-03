import { expect, test } from "@playwright/test";
import { API, token } from "./helpers";

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
  await page.getByRole("button", { name: /Passkey\s*\d+ added/ }).click();
  await page.getByLabel("Name for this passkey").fill("Virtual key");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("list", { name: "Your passkeys" })).toContainText("Virtual key");

  // Leave without signing out on the server (the shared test token must keep working), then sign in again.
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/");
  await page.getByLabel("Username").fill("viewer");
  await page.getByRole("button", { name: /Sign in with a passkey/ }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

// F09.20: a hardware security key (a virtual USB FIDO2 key with a PIN) as the second of two chosen steps. A person
// picks "Password" and "Passkey"; the password alone then gives no session until the key is used.
test("a security key as a second step after the password", async ({ page, browserName, request }) => {
  test.skip(browserName !== "chromium", "virtual authenticators are a Chromium feature");
  const name = `keyholder${Date.now() % 100000}`;
  const password = "a long enough password";
  const made = await request.post(`${API}/users`, {
    headers: { Authorization: `Bearer ${token("admin")}` },
    data: { username: name, role: "viewer", password },
  });
  expect(made.status()).toBe(201);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "usb",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  const signInWithPassword = async () => {
    await page.goto("/");
    await page.getByLabel("Username").fill(name);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  };
  await signInWithPassword();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  await page.goto("/security");
  await page.getByRole("button", { name: /Passkey\s*\d+ added/ }).click();
  await page.getByRole("radio", { name: /Security key/ }).click();
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(page.getByRole("list", { name: "Your passkeys" })).toContainText("Security key");

  const steps = page.getByRole("group", { name: "Sign-in steps" });
  await steps.getByRole("button", { name: /^Password/ }).click();
  await steps.getByRole("button", { name: /^Passkey/ }).click();
  await page.getByRole("button", { name: "Save sign-in steps" }).click();
  await expect(page.getByText("The next sign-in asks for these steps")).toBeVisible();

  await page.evaluate(() => sessionStorage.clear());
  await signInWithPassword();
  await expect(page.getByText("step 2 of 2")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Overview" })).toHaveCount(0); // the password alone gave no session
  await page.getByRole("button", { name: "Use my passkey" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});
