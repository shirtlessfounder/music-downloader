# Bootstrap App Shell Design

## Context

Issue `#3` is the repository bootstrap task for the `music-downloader` product. The repo currently contains only product docs, so this change needs to establish the application baseline that later playlist ingestion, matching, job, and artifact work can extend.

## Goals

- Create a working Next.js App Router application in the repo root.
- Establish shared shell primitives that match the approved local-tool visual language:
  - warm gray page background
  - dark panel surfaces
  - compact spacing
  - dense form and table controls
  - reusable file and status badges
- Add an honest landing page with one playlist URL field, one submit button, and a recent-runs placeholder section.
- Add local Vitest and Playwright smoke coverage.
- Document install, run, and test commands in the README.

## Approach

Use a lean manual scaffold instead of a generated app template. That keeps the repo focused on the exact runtime, test, and styling files required by the issue while still following the approved stack: Next.js App Router, React, TypeScript, Vitest, Playwright, and lint/build scripts.

The UI baseline will be built from repo-local components and CSS variables rather than a component library. The first reusable primitives will be:

- a shell wrapper for the main page structure
- dark panel containers for grouped content
- status badges for run state
- file badges for expected outputs

## User Experience

The landing page should feel like a dense local operator tool, not a marketing page. It will open with a compact masthead, a job-intake panel containing the playlist URL input and submit button, and a recent-runs panel that clearly states the queue and artifact generation flows are still placeholders at this stage.

The page must remain honest about scope: no fake job submission, no simulated progress, and no unauthorized-source language.

## Testing

- Vitest smoke coverage will render the landing screen component and assert the URL field, submit button, placeholder copy, and reusable badges.
- Playwright smoke coverage will load `/` and confirm the main app shell renders in a browser session.
- Build and lint scripts must pass locally before handoff.
