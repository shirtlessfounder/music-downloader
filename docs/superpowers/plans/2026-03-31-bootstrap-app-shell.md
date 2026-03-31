# Bootstrap App Shell Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the repo into a working Next.js App Router app with the first shared shell primitives, smoke tests, and local developer scripts.

**Architecture:** Use a manual Next.js scaffold with `src/app` for routing, `src/components` for reusable shell primitives, and repo-local CSS variables for the shared visual baseline. Add Vitest for component smoke tests and Playwright for browser smoke tests, then wire the scripts and docs around that baseline.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, ESLint 9 with `eslint-config-next`, Vitest 4, Testing Library, Playwright 1.58

---

## Chunk 1: Tooling and Red Tests

### Task 1: Create the runtime and test configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `playwright.config.ts`

- [ ] **Step 1: Add the package and config files without production UI code**
- [ ] **Step 2: Install dependencies and generate the lockfile**
- [ ] **Step 3: Add a failing Vitest smoke test for the landing screen**
- [ ] **Step 4: Run the Vitest smoke test and confirm it fails because the screen is not implemented yet**
- [ ] **Step 5: Add a failing Playwright smoke test for `/`**
- [ ] **Step 6: Run the Playwright smoke test and confirm it fails because the page shell is not implemented yet**

## Chunk 2: App Shell Green Phase

### Task 2: Implement the first shared shell primitives and landing page

**Files:**
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `src/components/ui/panel.tsx`
- Create: `src/components/ui/status-badge.tsx`
- Create: `src/components/ui/file-badge.tsx`
- Create: `src/features/home/home-screen.tsx`

- [ ] **Step 1: Implement the minimal shell and landing page needed to satisfy the Vitest smoke test**
- [ ] **Step 2: Run the Vitest smoke test and confirm it passes**
- [ ] **Step 3: Wire the page through the App Router entrypoint**
- [ ] **Step 4: Run the Playwright smoke test and confirm it passes**
- [ ] **Step 5: Refine the CSS variables and layout details until the shell matches the approved visual baseline without adding fake functionality**

## Chunk 3: Finish and Verify

### Task 3: Document and verify the bootstrap

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README with setup, run, lint, unit test, and e2e test commands**
- [ ] **Step 2: Note the authorized-source-only product scope in the README**
- [ ] **Step 3: Run `npm run lint`**
- [ ] **Step 4: Run `npm run test`**
- [ ] **Step 5: Run `npm run build`**
- [ ] **Step 6: Run `npm run test:e2e`**
- [ ] **Step 7: Commit the completed issue work**
