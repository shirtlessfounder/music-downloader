# Spotify OAuth Playlist Intake Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace broken Spotify client-credentials playlist intake with a local one-account OAuth connection flow that supports public and private playlists.

**Architecture:** Add a small Spotify auth subsystem that persists one local refresh token in the workspace, exposes operator auth routes, and refreshes access tokens server-side for playlist intake. Keep the existing run orchestration, provider matching, and artifact packaging flow unchanged after intake succeeds.

**Tech Stack:** Next.js App Router, React 19, TypeScript 6, Vitest 4, Node filesystem APIs, Spotify Web API Authorization Code flow

---

## Chunk 1: Spotify Auth Substrate

### Task 1: Add the Spotify auth store and service with red-green tests

**Files:**
- Create: `src/features/spotify-auth/spotify-auth-store.ts`
- Create: `src/features/spotify-auth/spotify-auth-service.ts`
- Create: `src/features/spotify-auth/spotify-auth-store.test.ts`
- Create: `src/features/spotify-auth/spotify-auth-service.test.ts`

- [ ] **Step 1: Write a failing store test for read/write/clear behavior**
- [ ] **Step 2: Run `npm run test:unit -- src/features/spotify-auth/spotify-auth-store.test.ts` and confirm it fails because the store does not exist yet**
- [ ] **Step 3: Implement the minimal JSON-backed workspace store for one Spotify auth record**
- [ ] **Step 4: Re-run `npm run test:unit -- src/features/spotify-auth/spotify-auth-store.test.ts` and confirm it passes**
- [ ] **Step 5: Write a failing service test for authorize URL generation, code exchange, and refresh-token exchange**
- [ ] **Step 6: Run `npm run test:unit -- src/features/spotify-auth/spotify-auth-service.test.ts` and confirm it fails because the service does not exist yet**
- [ ] **Step 7: Implement the minimal Spotify auth service with helper methods for authorize URL, code exchange, token refresh, and current-user lookup**
- [ ] **Step 8: Re-run `npm run test:unit -- src/features/spotify-auth/spotify-auth-service.test.ts` and confirm it passes**

## Chunk 2: Intake and API Routes

### Task 2: Swap Spotify intake onto refresh-token auth

**Files:**
- Modify: `src/features/ingestion/spotify-playlist.ts`
- Modify: `src/features/ingestion/spotify-playlist.test.ts`
- Modify: `src/features/ingestion/playlist-intake.test.ts`
- Modify: `src/app/api/runs/route.test.ts`

- [ ] **Step 1: Add a failing Spotify intake test that requires a persisted Spotify auth record instead of client credentials**
- [ ] **Step 2: Run `npm run test:unit -- src/features/ingestion/spotify-playlist.test.ts src/features/ingestion/playlist-intake.test.ts src/app/api/runs/route.test.ts` and confirm the new expectation fails**
- [ ] **Step 3: Refactor Spotify intake to load the persisted Spotify auth record, refresh an access token, and call playlist endpoints with the refreshed user token**
- [ ] **Step 4: Replace the old “missing Spotify client credentials” assertions with “connect Spotify first” assertions where appropriate**
- [ ] **Step 5: Re-run `npm run test:unit -- src/features/ingestion/spotify-playlist.test.ts src/features/ingestion/playlist-intake.test.ts src/app/api/runs/route.test.ts` and confirm they pass**

### Task 3: Add operator Spotify auth routes

**Files:**
- Create: `src/app/api/operator/spotify-auth/route.ts`
- Create: `src/app/api/operator/spotify-auth/start/route.ts`
- Create: `src/app/api/operator/spotify-auth/callback/route.ts`
- Create: `src/app/api/operator/spotify-auth/route.test.ts`
- Create: `src/app/api/operator/spotify-auth/start/route.test.ts`
- Create: `src/app/api/operator/spotify-auth/callback/route.test.ts`

- [ ] **Step 1: Write failing route tests for disconnected status, connected status, start URL generation, successful callback persistence, and callback failure handling**
- [ ] **Step 2: Run `npm run test:unit -- src/app/api/operator/spotify-auth/route.test.ts src/app/api/operator/spotify-auth/start/route.test.ts src/app/api/operator/spotify-auth/callback/route.test.ts` and confirm they fail before implementation**
- [ ] **Step 3: Implement the three Spotify auth routes with clear operator-facing JSON or redirect behavior**
- [ ] **Step 4: Re-run `npm run test:unit -- src/app/api/operator/spotify-auth/route.test.ts src/app/api/operator/spotify-auth/start/route.test.ts src/app/api/operator/spotify-auth/callback/route.test.ts` and confirm they pass**

## Chunk 3: Home Screen and Docs

### Task 4: Expose Spotify connection UX on the home screen

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/features/home/home-screen.tsx`
- Modify: `src/features/home/home-screen.test.tsx`

- [ ] **Step 1: Add a failing home-screen test for disconnected Spotify auth state and a failing test for connected state with subject hint**
- [ ] **Step 2: Run `npm run test:unit -- src/features/home/home-screen.test.tsx` and confirm the new assertions fail**
- [ ] **Step 3: Update the page loader and home screen to fetch/render Spotify auth status, show connect/reconnect controls, and bounce through the start route**
- [ ] **Step 4: Re-run `npm run test:unit -- src/features/home/home-screen.test.tsx` and confirm it passes**

### Task 5: Document and verify the end-to-end behavior

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README to document Spotify app setup, callback URL, `.env.local` usage, and the new in-app Spotify connect step**
- [ ] **Step 2: Run `npm run lint`**
- [ ] **Step 3: Run `npm run test`**
- [ ] **Step 4: Run `npm run build`**
- [ ] **Step 5: Report any remaining manual live verification required for the OAuth callback and private-playlist path**
