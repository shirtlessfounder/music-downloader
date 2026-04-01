# Spotify OAuth Playlist Intake Design

## Goal

Replace the broken Spotify client-credentials playlist intake path with a local
operator OAuth connection flow that supports both public and private Spotify
playlists from a single persisted account.

## Problem

The current Spotify intake implementation uses the Spotify client-credentials
flow and then calls playlist endpoints. That auth mode can mint valid access
tokens, but it does not authorize access to user playlist resources. In
practice, live runs fail during intake with `502` responses that wrap Spotify
`404 Resource not found` errors, even when app credentials are valid.

## Constraints

- Keep the app local-only
- Support both public and private Spotify playlists
- Support one persisted Spotify connection for the whole app
- Favor fast implementation over security hardening
- Preserve SoundCloud playlist intake as-is
- Reuse existing app patterns where possible

## Recommended Approach

Add a first-class Spotify operator connection flow to the app:

1. The home screen exposes Spotify connection status and a `Connect Spotify`
   action.
2. The app redirects the operator through Spotify Authorization Code flow.
3. The callback exchanges the code for refresh/access tokens server-side.
4. The app persists the refresh token plus a light account hint locally inside
   the app workspace.
5. Spotify playlist intake mints fresh access tokens from the persisted refresh
   token before calling playlist endpoints.

This is the smallest clean fix because it changes the auth substrate without
changing the orchestration pipeline, provider registry, run model, or artifact
packaging flow.

## Alternatives Considered

### 1. Manual token paste

Persist a manually copied access or refresh token in env or a local file.

Pros:
- Minimal implementation

Cons:
- Bad operator UX
- Tokens expire or rotate awkwardly
- Easy to misconfigure
- Does not fit the local operator dashboard model

### 2. Browser-session-based Spotify auth

Reuse the existing Playwright session-management stack for Spotify login.

Pros:
- Conceptually consistent with provider setup

Cons:
- Overbuilt for a standard OAuth code exchange
- Adds browser/session coupling where an API token store is enough
- Slower to ship

## User Experience

### Home Screen

Add a new Spotify connection panel near the live prerequisites area.

Disconnected state:
- Shows `Missing`
- Explains that Spotify connection is required for Spotify playlist intake
- Shows `Connect Spotify`

Connected state:
- Shows `Connected`
- Displays a subject hint for the authorized account when available
- Shows `Reconnect`

Pending callback state:
- The browser returns to the local app after Spotify authorization
- The home screen can show a success or failure message driven by callback
  query params or refreshed status

### Playlist Submission

If the submitted URL is a Spotify playlist and no Spotify refresh token is
persisted, the API returns a clear operator-facing error telling the user to
connect Spotify first.

If the Spotify connection exists, intake uses a refreshed user token and
proceeds normally into run creation.

## Data Model

Persist one local JSON record in the app workspace, separate from SQLite:

- `provider`: `"spotify"`
- `refreshToken`
- `scope`
- `connectedAt`
- `subjectHint`

Rationale:
- Faster than creating a new SQLite migration
- Easy to inspect and replace locally
- Keeps OAuth token state out of the run database

Suggested location:
- `.music-downloader/spotify-auth/session.json` under the workspace root

## Server Components

### Spotify Auth Service

Responsibilities:
- Build the Spotify authorization URL
- Exchange auth codes for refresh/access tokens
- Refresh access tokens from the stored refresh token
- Normalize Spotify error handling

### Spotify Auth Store

Responsibilities:
- Read/write the persisted local Spotify auth record
- Clear/replace the stored record on reconnect
- Resolve the workspace-relative storage path

### API Routes

Add routes for:
- `GET /api/operator/spotify-auth`
  - returns current connection status
- `POST /api/operator/spotify-auth/start`
  - returns or redirects to the Spotify authorize URL
- `GET /api/operator/spotify-auth/callback`
  - exchanges code, persists auth record, redirects back to `/`

## Playlist Intake Changes

Refactor Spotify intake to use user-token auth:

1. Load persisted Spotify auth state
2. Refresh access token from the stored refresh token
3. Call playlist metadata and item endpoints with the refreshed user token
4. Preserve existing playlist mapping behavior

Do not change:
- playlist URL parsing
- canonical track mapping
- run creation contract

## Scopes

Request:
- `playlist-read-private`
- `playlist-read-collaborative`

These cover private playlists plus collaborative playlists while still working
for public playlist reads.

## Error Handling

Surface explicit operator-facing errors for:
- Spotify not connected
- OAuth callback failure
- token refresh failure
- revoked or expired refresh token

If refresh fails because the session is no longer valid, the persisted auth
record should be treated as disconnected and the user should be prompted to
reconnect.

## Testing Strategy

### Unit Tests

- Spotify auth store read/write/clear
- Spotify auth service authorize URL generation
- code exchange and refresh-token exchange behavior
- Spotify intake using refreshed user-token auth
- Spotify intake failure when no local Spotify auth is present

### Route Tests

- status route returns disconnected and connected payloads
- start route returns a valid authorize URL
- callback route persists auth state and redirects home
- callback route returns a failure response when exchange fails

### UI Tests

- home screen renders disconnected Spotify card
- home screen renders connected Spotify card with subject hint
- reconnect button text appears once connected

## File Plan

Modify:
- `src/features/home/home-screen.tsx`
- `src/app/page.tsx`
- `src/features/ingestion/spotify-playlist.ts`
- `src/app/api/runs/route.test.ts`
- `src/features/ingestion/playlist-intake.test.ts`
- `README.md`

Create:
- `src/features/spotify-auth/spotify-auth-store.ts`
- `src/features/spotify-auth/spotify-auth-service.ts`
- `src/features/spotify-auth/spotify-auth-store.test.ts`
- `src/features/spotify-auth/spotify-auth-service.test.ts`
- `src/app/api/operator/spotify-auth/route.ts`
- `src/app/api/operator/spotify-auth/start/route.ts`
- `src/app/api/operator/spotify-auth/callback/route.ts`
- `src/app/api/operator/spotify-auth/route.test.ts`
- `src/app/api/operator/spotify-auth/start/route.test.ts`
- `src/app/api/operator/spotify-auth/callback/route.test.ts`

## Risks

- Spotify callback base URL handling can be fragile if it assumes a single host
- Refresh-token persistence in a local file is intentionally low-security
- This Forge checkout is older than another local clone, so implementation must
  stay consistent with this checkout's current architecture

## Success Criteria

- Operator can connect Spotify once from the home screen
- Public Spotify playlists queue successfully
- Private Spotify playlists queue successfully
- Existing SoundCloud playlist intake still behaves as before
- Existing orchestration and provider flows remain unchanged after intake
