# music-downloader

Local web app for authorized-source playlist acquisition, optimized for DJ and electronic workflows.

## Product Scope

- Local-only operator workflow
- Authorized-source acquisition only
- No stream-ripping, bypass, or unauthorized-source behavior
- Current state: bootstrap app shell with placeholder intake and recent-run surfaces

## Requirements

- Node.js `24.x` or newer
- npm `11.x` or newer

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

Open `http://127.0.0.1:3000`.

## Commands

```bash
npm run build
npm run lint
npm run test
npm run test:e2e
```

## Notes

- The landing page currently establishes the shared shell, form controls, and placeholder recent-runs area for later tasks.
- Background jobs, provider matching, manifests, misses, and artifact packaging land in later issues.
