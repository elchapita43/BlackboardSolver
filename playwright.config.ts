import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 300000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html"], ["list"]],
  use: {
    baseURL: process.env.BASE_URL || "http://127.0.0.1:3010",
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3010",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      ...process.env,
      BLACKBOARD_LOGIN_WAIT_TIMEOUT_MS: process.env.BLACKBOARD_LOGIN_WAIT_TIMEOUT_MS ?? "12000"
    }
  }
});
