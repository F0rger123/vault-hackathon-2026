import { expect, test, type Page } from "@playwright/test";
import { signedIn } from "./helpers";

// F10.23: Investigate is part of Ask Keeper. Conflicts show as redline cards in the reply, lists show as result
// rows that open the document drawer, the old filters are chips, and the export is in the header.
// (Earlier: F10.4–F10.6 and F10.10 findings, search with filters, document drawer.)

async function ask(page: Page, message: string) {
  const input = page.getByLabel("Message");
  await input.fill(message);
  await input.press("Enter");
  const reply = page.getByRole("article", { name: "Keeper's reply" }).last();
  await expect(reply.getByText(/s in all/)).toBeVisible({ timeout: 30_000 });
  return reply;
}

test("old Investigate links open the chat and keep their words", async ({ page }) => {
  await signedIn(page, "analyst", "/investigate?q=hydrostatic%20test");
  await expect(page).toHaveURL(/\/chat/);
  await expect(page.getByRole("heading", { name: "Ask Keeper" })).toBeVisible();
  await expect(page.getByLabel("Message")).toHaveValue("hydrostatic test");
  await expect(page.locator("nav").getByRole("link", { name: "Investigate" })).toHaveCount(0);
});

test("a conflict question shows the conflicting quotes side by side, checked against the source", async ({ page }) => {
  await signedIn(page, "analyst", "/chat");
  const reply = await ask(page, "Which parts have conflicting pressure ratings?");
  const cards = reply.getByTestId("keeper-findings");
  await expect(cards).toContainText("Rating conflict");
  await expect(cards).toContainText("Every quote verified");
  await expect(cards).toContainText("Verified in source");
  await expect(cards.locator("article").first()).toBeVisible();
});

test("a list shows result rows that open each kind of document", async ({ page }) => {
  await signedIn(page, "analyst", "/chat");
  for (const [words, type] of [
    ["inspection reports", "Inspection report"],
    ["drawings", "Engineering drawing"],
    ["contracts", "Contract"],
  ] as const) {
    const reply = await ask(page, `find ${words}`);
    const rows = reply.getByTestId("keeper-results").locator("li button.w-full");
    await expect(rows.first()).toBeVisible();
    await expect(rows.first()).toContainText(type);
    const name = (await rows.first().locator(".font-mono").first().innerText()).trim();
    await rows.first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name })).toBeVisible();
    await expect(drawer).toContainText(type);
    // F04.8: every extraction says which model read it and whether the text left the machine.
    await expect(drawer).toContainText("on this machine");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  }
});

test("the refine chips change the last list", async ({ page }) => {
  await signedIn(page, "analyst", "/chat");
  await ask(page, "find inspection reports");
  await page.getByRole("button", { name: /Refine: kind of file and order/ }).click();
  await page.getByRole("group", { name: "Refine the list" }).getByRole("button", { name: "A to Z" }).click();
  const reply = page.getByRole("article", { name: "Keeper's reply" }).last();
  await expect(reply.locator('[data-helper="sorter"]')).toHaveAttribute("data-status", "finished", { timeout: 30_000 });
  await expect(page.getByRole("group", { name: "Refine the list" }).getByRole("button", { name: "A to Z" })).toHaveAttribute("aria-pressed", "true");
});

test("exports the extracted records as a CSV table", async ({ page }) => {
  // F08.5: one row per part, each with the file and page it came from.
  await signedIn(page, "analyst", "/chat");
  await page.getByRole("button", { name: "Export table" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^vault-.+-records\.csv$/);
  const text = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(text.split("\n")[0]).toContain("part_number");
  expect(text.split("\n")[0]).toContain("evidence_quote");
  await expect(page.getByRole("status").filter({ hasText: "Downloaded the CSV file." })).toBeVisible();
});

test("a liked answer is remembered and recalled, then checked again", async ({ page }) => {
  await signedIn(page, "analyst", "/chat");
  const learned = page.getByTestId("keeper-learned");
  await expect(learned).toBeVisible();
  const before = Number((await learned.innerText()).match(/(\d+)/)![1]);
  const reply = await ask(page, "Which parts in Project Alpha have conflicting pressure ratings?");
  await reply.getByRole("button", { name: "Good answer" }).click();
  await expect(reply.getByRole("button", { name: "Good answer" })).toHaveAttribute("aria-pressed", "true");
  await expect(learned).toContainText(`learned from ${before + 1}`);

  const again = await ask(page, "which parts in project alpha have conflicting pressure ratings");
  const recall = again.getByRole("region", { name: "You asked this before" });
  await expect(recall).toBeVisible();
  await expect(recall).toContainText("Still true");
});

test("the drawer previews the original PDF inside the app and widens to full screen", async ({ page }) => {
  // F11.9: the original is fetched with the token and shown from an object URL, not opened in a new tab.
  await signedIn(page, "analyst", "/chat");
  const reply = await ask(page, "find inspection reports");
  const row = reply.getByTestId("keeper-results").locator("li button.w-full").filter({ hasText: /\.pdf/ }).first();
  await row.click();
  const drawer = page.getByRole("dialog");
  const preview = drawer.locator('iframe[title^="Preview of"]');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /^blob:/);
  await expect(drawer.getByRole("button", { name: "Download the original" })).toBeEnabled();
  await drawer.getByRole("button", { name: "Full screen" }).click();
  await expect(drawer.getByRole("button", { name: "Narrower" })).toHaveAttribute("aria-pressed", "true");
  const width = await drawer.evaluate((d) => d.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(900);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});
