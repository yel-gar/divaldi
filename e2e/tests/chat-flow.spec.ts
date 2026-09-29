import { expect, login, test } from "./helpers";

/**
 * The full request-to-offer journey, against the real Compose stack with the
 * offline provider. This exercises the router, the TaskIQ worker, the
 * calculator, and the MinIO round trip; only the LLM itself is mocked.
 */
test.describe("request to commercial offer", () => {
  test("creates a request, gets an answer and downloads the offer", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/create");

    await expect(
      page.getByRole("heading", { name: "Создать заявку" }),
    ).toBeVisible();
    await page
      .locator("#description")
      .fill("Кронштейн 200x100 мм, ст3 1 мм, 4 отверстия");

    await page.getByRole("button", { name: /Создать заявку/ }).click();

    // The create page hands the draft over and routes into the chat.
    await expect(page).toHaveURL(/\/chats\/.+/);
    await expect(
      page.getByText("Кронштейн 200x100 мм, ст3 1 мм, 4 отверстия"),
    ).toBeVisible();

    // The worker pipeline produces an assistant reply and a kp.xlsx.
    const offer = page.getByText(/kp\.xlsx/i).first();
    await expect(offer).toBeVisible({ timeout: 45_000 });

    // The results panel is toggled by an icon-only button with an aria-label.
    await page
      .getByRole("button", { name: "Панель результатов расчёта" })
      .click();
    await expect(page.locator(".results-aside")).toBeVisible();
    await expect(
      page.locator(".results-aside").getByText("kp.xlsx"),
    ).toBeVisible();
  });

  test("answers a follow-up message in the same session", async ({ page }) => {
    await login(page);
    await page.goto("/create");
    await page.locator("#description").fill("Фланец DN100, ст3 3 мм");
    await page.getByRole("button", { name: /Создать заявку/ }).click();
    await expect(page).toHaveURL(/\/chats\/.+/);

    await expect(page.getByText("Фланец DN100, ст3 3 мм")).toBeVisible();
    // app-input renders both a hidden input and the textarea, so target the
    // textarea directly rather than the placeholder.
    await page
      .locator('textarea[placeholder="Введите сообщение..."]')
      .fill("А сколько будет стоить?");
    await page.getByRole("button", { name: "Отправить" }).click();

    // Incoming messages are authored by "Агент"; the outgoing one is the user's.
    await expect(
      page.locator(".message__author", { hasText: "Агент" }).first(),
    ).toBeVisible({
      timeout: 45_000,
    });
  });
});
