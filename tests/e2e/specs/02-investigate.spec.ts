import { expect, test } from "@playwright/test";
import { signedIn } from "./helpers";

// F10.4–F10.6 and F10.10: findings with verified quotes, search with filters, document drawer, Ask panel.
test.beforeEach(async ({ page }) => {
  await signedIn(page, "analyst", "/investigate");
  await expect(page.getByRole("heading", { name: "Investigate" })).toBeVisible();
});

test("findings show conflicting values with quotes checked against the source", async ({ page }) => {
  const main = page.getByRole("main");
  await expect(main).toContainText("Rating conflict");
  await expect(main).toContainText("Every quote verified");
  await expect(main).toContainText("Verified in source");
  await page.getByRole("group", { name: "Filter findings" }).getByRole("button", { name: /Part number collisions/ }).click();
  await expect(main).not.toContainText("Every quote verified");
});

test("search filters by document type and opens a document", async ({ page }) => {
  await page.getByLabel("Document type").selectOption({ label: "Inspection report" });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("main")).toContainText(/\d+ documents? matched/);
  const first = page.getByRole("button", { name: /-INS-\d+\.pdf$/ }).first();
  const name = (await first.innerText()).trim();
  await first.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(name);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("one document of each type opens in the document drawer", async ({ page }) => {
  const typeFilter = page.getByLabel("Document type");
  // The type list is loaded from the archive after the page renders, so wait for it.
  const realTypes = async () =>
    (await typeFilter.locator("option").allInnerTexts()).filter((t) => t.trim() && !/^any|all/i.test(t));
  await expect.poll(async () => (await realTypes()).length).toBeGreaterThanOrEqual(6);
  const types = await realTypes();
  for (const type of types) {
    await typeFilter.selectOption({ label: type });
    await page.getByRole("button", { name: "Search", exact: true }).click();
    // Wait for this search, not the previous one: each result line names its type.
    const results = page.getByRole("main").locator("li").filter({ hasText: type }).locator("button.font-mono");
    await expect(results.first()).toBeVisible();
    const name = (await results.first().innerText()).trim();
    await results.first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name })).toBeVisible();
    await expect(drawer).toContainText(type);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
  }
});

test("the Ask panel answers with numbered citations and labels the rule-based provider", async ({ page }) => {
  await page.getByLabel(/Answer with/).selectOption({ label: "Rule-based, not AI" });
  await page.getByRole("button", { name: "Which parts in Project Alpha have conflicting pressure ratings?" }).click();
  const answer = page.getByRole("list", { name: "Answer" });
  await expect(answer).toBeVisible({ timeout: 30_000 });
  await expect(answer.getByRole("listitem").first()).not.toBeEmpty();
  // The answer itself carries the label, not just the provider picker.
  await expect(page.getByText("Rule-based, not AI", { exact: true }).and(page.locator(":not(option)"))).toBeVisible();
  await page.getByRole("button", { name: /^Show source \d+$/ }).first().click();
  await expect(page.locator("[id^=ask-src-]").first()).toBeVisible();
});
