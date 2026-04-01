import {
  DuplicateProviderRegistrationError,
  ProviderRegistry,
  buildProviderMissResult,
  buildProviderRejectedResult,
  defineAutomaticProvider,
  defineReviewQueueProvider
} from "./provider-registry";

describe("ProviderRegistry", () => {
  it("orders automatic providers before review queue providers", () => {
    const registry = new ProviderRegistry();

    registry.register(
      defineReviewQueueProvider({
        id: "beatport",
        displayName: "Beatport",
        sourceBasis: "purchase-entitlement",
        priorityRank: 90,
        supportedFormats: ["mp3", "wav", "aiff"],
        search: async () =>
          buildProviderMissResult({
            detail: "No Beatport candidate queued yet.",
            providerId: "beatport",
            providerName: "Beatport",
            reason: "no-search-results",
            trackMissReason: "no-supported-source-match"
          }),
        acquirePurchased: async ({ candidate }) =>
          buildProviderRejectedResult({
            candidate,
            detail: "Fixture provider is not wired to acquire owned downloads in tests.",
            providerId: "beatport",
            providerName: "Beatport",
            reason: "provider-error"
          }),
        queueForReview: async ({ candidate }) => ({
          outcome: "queued-for-review",
          candidate,
          review: {
            queueName: "beatport-review",
            summary: "Queued for later operator approval."
          }
        })
      })
    );

    registry.register(
      defineAutomaticProvider({
        id: "bandcamp",
        displayName: "Bandcamp",
        sourceBasis: "rights-holder-storefront",
        priceTier: "free-or-owned",
        priorityRank: 20,
        supportedFormats: ["mp3", "wav", "flac", "aiff", "alac"],
        search: async () =>
          buildProviderMissResult({
            detail: "No Bandcamp result for the requested track.",
            providerId: "bandcamp",
            providerName: "Bandcamp",
            reason: "no-search-results",
            trackMissReason: "no-supported-source-match"
          }),
        acquire: async ({ candidate }) =>
          buildProviderRejectedResult({
            candidate,
            detail: "Fixture provider is not wired to acquire assets in tests.",
            providerId: "bandcamp",
            providerName: "Bandcamp",
            reason: "provider-error"
          })
      })
    );

    registry.register(
      defineAutomaticProvider({
        id: "soundcloud-direct-downloads",
        displayName: "SoundCloud Direct Downloads",
        sourceBasis: "uploader-enabled-download",
        priceTier: "free",
        priorityRank: 10,
        supportedFormats: ["original-upload-format"],
        search: async () =>
          buildProviderMissResult({
            detail: "No SoundCloud direct download is available for the requested track.",
            providerId: "soundcloud-direct-downloads",
            providerName: "SoundCloud Direct Downloads",
            reason: "no-supported-candidate",
            trackMissReason: "no-supported-source-match"
          }),
        acquire: async ({ candidate }) =>
          buildProviderRejectedResult({
            candidate,
            detail: "Fixture provider is not wired to acquire assets in tests.",
            providerId: "soundcloud-direct-downloads",
            providerName: "SoundCloud Direct Downloads",
            reason: "provider-error"
          })
      })
    );

    expect(registry.list().map((provider) => provider.id)).toEqual([
      "soundcloud-direct-downloads",
      "bandcamp",
      "beatport"
    ]);
    expect(registry.listAutomatic().map((provider) => provider.id)).toEqual([
      "soundcloud-direct-downloads",
      "bandcamp"
    ]);
    expect(registry.listReviewQueue().map((provider) => provider.id)).toEqual([
      "beatport"
    ]);
  });

  it("registers providers by id and rejects duplicate registrations", () => {
    const registry = new ProviderRegistry();
    const provider = defineAutomaticProvider({
      id: "bandcamp",
      displayName: "Bandcamp",
      sourceBasis: "rights-holder-storefront",
      priceTier: "free-or-owned",
      priorityRank: 20,
      supportedFormats: ["mp3", "wav"],
      search: async () =>
        buildProviderMissResult({
          detail: "No Bandcamp result for the requested track.",
          providerId: "bandcamp",
          providerName: "Bandcamp",
          reason: "no-search-results",
          trackMissReason: "no-supported-source-match"
        }),
      acquire: async ({ candidate }) =>
        buildProviderRejectedResult({
          candidate,
          detail: "Fixture provider is not wired to acquire assets in tests.",
          providerId: "bandcamp",
          providerName: "Bandcamp",
          reason: "provider-error"
        })
    });

    registry.register(provider);

    expect(registry.get("bandcamp")).toBe(provider);
    expect(() => registry.register(provider)).toThrowError(
      DuplicateProviderRegistrationError
    );
  });
});

describe("provider result helpers", () => {
  it("preserves structured rejection and miss context for later matching and reporting", () => {
    const candidate = {
      artistName: "Anyma",
      sourceBasis: "uploader-enabled-download" as const,
      availableFormats: ["mp3"] as const,
      candidateId: "soundcloud-track-42",
      durationSeconds: 392,
      mixConfidence: "high" as const,
      mixLabel: "Radio Edit",
      priceTier: "free" as const,
      providerId: "soundcloud-direct-downloads",
      providerName: "SoundCloud Direct Downloads",
      provenance: {
        discoveredVia: "search" as const,
        providerTrackId: "42",
        providerUrl: "https://soundcloud.com/artist/track"
      },
      title: "Consciousness"
    };

    expect(
      buildProviderRejectedResult({
        candidate,
        detail: "Radio Edit is outside the approved mix preference order.",
        providerId: "soundcloud-direct-downloads",
        providerName: "SoundCloud Direct Downloads",
        reason: "candidate-mix-rejected",
        trackDecisionReason: "mix-version-not-eligible"
      })
    ).toEqual({
      outcome: "rejected",
      candidate,
      rejection: {
        detail: "Radio Edit is outside the approved mix preference order.",
        providerId: "soundcloud-direct-downloads",
        providerName: "SoundCloud Direct Downloads",
        reason: "candidate-mix-rejected",
        retryable: false,
        trackDecisionReason: "mix-version-not-eligible"
      }
    });

    expect(
      buildProviderMissResult({
        detail: "No authorized download was exposed for the matched SoundCloud track.",
        providerId: "soundcloud-direct-downloads",
        providerName: "SoundCloud Direct Downloads",
        reason: "no-supported-candidate",
        trackMissReason: "no-supported-source-match"
      })
    ).toEqual({
      outcome: "miss",
      miss: {
        detail:
          "No authorized download was exposed for the matched SoundCloud track.",
        providerId: "soundcloud-direct-downloads",
        providerName: "SoundCloud Direct Downloads",
        reason: "no-supported-candidate",
        trackMissReason: "no-supported-source-match"
      }
    });
  });
});
