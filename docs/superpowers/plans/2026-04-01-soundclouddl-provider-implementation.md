# SoundCloudDL Backup Provider Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a browser-backed `soundclouddl` free-source provider that can acquire MP3s from matched SoundCloud tracks for both Spotify and SoundCloud playlist flows.

**Architecture:** Bootstrap the minimal app/tooling needed for the provider subsystem, then implement the feature in isolated slices: canonical track/provider contracts, SoundCloud query generation and scoring, browser-backed SoundCloud candidate search, browser-backed `soundclouddl` download automation, and orchestration/provenance integration. Keep all brittle website logic behind small Playwright page objects and provider interfaces so later source swaps do not leak into the core acquisition planner.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Playwright, SQLite

---

## File Map

### Create

- `package.json`
- `tsconfig.json`
- `next.config.mjs`
- `playwright.config.ts`
- `vitest.config.ts`
- `app/layout.tsx`
- `app/page.tsx`
- `src/core/catalog/trackTypes.ts`
- `src/core/providers/providerTypes.ts`
- `src/core/providers/freeSourceOrder.ts`
- `src/core/providers/providerRegistry.ts`
- `src/core/providers/soundcloud/searchQueryBuilder.ts`
- `src/core/providers/soundcloud/candidateTypes.ts`
- `src/core/providers/soundcloud/candidateScorer.ts`
- `src/core/providers/soundcloud/searchPage.ts`
- `src/core/providers/soundcloud/searchBrowserClient.ts`
- `src/core/providers/soundcloud/candidateResolver.ts`
- `src/core/providers/soundclouddl/page.ts`
- `src/core/providers/soundclouddl/provider.ts`
- `src/core/runs/provenanceTypes.ts`
- `src/core/runs/acquisitionPlanner.ts`
- `tests/unit/appShell.test.ts`
- `tests/unit/providers/freeSourceOrder.test.ts`
- `tests/unit/providers/soundcloud/searchQueryBuilder.test.ts`
- `tests/unit/providers/soundcloud/candidateScorer.test.ts`
- `tests/unit/providers/soundcloud/candidateResolver.test.ts`
- `tests/unit/providers/soundclouddl/provider.test.ts`
- `tests/unit/runs/acquisitionPlanner.test.ts`
- `tests/e2e/app.home.spec.ts`
- `tests/fixtures/soundcloud-search-results.html`
- `tests/fixtures/soundclouddl-converter.html`

### Modify

- `README.md`

### Notes

- Keep website-specific automation split into:
  - `src/core/providers/soundcloud/searchPage.ts`
  - `src/core/providers/soundclouddl/page.ts`
- Do not combine matching logic with browser logic.
- Do not add paid-source or manual-review logic in this plan.

## Chunk 1: Bootstrap The Minimal App And Provider Contracts

### Task 1: Scaffold the local app/tooling so provider work can be tested

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `playwright.config.ts`
- Create: `vitest.config.ts`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `tests/unit/appShell.test.ts`
- Create: `tests/e2e/app.home.spec.ts`

- [ ] **Step 1: Write the failing unit test for the app shell**

```ts
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import HomePage from '../../../app/page';

describe('HomePage', () => {
  it('renders the local acquisition app heading', () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain('music-downloader');
    expect(html).toContain('SoundCloudDL backup provider');
  });
});
```

- [ ] **Step 2: Run the unit test to verify RED**

Run:
```bash
npm test -- tests/unit/appShell.test.ts
```

Expected: FAIL because the app/tooling files do not exist yet

- [ ] **Step 3: Add the minimal package/tooling/app shell**

Add:
- `package.json` with scripts:
  - `dev`
  - `build`
  - `test`
  - `test:e2e`
- Next/Vitest/Playwright config files
- `app/layout.tsx`
- `app/page.tsx` with a minimal heading and provider-scaffold copy

- [ ] **Step 4: Add the minimal browser smoke test**

```ts
import { test, expect } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('music-downloader')).toBeVisible();
  await expect(page.getByText('SoundCloudDL backup provider')).toBeVisible();
});
```

- [ ] **Step 5: Run the focused verification**

