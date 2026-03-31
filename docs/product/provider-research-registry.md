# Provider Research Registry

Reviewed on `2026-03-30`.

## Source Of Truth

- Registry path: `data/authorized-source-research-registry.json`
- This file is the machine-readable seed for later provider tasks.
- Update the registry in place by appending or editing source objects; do not replace it with a spreadsheet or a prose-only list.

## How Later Provider Tasks Should Use It

1. Read the registry before opening or implementing any provider issue.
2. Only implement sources whose `scopeDecision` is `in-scope-with-constraints` or `required-fallback`.
3. Order work by `implementationBucket`, then `priorityRank`.
4. `free-auto` sources come first and should be the only automatic acquisition wave.
5. `paid-review-queue` is reserved for Beatport and must remain the last-resort paid fallback with one aggregated review queue per run.
6. `defer` sources stay researched but unimplemented unless the product rules change.
7. Never create providers for anything covered by `orderingPolicy.disallowedApproaches`, especially stream-ripping, preview capture, DRM bypass, or unlicensed mirrors.

## Current Seed Decisions

| Source | Decision | Why |
| --- | --- | --- |
| SoundCloud Direct Downloads | `in-scope-with-constraints` | Authorized uploader-enabled downloads; useful for exact track-level free acquisitions, but only where the artist turned downloads on. |
| Bandcamp | `in-scope-with-constraints` | Artist/label-controlled direct downloads with strong format support; keep the current product limited to free or already-owned entitlements unless paid scope expands. |
| Juno Download | `defer` | Legitimate DJ store, but paid and redundant with the current Beatport-only paid fallback rule. |
| Traxsource | `defer` | Legitimate DJ store, but also paid and therefore out of the current sequence. |
| Beatport | `required-fallback` | Explicitly required by product design as the last-resort paid queue after free/direct candidates miss. |

## Extension Rules

- Preserve `officialReferences` whenever you change a source decision.
- Add new sources as new objects so later code can diff and sort them without reformatting the whole file.
- Keep `scopeRationale` concrete enough that another worker can justify why a provider is in, deferred, or excluded without reopening the original research.
