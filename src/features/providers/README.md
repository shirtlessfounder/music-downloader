# Provider Contract

This module owns the shared provider boundary for acquisition sources.

## Rules

- Put provider-specific selectors, browser flows, and storefront behavior in the provider implementation, not in the shared registry.
- Copy `priorityRank`, source basis, and the free-vs-review split from `data/provider-research-registry.json`.
- Keep automatic providers in the `free-auto` bucket and keep Beatport-style paid work in `paid-review-queue`.

## Building A Provider

Use the helper that matches the provider mode:

```ts
const bandcamp = defineAutomaticProvider({
  id: "bandcamp",
  displayName: "Bandcamp",
  sourceBasis: "rights-holder-storefront",
  priceTier: "free-or-owned",
  priorityRank: 20,
  supportedFormats: ["mp3", "wav", "flac"],
  search: async ({ track }) => {
    // provider-specific lookup
  },
  acquire: async ({ candidate, track }) => {
    // provider-specific download flow
  }
});

const beatport = defineReviewQueueProvider({
  id: "beatport",
  displayName: "Beatport",
  sourceBasis: "purchase-entitlement",
  priorityRank: 90,
  supportedFormats: ["mp3", "wav", "aiff"],
  search: async ({ track }) => {
    // provider-specific lookup
  },
  queueForReview: async ({ candidate, track }) => {
    // provider-specific paid queue flow
  }
});
```

Automatic providers expose `acquire`. Review-only providers expose `queueForReview`.

## Result Shapes

- `ProviderCandidate` carries the shared matching data: provenance, source basis, price tier, available formats, duration, and mix confidence.
- `ProviderAcquiredResult` adds artifact metadata for later manifest and packaging tasks.
- `ProviderRejectedResult` preserves explicit rejection reasons and can optionally attach the canonical track rejection reason.
- `ProviderMissResult` preserves provider-level miss context plus the run-level track miss reason.

## Registry

Register providers in a `ProviderRegistry` and read them through `list()`, `listAutomatic()`, or `listReviewQueue()`.

- Ordering is deterministic.
- `free-auto` always comes before `paid-review-queue`.
- Within a bucket, lower `priorityRank` wins.
- `id` is the final tie-breaker.
