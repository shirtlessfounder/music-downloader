## Summary

Deliver the full approved `music-downloader` product as a local web app for DJ/electronic playlist acquisition.

The user should be able to paste one Spotify playlist URL or SoundCloud playlist URL and receive:

- `downloads.zip`
- `misses.txt`
- `manifest.json`
- a run report page

## Source Of Truth

Read these repo files first:

- `docs/product/design.md`
- `docs/product/delivery-plan.md`

## Hard Requirements

- authorized download sources only
- optimize for DJ/electronic sources first
- provider research is in scope
- modular provider architecture
- free sources run automatically
- Beatport is the last-resort paid fallback
- paid Beatport flow must be one aggregated approval queue, not per-track checkout
- prefer `Extended Mix`
- then prefer `Original Mix`
- if no exact preferred mix exists, accept a high-confidence non-extended version only when it is longer than 4 minutes
- otherwise mark as miss
- prefer MP3
- accept WAV when MP3 is unavailable
- local web app with resumable background jobs

## Delivery Expectations

- decompose the full scope into worker-sized issues
- keep issues concrete and verifiable
- prioritize the highest-leverage architecture and provider primitives first
- keep the whole approved scope in play; do not silently narrow it to a small MVP without explaining why

## Suggested Decomposition Areas

- app shell and repo bootstrap
- run/job persistence
- playlist ingestion
- canonical track modeling
- provider registry
- provider research registry
- matching engine
- browser/session management
- outputs and report page
- first provider wave
- Beatport queue and approval flow
- end-to-end verification

## Subtasks

- [ ] planner decomposition
