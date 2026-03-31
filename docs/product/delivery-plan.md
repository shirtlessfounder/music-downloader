# Music Downloader Whole-Scope Delivery Plan

Use this as the repo-local execution brief.

## Stack

- Next.js App Router
- React
- TypeScript
- SQLite
- Playwright
- Vitest

## Whole-Scope Workstreams

1. repository foundation and app shell
2. persistent run/job model
3. Spotify and SoundCloud playlist ingestion
4. canonical track model and normalization
5. provider contract and registry
6. source research registry and prioritization
7. matching engine and rejection rules
8. managed browser/session service
9. zip, miss list, manifest, and run report outputs
10. first free-source provider wave
11. Beatport paid queue and approval flow
12. end-to-end hardening and verification

## Delivery Rules

- full approved scope is in play
- do not narrow to a single subproblem
- still break implementation into planner-sized and worker-sized tasks
- direct/native and stable sources should land before brittle browser-only integrations when sequencing work
- paid fallback remains in scope, but after free-source flows and queueing primitives exist

## Authorized-Source Research Registry

- Source of truth: `data/authorized-source-research-registry.json`
- Usage guide: `docs/product/provider-research-registry.md`
- Later provider tasks should only implement entries marked `in-scope-with-constraints` or `required-fallback`
- Keep `free-auto` entries ahead of any paid flow, and keep Beatport as the last-resort paid fallback queue