Run:
```bash
npm test -- tests/unit/appShell.test.ts
npm run build
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json next.config.mjs playwright.config.ts vitest.config.ts app/layout.tsx app/page.tsx tests/unit/appShell.test.ts tests/e2e/app.home.spec.ts
git commit -m "feat: bootstrap provider app shell"
```

### Task 2: Add canonical track and provider contracts

**Files:**
- Create: `src/core/catalog/trackTypes.ts`
- Create: `src/core/providers/providerTypes.ts`
- Create: `src/core/providers/freeSourceOrder.ts`
- Create: `src/core/providers/providerRegistry.ts`
- Create: `tests/unit/providers/freeSourceOrder.test.ts`

- [ ] **Step 1: Write the failing provider ordering test**

```ts
import { describe, expect, it } from 'vitest';
import { buildFreeSourceOrder } from '../../../src/core/providers/freeSourceOrder';

describe('buildFreeSourceOrder', () => {
  it('places soundclouddl after stronger free sources and before paid fallback', () => {
    expect(buildFreeSourceOrder()).toEqual([
      'hypeddit',
      'reddit',
      'soundclouddl',
      'beatport'
    ]);
  });
});
```

- [ ] **Step 2: Run the unit test to verify RED**

Run:
```bash
npm test -- tests/unit/providers/freeSourceOrder.test.ts
```

Expected: FAIL because the provider contract files do not exist yet

- [ ] **Step 3: Implement the minimal domain contracts**

Add:
- `TrackIdentity`, `CanonicalTrack`, and mix-preference fields in `src/core/catalog/trackTypes.ts`
- provider IDs and provider result contracts in `src/core/providers/providerTypes.ts`
- ordered free-source list in `src/core/providers/freeSourceOrder.ts`
- small registry helper in `src/core/providers/providerRegistry.ts`

- [ ] **Step 4: Re-run the focused verification**

Run:
```bash
npm test -- tests/unit/providers/freeSourceOrder.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/catalog/trackTypes.ts src/core/providers/providerTypes.ts src/core/providers/freeSourceOrder.ts src/core/providers/providerRegistry.ts tests/unit/providers/freeSourceOrder.test.ts
git commit -m "feat: add provider domain contracts"
```

## Chunk 2: Build SoundCloud Matching Primitives

### Task 3: Generate SoundCloud search queries in the approved order

**Files:**
- Create: `src/core/providers/soundcloud/searchQueryBuilder.ts`
- Create: `tests/unit/providers/soundcloud/searchQueryBuilder.test.ts`

- [ ] **Step 1: Write the failing query-order tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildSoundCloudSearchQueries } from '../../../../src/core/providers/soundcloud/searchQueryBuilder';

