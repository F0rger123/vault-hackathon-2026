import { expect, test } from "@playwright/test";
import { token } from "./helpers";

// F10.11: runs last, because it creates a real collection that changes the default mode.
test("Real mode hides the demo archive until you create your own collection", async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem("vault.token", t), token("analyst"));
  await page.goto("/setup");
  await page.getByRole("group", { name: "Data mode" }).first().getByRole("button", { name: "Real" }).click();
  await expect(page.getByRole("heading", { name: "Create your first collection" })).toBeVisible();
  await page.getByLabel("Collection name").fill("Our archive");
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(page.getByRole("main")).toContainText("0 documents");
  await expect(page.getByRole("note")).toHaveCount(0);

  // F12.17: uploaded files are listed at once, and reading starts by itself (rules baseline: no Ollama in e2e).
  const files = ["real-a.txt", "real-b.txt", "real-c.txt"].map((name, i) => ({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(`Real mode memo ${i + 1}. Project Delta. Valve RV-${100 + i} set at ${200 + i} psi.`),
  }));
  await page.getByLabel("Add files").setInputFiles(files);
  await page.getByRole("button", { name: "Upload 3 files" }).click();
  const list = page.getByRole("list", { name: "Documents in this collection" });
  for (const f of files) await expect(list).toContainText(f.name);
  await expect(page.locator("[data-reading]")).toBeVisible();
  await expect(page.locator('[data-reading="done"]')).toContainText("Read 3 of 3", { timeout: 45_000 });
  await expect(list.getByText("Read", { exact: true })).toHaveCount(3);
  await expect(page.getByRole("link", { name: "Open Progress" })).toHaveAttribute("href", /\/run\?job=\d+/);

  await page.getByRole("group", { name: "Data mode" }).first().getByRole("button", { name: "Demo" }).click();
  await expect(page.getByRole("main")).toContainText("Halvern Engineering Archive");
});
