# music-downloader

Local web app for playlist acquisition, optimized for DJ and electronic workflows.

## Product Scope

- Local-only operator workflow
- Provider-based acquisition only
- No stream-ripping, bypass, or unsupported acquisition behavior
- Current state: live Spotify and SoundCloud playlist intake, automatic
  provider matching/acquisition, packaged run artifacts, and Beatport paid-review
  queueing

## Requirements

- Node.js `24.x` or newer
- npm `11.x` or newer

## Setup

```bash
npm install
```

## Live Credentials And Browser Sessions

The normal local operator runtime (`npm run dev`) uses live playlist intake and
therefore expects authorized Spotify and SoundCloud API credentials plus
persisted authenticated browser sessions for:

- SoundCloud Direct Downloads
- Bandcamp
- Beatport

To enable authorized Spotify playlist ingestion through the Spotify Web API
client-credentials flow, set these Spotify env vars before starting the app:

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
set these env vars before starting the app:

```bash
export SOUNDCLOUD_CLIENT_ID=your-soundcloud-client-id
export SOUNDCLOUD_CLIENT_SECRET=your-soundcloud-client-secret
```

After the app is running, open `http://127.0.0.1:3000` and use the `Live
Prerequisites` panel to launch a headed setup session for each required
provider browser profile. Complete the provider login manually in the opened
Playwright window, then return to the shell and click `Mark ready` to persist
the authenticated session metadata.

Those browser profiles are stored inside the local workspace and can be
refreshed later from the same panel if a provider session expires.

Automatic free-source order currently runs:

1. SoundCloud Direct Downloads
2. SoundCloudDL
3. Bandcamp
4. Beatport paid review queue

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

## Local Verification

`npm run test:e2e` starts the app with `MUSIC_DOWNLOADER_E2E_FIXTURES=1`, an
isolated `.e2e/runtime` workspace, and deterministic fixture-mode playlist and
provider seams. Playwright still submits playlists through `/api/runs` and the
shared live orchestrator; it does not pre-seed completed runs. The coverage
exercises:

- playlist submission through the real intake form
- completed run reports with `downloads.zip`, `manifest.json`, and `misses.txt`
- Beatport review-lane visibility for paid fallback handoff
- resumability after a persisted in-flight run is re-opened

No live Spotify or SoundCloud credentials are required for that verification
path, and the fixtures stay within the built-in provider scenarios. Use
`npm run dev` with the env vars above when you want to test live playlist
intake locally; live provider acquisition also requires the browser-session
setup flow described above.

## Notes

- The app persists runs in local SQLite and renders run-report detail pages from
  that shared store.
- End-to-end verification swaps in deterministic fixture-mode intake/provider
  seams while keeping the `/api/runs` orchestration path intact.
