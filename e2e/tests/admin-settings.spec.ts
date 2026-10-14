import type { Locator, Page } from "@playwright/test";

import { expect, login, test } from "./helpers";

/**
 * The instance settings page (`/admin/settings`), reached with the superuser
 * created by the e2e setup script.
 *
 * Both cards talk to the single unified endpoint `PUT /api/v1/admin/settings`
 * with a partial body (`{ prompt_extension }` or `{ parameters }`), so each
 * test saves through the real UI and then reloads to prove the value persisted
 * on the server. Mutating tests restore the previous value at the end: the
 * settings row is instance-wide and the suite runs as one user, so a leftover
 * value would leak into every later test.
 *
 * Editing always goes through real keystrokes (`fill("")` to clear, then
 * `pressSequentially`), never a bare `fill()`: the custom input controls only
 * propagate trusted input events to the reactive form, so a programmatic fill
 * changes the DOM value while the form stays pristine and the save button
 * never enables.
 */
test.describe("admin instance settings", () => {
  async function openSettings(page: Page): Promise<void> {
    await login(page);
    await page.goto("/admin/settings");
    await expect(
      page.getByRole("heading", { name: "Настройки" }),
    ).toBeVisible();
    // The editors stay disabled until the settings load, so an enabled field
    // also proves the initial GET landed.
    await expect(page.locator("#system-prompt")).toBeEnabled();
    await expect(page.locator("#machine-laser")).toBeEnabled();
  }

  function putResponse(page: Page) {
    return page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/v1/admin/settings") &&
        resp.request().method() === "PUT",
    );
  }

  async function typeInto(locator: Locator, value: string) {
    await locator.fill("");
    await locator.pressSequentially(value);
  }

  test("updates the system prompt extension and keeps it after reload", async ({
    page,
    browser,
  }) => {
    await openSettings(page);

    const promptField = page.locator("#system-prompt");
    const previous = await promptField.inputValue();
    const updated = `e2e-дополнение ${Date.now()}`;

    await typeInto(promptField, updated);
    const promptCard = page.locator(".settings-card", {
      hasText: "Системный промпт",
    });
    const saveButton = promptCard.getByRole("button", { name: "Сохранить" });
    await expect(saveButton).toBeEnabled();

    const saved = putResponse(page);
    await saveButton.click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByText("Системный промпт сохранён")).toBeVisible();

    await page.reload();
    await expect(page.locator("#system-prompt")).toHaveValue(updated);

    // Restore through the API: the UI requires non-blank text, so a blank
    // previous value cannot be saved back through the form. The request
    // fixture has its own cookie jar, so the call goes through a context
    // carrying the logged-in storage state.
    const api = await browser.newContext({
      storageState: await page.context().storageState(),
    });
    try {
      const restored = await api.request.put("/api/v1/admin/settings", {
        data: { prompt_extension: previous },
      });
      expect(restored.ok()).toBe(true);
    } finally {
      await api.close();
    }
  });

  test("updates the machine parameters and keeps them after reload", async ({
    page,
  }) => {
    await openSettings(page);

    const laser = page.locator("#machine-laser");
    const previous = await laser.inputValue();

    await typeInto(laser, "12.5");
    const paramsCard = page.locator(".settings-card", {
      hasText: "Параметры станков",
    });
    const saveButton = paramsCard.getByRole("button", { name: "Сохранить" });
    await expect(saveButton).toBeEnabled();

    const saved = putResponse(page);
    await saveButton.click();
    expect((await saved).ok()).toBe(true);
    await expect(page.getByText("Параметры станков сохранены")).toBeVisible();

    await page.reload();
    await expect(page.locator("#machine-laser")).toHaveValue("12.5");

    await typeInto(page.locator("#machine-laser"), previous);
    const restored = putResponse(page);
    await paramsCard.getByRole("button", { name: "Сохранить" }).click();
    expect((await restored).ok()).toBe(true);
  });

  test("gates the parameter save on positive rates", async ({ page }) => {
    await openSettings(page);

    const paramsCard = page.locator(".settings-card", {
      hasText: "Параметры станков",
    });
    const saveButton = paramsCard.getByRole("button", {
      name: "Сохранить",
    });
    const laser = page.locator("#machine-laser");

    await expect(saveButton).toBeDisabled();

    await typeInto(laser, "0");
    await expect(saveButton).toBeDisabled();

    await typeInto(laser, "12.5");
    await expect(saveButton).toBeEnabled();
  });
});
