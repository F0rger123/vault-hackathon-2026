import { expect, test, type APIRequestContext } from "@playwright/test";
import { API, COLLECTION, signedIn, token } from "./helpers";

// F10.24: view-only browsing of approval requests, and an admin deleting a request and one exported copy.
// Runs after 05-approvals, which approved the seeded proposal, so there is one approved request with copies.

const bearer = (role: "admin" | "analyst" | "viewer") => ({ Authorization: `Bearer ${token(role)}` });

async function demoCollection(request: APIRequestContext): Promise<number> {
  const list = (await (await request.get(`${API}/collections`, { headers: bearer("analyst") })).json()) as { id: number; name: string }[];
  return list.find((c) => c.name === COLLECTION)!.id;
}

test("a viewer browses requests in view only and cannot change anything", async ({ page }) => {
  await signedIn(page, "viewer", "/approvals");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "How approvals work" })).toBeVisible();
  await expect(main).toContainText("Nothing on this screen can approve, reject or delete anything.");
  const requests = main.getByRole("list", { name: "Requests" });
  await expect(requests.getByRole("button").first()).toBeVisible();
  await requests.getByRole("button").first().click();
  await expect(main.getByRole("region", { name: "Before and after" })).toBeVisible();
  await expect(main).toContainText("read-only store of originals");
  for (const name of ["Approve and export copies", "Reject", "Delete this request", "Delete its copies only"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: /^Delete the copy of/ })).toHaveCount(0);
  // Each file opens in the document drawer.
  await main.getByRole("button", { name: /^Open / }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("an admin switches to view only, then deletes one copy and a whole request", async ({ page, request }) => {
  const cid = await demoCollection(request);
  const made = await request.post(`${API}/proposals`, {
    headers: bearer("analyst"),
    data: { collection_id: cid, instruction: "Throwaway layout to delete", pattern: "{year}/{project}" },
  });
  expect(made.status()).toBe(201);
  const extra = (await made.json()) as { id: number };

  await signedIn(page, "admin", "/approvals");
  const main = page.getByRole("main");
  const requests = main.getByRole("list", { name: "Requests" });

  // View only hides every control, even for an admin.
  await main.getByRole("tab", { name: "View only" }).click();
  await requests.getByRole("button", { name: new RegExp(`^Proposal ${extra.id} `) }).click();
  await expect(page.getByRole("button", { name: "Delete this request" })).toHaveCount(0);
  await main.getByRole("tab", { name: "Review and decide" }).click();

  // One copy of the approved request.
  await main.getByRole("group", { name: "Show requests" }).getByRole("button", { name: /^Approved/ }).click();
  await requests.getByRole("button").first().click();
  const copyButtons = main.getByRole("button", { name: /^Delete the copy of/ });
  await expect(copyButtons.first()).toBeVisible();
  const before = await copyButtons.count();
  await copyButtons.first().click();
  let dialog = page.getByRole("dialog", { name: "Delete this copy?" });
  await expect(dialog).toContainText("Originals are never deleted.");
  await dialog.getByRole("button", { name: "Delete copy" }).click();
  await expect(main).toContainText("Removed 1 copy");
  await expect(copyButtons).toHaveCount(before - 1);
  await expect(main.getByText("Copy deleted").first()).toBeVisible();

  // The whole throwaway request.
  await main.getByRole("group", { name: "Show requests" }).getByRole("button", { name: /^All/ }).click();
  await requests.getByRole("button", { name: new RegExp(`^Proposal ${extra.id} `) }).click();
  await main.getByRole("button", { name: "Delete this request" }).click();
  dialog = page.getByRole("dialog", { name: `Delete proposal ${extra.id}?` });
  await expect(dialog).toContainText("Throwaway layout to delete");
  await dialog.getByRole("button", { name: "Delete request" }).click();
  await expect(main).toContainText(`Deleted proposal ${extra.id}. Originals were not touched.`);
  await expect(requests.getByRole("button", { name: new RegExp(`^Proposal ${extra.id} `) })).toHaveCount(0);
  const gone = await request.get(`${API}/proposals/${extra.id}`, { headers: bearer("viewer") });
  expect(gone.status()).toBe(404);

  // Both deletes are in the audit log.
  const audit = (await (await request.get(`${API}/audit?limit=50`, { headers: bearer("admin") })).json()) as { action: string }[];
  expect(audit.some((a) => a.action === "proposal.delete")).toBe(true);
  expect(audit.some((a) => a.action === "proposal.copies.delete")).toBe(true);
});

test("the guide walks through every step and links to each place", async ({ page }) => {
  await signedIn(page, "viewer", "/guide");
  await expect(page.getByRole("heading", { name: "How to use VAULT" })).toBeVisible();
  const steps = page.getByRole("navigation", { name: "Guide steps" }).getByRole("link");
  await expect(steps).toHaveCount(10);
  await page.getByRole("link", { name: "Open Approvals in view only" }).click();
  await expect(page).toHaveURL(/\/approvals\?view=only/);
  await expect(page.getByRole("main")).toContainText("View only.");
});
