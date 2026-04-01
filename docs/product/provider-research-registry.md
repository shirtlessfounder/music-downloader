# Provider Research Registry

Reviewed on `2026-03-31`.

## Source Of Truth

- Registry path: `data/provider-research-registry.json`
- This file is the machine-readable seed for later provider tasks.
- Update the registry in place by appending or editing source objects; do not replace it with a spreadsheet or a prose-only list.

## Normalized Fields

Every source entry must keep these fields populated so later planner and worker tasks can filter and order providers without prose parsing:

| Field | Meaning | Allowed values |
| --- | --- | --- |
| `sourceBasis` | Why the source fits the current provider flow | `uploader-enabled-download`, `rights-holder-storefront`, `purchase-entitlement` |
| `accessTier` | Whether the source is free, free-or-owned, or paid | `free`, `free-or-owned`, `paid` |
| `integrationSurface` | Whether the source can be treated as native/direct or requires browser mediation | `native-direct`, `browser-mediated` |
| `loginRequirement` | Whether credentials are needed for the intended acquisition path | `not-required`, `conditional`, `required` |
| `sessionRequirement` | Whether the workflow depends on an authenticated browser/session layer | `not-required`, `conditional`, `required` |
| `stability` | How stable the acquisition surface is for sequencing decisions | `stable`, `variable`, `fragile` |

Keep the existing narrative fields such as `scopeRationale`, `sourceRationale`, `acquisitionMode`, `automationApproach`, and `notableRisks`; the normalized fields are additive metadata for machine filtering.

## How Later Provider Tasks Should Use It

1. Read the registry before opening or implementing any provider issue.
2. Only implement sources whose `scopeDecision` is `in-scope-with-constraints` or `required-fallback`.
3. Filter on `accessTier` and `sourceBasis` first: free or free-or-owned provider flows land before paid sources, and paid expansions beyond Beatport still require a product decision.
4. Prefer `integrationSurface: native-direct` ahead of `browser-mediated` when priorities are otherwise equal.
5. Prefer `stability: stable` ahead of `variable` or `fragile` within the same tier.
6. Use `implementationBucket`, then `priorityRank`, as the final deterministic ordering after the normalized filters above.
7. `free-auto` sources come first and should be the only automatic acquisition wave.
8. `paid-review-queue` is reserved for Beatport and must remain the last-resort paid fallback with one aggregated review queue per run.
9. `defer` sources stay researched but unimplemented unless the product rules change.
10. Keep provider work aligned with the documented product scope and current provider surface.

## Current Seed Decisions

| Source | Decision | Why |
| --- | --- | --- |
| SoundCloud Direct Downloads | `in-scope-with-constraints` | Uploader-controlled direct downloads; useful for exact track-level free acquisitions, but only where the artist turned downloads on. |
| Bandcamp | `in-scope-with-constraints` | Artist/label-controlled direct downloads with strong format support; keep the current product limited to free or already-owned entitlements unless paid scope expands. |
| Juno Download | `defer` | Legitimate DJ store, but paid and redundant with the current Beatport-only paid fallback rule. |
| Traxsource | `defer` | Legitimate DJ store, but also paid and therefore out of the current sequence. |
| Beatport | `required-fallback` | Explicitly required by product design as the last-resort paid queue after free/direct candidates miss. |

## Extension Rules

- Preserve `officialReferences` whenever you change a source decision.
- Keep every normalized metadata field populated when you add or edit a source entry.
- Add new sources as new objects so later code can diff and sort them without reformatting the whole file.
- Keep `scopeRationale` concrete enough that another worker can justify why a provider is in, deferred, or excluded without reopening the original research.
