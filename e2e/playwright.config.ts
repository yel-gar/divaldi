import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * These tests run against the real Docker Compose stack (frontend, backend,
 * workers, PostgreSQL, Redis, MinIO) with `SBER_API_KEY=mock`, so the whole
 * request path is exercised while the LLM itself is offline and free.
 *
 * Start the stack first:
 *   cp docker-compose.override.yml{.e2e,}
 *   docker compose up -d --build
 *
 * Override E2E_BASE_URL to point at an already-running stack.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:18080";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  // A single worker on purpose. The whole suite runs as one seeded user and the
  // backend rate-limits chat creation and message sending to 5 per minute per
  // user, so parallel workers would trip each other's limiter. The helper
  // fixture clears those counters between tests, which only holds if the tests
  // are serial.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // A generation walks the real worker pipeline: PDF-less DXF parsing, the
  // calculator writing a spreadsheet, and a MinIO round trip. A minute is a
  // comfortable ceiling on a cold image.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }], ["list"]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
