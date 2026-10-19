import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: "list",
  outputDir: "../../.artifacts/p9-browser",
  use: {
    baseURL: process.env.SENTINEL_WEB_TEST_URL ?? "http://127.0.0.1:5173",
    browserName: "chromium",
    channel:
      process.env.SENTINEL_WEB_BROWSER_CHANNEL ??
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