describe('buildSoundCloudSearchQueries', () => {
  it('tries extended, then original, then plain title', () => {
    const queries = buildSoundCloudSearchQueries({
      artist: 'Artist',
      title: 'Track'
    });

    expect(queries).toEqual([
      'Artist Track Extended Mix',
      'Artist Track Original Mix',
      'Artist Track'
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:
```bash
npm test -- tests/unit/providers/soundcloud/searchQueryBuilder.test.ts
```

Expected: FAIL because the query builder does not exist yet

- [ ] **Step 3: Implement the query builder**

Implement a pure helper that:
- normalizes whitespace
- preserves artist/title order
- emits exactly the three approved query variants

- [ ] **Step 4: Re-run the test to verify GREEN**

Run:
```bash
npm test -- tests/unit/providers/soundcloud/searchQueryBuilder.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/providers/soundcloud/searchQueryBuilder.ts tests/unit/providers/soundcloud/searchQueryBuilder.test.ts
git commit -m "feat: add soundcloud query builder"
```

### Task 4: Score SoundCloud candidates against the existing mix policy

**Files:**
- Create: `src/core/providers/soundcloud/candidateTypes.ts`
- Create: `src/core/providers/soundcloud/candidateScorer.ts`
- Create: `tests/unit/providers/soundcloud/candidateScorer.test.ts`

- [ ] **Step 1: Write the failing scorer tests**

Cover:
- exact `Extended Mix` wins
- `Original Mix` wins when no extended candidate exists
- long non-extended fallback is allowed only at high confidence
- remix/live/radio-edit noise is rejected

- [ ] **Step 2: Run the test to verify RED**

Run:
```bash
npm test -- tests/unit/providers/soundcloud/candidateScorer.test.ts
```

Expected: FAIL because the scorer does not exist yet

- [ ] **Step 3: Implement the scorer**

Implement:
- normalized artist/title matching
- mix-label bonuses
- noise penalties for remix/live/radio/edit variants
- duration-aware long fallback acceptance rule
- `pickBestCandidate(...)` returning either one accepted candidate or `null`

- [ ] **Step 4: Re-run the test to verify GREEN**

Run:
```bash
npm test -- tests/unit/providers/soundcloud/candidateScorer.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/providers/soundcloud/candidateTypes.ts src/core/providers/soundcloud/candidateScorer.ts tests/unit/providers/soundcloud/candidateScorer.test.ts
git commit -m "feat: add soundcloud candidate scoring"
```

## Chunk 3: Add Browser-Backed SoundCloud Resolution

### Task 5: Implement the SoundCloud search browser client behind a page object

**Files:**
- Create: `src/core/providers/soundcloud/searchPage.ts`
- Create: `src/core/providers/soundcloud/searchBrowserClient.ts`
- Create: `tests/fixtures/soundcloud-search-results.html`
- Create: `tests/unit/providers/soundcloud/candidateResolver.test.ts`
- Create: `src/core/providers/soundcloud/candidateResolver.ts`

- [ ] **Step 1: Write the failing resolver test with a fake search client**

```ts
import { describe, expect, it } from 'vitest';
import { resolveSoundCloudCandidate } from '../../../../src/core/providers/soundcloud/candidateResolver';

describe('resolveSoundCloudCandidate', () => {
  it('uses query order plus scorer output to choose one high-confidence candidate', async () => {
    const result = await resolveSoundCloudCandidate(/* fake search client */);
    expect(result?.selected.url).toContain('soundcloud.com/');
    expect(result?.queryUsed).toContain('Extended Mix');
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:
```bash
npm test -- tests/unit/providers/soundcloud/candidateResolver.test.ts
```

Expected: FAIL because the resolver does not exist yet

- [ ] **Step 3: Implement the resolver contract first**

Implement:
- a `SoundCloudSearchClient` interface
- `candidateResolver.ts` that:
  - builds query variants
  - asks the client for candidates per query
  - passes candidates to the scorer
  - returns `{ selected, queryUsed, confidence } | null`

- [ ] **Step 4: Add the browser-backed page object and client**

Implement:
- `searchPage.ts` as the only file that knows page selectors/navigation
- `searchBrowserClient.ts` as a thin adapter returning normalized candidates

Keep page parsing isolated so selector churn does not hit the resolver logic.

- [ ] **Step 5: Re-run the focused verification**

Run:
```bash
npm test -- tests/unit/providers/soundcloud/candidateResolver.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/providers/soundcloud/searchPage.ts src/core/providers/soundcloud/searchBrowserClient.ts src/core/providers/soundcloud/candidateResolver.ts tests/fixtures/soundcloud-search-results.html tests/unit/providers/soundcloud/candidateResolver.test.ts
git commit -m "feat: add soundcloud candidate resolver"
```

## Chunk 4: Add Browser-Backed SoundCloudDL Downloading

### Task 6: Implement the `soundclouddl` page object and provider contract

**Files:**
- Create: `src/core/providers/soundclouddl/page.ts`
- Create: `src/core/providers/soundclouddl/provider.ts`
- Create: `tests/fixtures/soundclouddl-converter.html`
- Create: `tests/unit/providers/soundclouddl/provider.test.ts`

- [ ] **Step 1: Write the failing provider tests**

Cover:
- submits the chosen SoundCloud URL
- requests `MP3`
- returns provider provenance on success
- classifies browser/conversion failures as retryable vs terminal

- [ ] **Step 2: Run the test to verify RED**

Run:
```bash
npm test -- tests/unit/providers/soundclouddl/provider.test.ts
```

Expected: FAIL because the provider files do not exist yet

- [ ] **Step 3: Implement the provider page object**

`page.ts` should own:
- navigate
- fill URL
- force/select MP3
- submit conversion
- wait for download readiness
- capture final download href / metadata

- [ ] **Step 4: Implement the provider adapter**

`provider.ts` should:
- accept one chosen SoundCloud URL
- call the page object
- return a normalized provider result with:
  - `provider = soundclouddl`
  - `format = mp3`
  - matched SoundCloud URL
  - retry classification

- [ ] **Step 5: Re-run the focused verification**

Run:
```bash
npm test -- tests/unit/providers/soundclouddl/provider.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/providers/soundclouddl/page.ts src/core/providers/soundclouddl/provider.ts tests/fixtures/soundclouddl-converter.html tests/unit/providers/soundclouddl/provider.test.ts
git commit -m "feat: add soundclouddl browser provider"
```

## Chunk 5: Integrate The Provider Into Acquisition Planning

### Task 7: Add acquisition orchestration and manifest provenance fields

**Files:**
- Create: `src/core/runs/provenanceTypes.ts`
- Create: `src/core/runs/acquisitionPlanner.ts`
- Create: `tests/unit/runs/acquisitionPlanner.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing planner test**

Cover one track flowing through:
- higher-priority free providers fail
- SoundCloud resolver finds a candidate
- `soundclouddl` downloads MP3
- planner records provenance fields for manifest/report use

- [ ] **Step 2: Run the test to verify RED**

Run:
```bash
npm test -- tests/unit/runs/acquisitionPlanner.test.ts
```

Expected: FAIL because the planner/provenance files do not exist yet

- [ ] **Step 3: Implement the planner**

Implement:
- provider ordering from `freeSourceOrder.ts`
- call chain:
  - upstream free providers
  - SoundCloud candidate resolver
  - `soundclouddl` provider
- provenance fields:
  - provider id
  - matched SoundCloud URL
  - query used
  - confidence
  - selected mix class

- [ ] **Step 4: Add README operator notes**

Document:
- local dev commands
- why `soundclouddl` is browser-backed
- that it is a fallback after stronger free sources

- [ ] **Step 5: Re-run the targeted verification**

Run:
```bash
npm test -- tests/unit/runs/acquisitionPlanner.test.ts tests/unit/providers/soundcloud/searchQueryBuilder.test.ts tests/unit/providers/soundcloud/candidateScorer.test.ts tests/unit/providers/soundcloud/candidateResolver.test.ts tests/unit/providers/soundclouddl/provider.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/runs/provenanceTypes.ts src/core/runs/acquisitionPlanner.ts tests/unit/runs/acquisitionPlanner.test.ts README.md
git commit -m "feat: integrate soundclouddl acquisition flow"
```

## Chunk 6: End-To-End Verification

### Task 8: Prove the end-to-end provider workflow on the local app

**Files:**
- Modify as needed: `tests/e2e/app.home.spec.ts`
- Reuse: `tests/fixtures/soundcloud-search-results.html`
- Reuse: `tests/fixtures/soundclouddl-converter.html`

- [ ] **Step 1: Extend the E2E test to cover the provider happy path**

Cover:
- a canonical track is submitted to the planner
- SoundCloud search fixture returns an extended match
- `soundclouddl` fixture returns a download-ready MP3
- final result contains provenance and `provider = soundclouddl`

- [ ] **Step 2: Run the end-to-end test to verify RED**

Run:
```bash
npm run test:e2e -- tests/e2e/app.home.spec.ts
```

Expected: FAIL until the orchestration wiring is complete

- [ ] **Step 3: Make the minimum wiring changes to pass**

Only add the smallest glue needed for the browser-driven happy path to be exercised through the local app surface.

- [ ] **Step 4: Run the full verification gate**

Run:
```bash
npm test
npm run test:e2e -- tests/e2e/app.home.spec.ts
npm run build
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app src tests
git commit -m "test: verify soundclouddl provider end to end"
```
