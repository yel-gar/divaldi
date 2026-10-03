import { createChat, expect, login, test } from "./helpers";

/**
 * Issue #47: deleting an uploaded file.
 *
 * This is the one gap unit tests structurally cannot close. Before #47 the
 * trash button called `removeItem`, which dropped the row from a signal and
 * nothing else, so a "deleted" file stayed on the session and was attached to
 * the next message. Only a browser driving the real API can tell that apart.
 *
 * The upload here is real: a presigned POST to object storage, then the
 * confirm call, then the worker. Nothing is stubbed.
 */

/** A minimal valid PDF, which the attachment pipeline accepts. */
const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "latin1",
);

/**
 * Attach a file through the chat's own picker.
 *
 * The compact dropzone in the chat view is given no `inputId`, so its hidden
 * input has no stable id to address. Clicking the attach button opens the real
 * file chooser, which Playwright intercepts via `fileChooser`.
 */
async function uploadFile(
  page: import("@playwright/test").Page,
  name: string,
): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Прикрепить файл" }).click(),
  ]);
  await chooser.setFiles({
    name,
    mimeType: "application/pdf",
    buffer: PDF_BYTES,
  });
}

test.describe("attachment upload and delete", () => {
  test("an uploaded file appears in the session and can be deleted", async ({
    page,
  }) => {
    await login(page);
    await createChat(page);

    // Open the results panel, where "Загруженные файлы" lives.
    await page
      .getByRole("button", { name: "Панель результатов расчёта" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Загруженные файлы" }),
    ).toBeVisible();
    await expect(page.getByText("Нет файлов в загрузке")).toBeVisible();

    // Upload through the real input the dropzone owns.
    await uploadFile(page, "drawing.pdf");

    const row = page.locator(".calculation-results__file", {
      hasText: "drawing.pdf",
    });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Delete it. This is the assertion that fails against the pre-#47 code,
    // where the button only removed the row locally.
    await row.getByRole("button", { name: "Удалить файл" }).click();

    await expect(row).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText("Нет файлов в загрузке")).toBeVisible();
  });

  test("a deleted file is gone from the API, not just the screen", async ({
    page,
    browser,
  }) => {
    await login(page);
    const sessionId = await createChat(page);
    await page
      .getByRole("button", { name: "Панель результатов расчёта" })
      .click();
    await uploadFile(page, "drawing.pdf");

    const row = page.locator(".calculation-results__file", {
      hasText: "drawing.pdf",
    });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // A fresh context shares no cookies with the page, so authenticate in it
    // rather than assuming the session cookie carries over.
    const api = await browser.newContext({
      storageState: await page.context().storageState(),
    });

    // The row is there server-side before the delete...
    const before = await api.request.get(
      `/api/v1/chats/${sessionId}/attachments`,
    );
    expect(before.ok()).toBeTruthy();
    const beforeBody = await before.json();
    expect(beforeBody.map((a: { filename: string }) => a.filename)).toContain(
      "drawing.pdf",
    );

    await row.getByRole("button", { name: "Удалить файл" }).click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });

    // ...and gone from it afterwards. An assertion only on the DOM would pass
    // against the old buggy code, because the row was removed locally too.
    const after = await api.request.get(
      `/api/v1/chats/${sessionId}/attachments`,
    );
    expect(after.ok()).toBeTruthy();
    const afterBody = await after.json();
    expect(
      afterBody.map((a: { filename: string }) => a.filename),
    ).not.toContain("drawing.pdf");
  });

  test("the delete call reports success to the session", async ({ page }) => {
    await login(page);
    const sessionId = await createChat(page);
    await page
      .getByRole("button", { name: "Панель результатов расчёта" })
      .click();
    await uploadFile(page, "drawing.pdf");

    const row = page.locator(".calculation-results__file", {
      hasText: "drawing.pdf",
    });
    await expect(row).toBeVisible({ timeout: 30_000 });

    // The DELETE must be a real request to the attachment route.
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/chats/${sessionId}/attachments/`) &&
          r.request().method() === "DELETE",
        { timeout: 15_000 },
      ),
      row.getByRole("button", { name: "Удалить файл" }).click(),
    ]);

    expect(response.status()).toBe(200);
  });
});
