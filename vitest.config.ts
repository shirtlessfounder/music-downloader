import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const browserBackedTestFiles = [
  "src/features/providers/beatport.test.ts",
  "src/features/providers/bandcamp.test.ts",
  "src/features/providers/soundclouddl.test.ts",
  "src/features/providers/soundcloud-direct-downloads.test.ts",
  "src/features/browser/browser-session-service.test.ts",
  "src/app/api/runs/[runId]/review-queue/[reviewId]/route.test.ts"
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  test: {
    css: true,
    environment: "jsdom",
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          exclude: browserBackedTestFiles,
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          name: "default"
        }
      },
      {
        extends: true,
        test: {
          include: browserBackedTestFiles,
          name: "browser-backed",
          sequence: {
            groupOrder: 1
          }
        }
      }
    ],
    setupFiles: "./vitest.setup.ts"
  }
});
