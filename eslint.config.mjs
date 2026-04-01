import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  globalIgnores([
    ".e2e/**",
    ".music-downloader/**",
    ".next/**",
    ".scratch-worker-01/**",
    ".worktrees/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts"
  ])
]);
