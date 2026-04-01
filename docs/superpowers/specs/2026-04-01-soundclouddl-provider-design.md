# SoundCloudDL Backup Provider Design

## Goal

Add a free-source backup lane that can acquire tracks through [soundclouddl.cc](https://soundclouddl.cc/) for both:

- Spotify playlist inputs
- SoundCloud playlist inputs

This provider should act as a high-priority free fallback after stronger free sources such as Hypeddit/Reddit-style lanes, while still respecting the existing product rules:

- prefer `Extended Mix`
- then `Original Mix`
- otherwise accept only a high-confidence long fallback
- request `MP3` only for this provider

## Constraints

- use only the public `soundclouddl.cc` website surface
- no undocumented dependency on other sites or providers in this design
- optimize for quick ship over low-maintenance purity
- keep the brittle site dependency isolated behind one provider boundary
- do not treat `soundclouddl.cc` as the canonical track search source

## Observed Source Shape

From the public site:

- user enters a SoundCloud track or playlist URL
- site supports `MP3` and `M4A`
- site has a playlist toggle
- site uses `ALTCHA`
- site posts conversion requests through a browser form flow

Implication:

- v1 should be browser-backed, not a direct hidden-request API client
- v1 should process per track, not rely on the site playlist-batch mode

## Provider Role

This lane is a `secondary primary free source`:

1. run stronger free sources first
2. if unresolved, try to acquire via SoundCloud
3. if a SoundCloud candidate is found with high confidence, use `soundclouddl.cc` to convert/download MP3
4. otherwise mark miss or continue to later paid fallback

## Architecture

Add three modules:

### 1. `SoundCloudCandidateResolver`

Purpose:

- obtain plausible SoundCloud candidate URLs for one canonical track

Search order:

1. `artist + title + extended mix`
2. `artist + title + original mix`
3. `artist + title`

Output:

- candidate list with source URL and raw metadata needed for scoring

### 2. `SoundCloudCandidateScorer`

Purpose:

- rank candidates and decide whether one is safe to auto-pick

Signals:

- normalized artist match
- normalized title match
- positive bonus for `Extended Mix`
- smaller bonus for `Original Mix`
- penalty for remix/live/radio/edit/noisy variants unless explicitly requested
- duration similarity to canonical track
- hard acceptance for long non-extended fallback only when confidence is high and duration is above the existing threshold

Decision:

- auto-pick only when confidence is high
- no manual queue in v1
- ambiguous or weak results become miss

### 3. `SoundCloudDlBrowserProvider`

Purpose:

- given one chosen SoundCloud track URL, drive `soundclouddl.cc` in a browser session and retrieve MP3

Behavior:

- navigate to `soundclouddl.cc`
- submit the chosen SoundCloud URL
- request `MP3`
- wait for conversion completion
- download the produced artifact
- capture provider telemetry and artifact metadata

Non-goals for v1:

- direct calls to undocumented `soundclouddl.cc` endpoints
- batch playlist conversion through the site UI
- `M4A` fallback

## End-to-End Flow

For each canonical track:

1. previous free providers run first
2. if unresolved, call `SoundCloudCandidateResolver`
3. score candidates with `SoundCloudCandidateScorer`
4. if no high-confidence candidate, mark unresolved for later fallback
5. if matched, pass chosen SoundCloud URL to `SoundCloudDlBrowserProvider`
6. if MP3 download succeeds, attach artifact to the run output
7. record provenance in manifest/run report

## Matching Policy

The existing product quality rules remain the governing policy.

For this provider specifically:

- `Extended Mix` is the preferred target
- then `Original Mix`
- otherwise only accept a non-extended fallback when:
  - confidence is high
  - duration is longer than 4 minutes
- otherwise mark miss

This means Spotify tracks can resolve to SoundCloud extended versions when available.

## Data Model Additions

Each acquired track should record:

- `provider = soundclouddl`
- matched SoundCloud URL
- search query variant used
- candidate confidence score
- whether the selected candidate was `extended`, `original`, or `fallback`
- output format `mp3`
- browser/download run metadata needed for retry/debugging

## Failure Model

Classify failures into:

- `no_candidate`
  - no high-confidence SoundCloud match
- `provider_retryable`
  - browser/session/captcha/conversion transient failure
- `provider_terminal`
  - repeated failure or invalid artifact

Retry behavior:

- retry browser/provider failures with bounded attempts
- do not loop forever on ambiguous matching

## Testing

Coverage needed:

- query generation order
- candidate scoring for:
  - exact extended match
  - original mix fallback
  - long non-extended fallback
  - ambiguous remix/live/radio-edit rejection
- provider contract tests around the browser workflow
- run-level integration tests proving:
  - Spotify track can resolve to SoundCloud and download through `soundclouddl`
  - SoundCloud playlist tracks can use the same provider lane
  - manifest/report include source provenance

## Rollout

Phase 1:

- implement as an experimental provider behind the modular provider registry
- enable for both Spotify and SoundCloud playlist tracks
- run after stronger free sources, before paid fallback

Phase 2, only if needed:

- harden session reuse and throughput
- consider a faster path if the public website contract proves stable enough

## Recommendation

Implement `soundclouddl.cc` as a browser-backed provider with explicit SoundCloud candidate matching.

This is the fastest path that:

- supports both playlist types
- preserves the existing mix-quality policy
- avoids locking the system to undocumented direct request shapes
- keeps the provider replaceable later
