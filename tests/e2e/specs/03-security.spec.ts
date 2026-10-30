import { expect, test } from "@playwright/test";
import { API, signedIn, token } from "./helpers";

// F10.9: remote inference is off by default, only an admin may change it, and the audit log records denials.
test("viewer sees remote inference off and cannot change it", async ({ page }) => {
  await signedIn(page, "viewer", "/security");
  const main = page.getByRole("main");
  await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
  await expect(main).toContainText(/Remote inference\s*Off/);
  await expect(main).toContainText("Administrators only");
  await expect(page.getByRole("button", { name: "Allow remote inference" })).toHaveCount(0);
});

test("a viewer's upload is refused by the server and shows in the admin's audit log", async ({ page, request }) => {
  const denied = await request.post(`${API}/collections/1/documents`, {
    headers: { Authorization: `Bearer ${token("viewer")}` },
    multipart: { files: { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello") } },
  });
  expect(denied.status()).toBe(403);

  await signedIn(page, "admin", "/security");
  await page.getByRole("group", { name: "Filter audit log" }).getByRole("button", { name: "Denied" }).click();
  const main = page.getByRole("main");
  await expect(main).toContainText("viewer");
  await expect(main).toContainText(/denied/i);
});
