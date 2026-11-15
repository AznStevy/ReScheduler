import { expect, test } from "@playwright/test";

test("solves a binary integer program inside the browser worker", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("button", { name: "Generation", exact: true }).click();
  await expect(page.getByTestId("solver-status")).toContainText(/objective 1/i);
});

test("opens every section, including on a narrow screen", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation");
  const admin = page.getByText("Admin", { exact: true });
  const transfer = nav.getByRole("button", { name: "Import / Export", exact: true });
  const settings = nav.getByRole("button", { name: "Settings", exact: true });
  const adminBox = await admin.boundingBox();
  const transferBox = await transfer.boundingBox();
  const settingsBox = await settings.boundingBox();
  if (!adminBox || !transferBox || !settingsBox) throw new Error("missing admin navigation");
  expect(transferBox.y).toBeGreaterThan(adminBox.y);
  expect(settingsBox.y).toBeGreaterThan(transferBox.y);
  const pages = [
    ["Residents", "Residents"],
    ["Rotations", "Rotations"],
    ["Blocks", "Blocks"],
    ["Schedule", "Schedule"],
    ["Generation", "Schedule Generation"],
    ["Conflicts", "Conflicts"],
    ["Import / Export", "Import / Export"],
    ["Settings", "Settings"],
  ];
  for (const [button, heading] of pages) {
    await page.getByRole("navigation").getByRole("button", { name: button, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "Residents", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Residents" })).toBeVisible();
});

test("returns to the overview from the ReScheduler name", async ({ page }) => {
  await page.goto("/#residents");
  await expect(page.getByRole("heading", { level: 1, name: "Residents" })).toBeVisible();
  await page.getByRole("button", { name: /ReScheduler/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await page.locator("main").getByRole("button", { name: /^Schedule/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  await page.getByRole("button", { name: /ReScheduler/ }).click();
  await page.getByRole("button", { name: "Open the dashboard", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
});

test("keeps the program after a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Sample program").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Sample program").first()).toBeVisible();
});

test("exports an Excel workbook", async ({ page }) => {
  await page.goto("/#transfer");
  await page.getByLabel("Format").selectOption("xlsx");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".xlsx");
});

test("resolves the authorized ICU conflict and applies a validated schedule", async ({ page }) => {
  await page.goto("/#settings");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Coverage Conflict" }).click();
  await page.getByRole("button", { name: "Generation", exact: true }).click();
  await expect(page.getByTestId("solver-status")).toContainText(/objective 1/i);
  await page.getByRole("button", { name: "Generate Schedule" }).click();
  await expect(page.getByText(/^(Feasible|Optimal)$/).first()).toBeVisible({ timeout: 60_000 });
  expect(await page.getByRole("button", { name: "Preview", exact: true }).count()).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Dusk", exact: true }).click();
  await page.getByRole("button", { name: "Generation", exact: true }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const cell = dialog.locator("td.on-tint", { hasText: /\S/ }).first();
  await expect(cell).toBeVisible();
  expect((await cell.innerText()).trim().length).toBeGreaterThan(0);
  expect(await cell.evaluate((node) => getComputedStyle(node).color)).toBe("rgb(36, 52, 61)");
  await dialog.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  await expect(page.getByRole("button", { name: /ICU|WARD/ }).first()).toBeVisible();
});

test("locks a whole schedule block without locking the other blocks", async ({ page }) => {
  await page.goto("/#schedule");
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  await page.getByRole("button", { name: "Lock block B01", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unlock block B01", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Lock block B02", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.locator("button", { has: page.locator("[aria-label='Locked block']") }).first().click();
  await expect(page.getByRole("dialog")).toContainText("This block is locked");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Unlock block B01", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lock block B01", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("locks one resident's schedule without locking the next resident", async ({ page }) => {
  await page.goto("/#schedule");
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  await page.getByRole("button", { name: "Lock Avery Alden's schedule", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unlock Avery Alden's schedule", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Lock Blake Alden's schedule", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.locator("button", { has: page.locator("[aria-label='Locked schedule']") }).first().click();
  await expect(page.getByRole("dialog")).toContainText("This resident's schedule is locked");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Unlock Avery Alden's schedule", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lock Avery Alden's schedule", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("drags a lock across columns and rows", async ({ page }) => {
  await page.goto("/#schedule");
  await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
  await dragBetween(page, "Lock block B01", "Lock block B03");
  await expect(page.getByRole("button", { name: "Unlock block B01", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Unlock block B02", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Unlock block B03", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Lock block B04", exact: true })).toHaveAttribute("aria-pressed", "false");
  await dragBetween(page, "Unlock block B01", "Unlock block B03");
  await expect(page.getByRole("button", { name: "Lock block B01", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Lock block B02", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Lock block B03", exact: true })).toHaveAttribute("aria-pressed", "false");
  await dragBetween(page, "Lock Avery Alden's schedule", "Lock Casey Alden's schedule");
  await expect(page.getByRole("button", { name: "Unlock Avery Alden's schedule", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Unlock Blake Alden's schedule", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Unlock Casey Alden's schedule", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Lock Drew Alden's schedule", exact: true })).toHaveAttribute("aria-pressed", "false");
  await dragBetween(page, "Unlock Avery Alden's schedule", "Unlock Casey Alden's schedule");
  await expect(page.getByRole("button", { name: "Lock Avery Alden's schedule", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Lock Blake Alden's schedule", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Lock Casey Alden's schedule", exact: true })).toHaveAttribute("aria-pressed", "false");
});

async function dragBetween(page, fromName, toName) {
  const start = await page.getByRole("button", { name: fromName, exact: true }).boundingBox();
  const end = await page.getByRole("button", { name: toName, exact: true }).boundingBox();
  if (!start || !end) throw new Error(`missing ${fromName} or ${toName}`);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("stops a running optimization", async ({ page }) => {
  await page.goto("/#optimize");
  await expect(page.getByTestId("solver-status")).toContainText(/objective 1/i);
  await page.getByRole("button", { name: "Generate Schedule" }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText(/cancelled/i).first()).toBeVisible();
});
