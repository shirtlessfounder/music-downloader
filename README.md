# music-downloader

Local web app for authorized-source playlist acquisition, optimized for DJ and electronic workflows.

## Product Scope

- Local-only operator workflow
- Authorized-source acquisition only
- No stream-ripping, bypass, or unauthorized-source behavior
- Current state: app shell with persisted Spotify and SoundCloud playlist intake

## Requirements

- Node.js `24.x` or newer
- npm `11.x` or newer

## Setup

```bash
npm install
```

To enable authorized Spotify playlist ingestion through the Spotify Web API
client-credentials flow,
set these Spotify env vars before running the app:

```bash
export SPOTIFY_CLIENT_ID=your-spotify-client-id
export SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
```

Spotify playlist item requests default to the `US` market. Override that for
your local operator setup if needed:

```bash
export SPOTIFY_MARKET=US
```

To enable authorized SoundCloud playlist ingestion through the official API,
set these env vars before running the app:

```bash
export SOUNDCLOUD_CLIENT_ID=your-soundcloud-client-id
export SOUNDCLOUD_CLIENT_SECRET=your-soundcloud-client-secret
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

- The landing page currently provides the shared shell, form controls, and persisted recent-runs area for later tasks.
- Background jobs, provider matching, manifests, misses, and artifact packaging land in later issues.
