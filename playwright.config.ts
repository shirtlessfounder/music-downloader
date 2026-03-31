import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3000",
    env: {
      MUSIC_DOWNLOADER_DB_PATH: path.join(
        process.cwd(),
        ".e2e",
        "runtime",
        "data",
        "music-downloader.sqlite"
      ),
      MUSIC_DOWNLOADER_E2E_FIXTURES: "1",
      MUSIC_DOWNLOADER_WORKSPACE_ROOT: path.join(process.cwd(), ".e2e", "runtime")
    },
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
