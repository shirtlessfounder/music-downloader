import { canonicalizeTrack } from "@/features/tracks/canonical-track";
import type { ProviderCandidate } from "@/features/providers/provider-registry";

import { matchTrackCandidates } from "./track-matcher";

describe("matchTrackCandidates", () => {
  const targetTrack = canonicalizeTrack({
    source: "spotify",
    artistNames: ["Anyma"],
    title: "Consciousness (Extended Mix)",
    duration: 392
  });

  it.each([
    {
      name: "prefers a free extended mix over a free original mix",
      candidates: [
        buildCandidate({
          candidateId: "soundcloud-original",
          mixLabel: "Original Mix",
          title: "Consciousness"
        }),
        buildCandidate({
          candidateId: "soundcloud-extended",
          mixLabel: "Extended Mix",
          title: "Consciousness"
        })
      ],
      expected: {
        outcome: "selected",
        selected: {
          candidateId: "soundcloud-extended",
          reason: "accepted-extended-mix",
          selectedFormat: "mp3"
        },
        rejected: [
          {
            candidateId: "soundcloud-original",
            reason: "superseded-by-higher-ranked-candidate",
            selectedFormat: "mp3"
          }
        ]
      }
    },
    {
      name: "prefers mp3 over wav when mix priority is tied",
      candidates: [
        buildCandidate({
          availableFormats: ["wav"],
          candidateId: "bandcamp-wav",
          mixLabel: "Original Mix",
          providerId: "bandcamp",
          providerName: "Bandcamp",
          title: "Consciousness"
        }),
        buildCandidate({
          availableFormats: ["wav", "mp3"],
          candidateId: "soundcloud-mp3",
          mixLabel: "Original Mix",
          title: "Consciousness"
        })
      ],
      expected: {
        outcome: "selected",
        selected: {
          candidateId: "soundcloud-mp3",
          reason: "accepted-original-mix",
          selectedFormat: "mp3"
        },
        rejected: [
          {
            candidateId: "bandcamp-wav",
            reason: "superseded-by-higher-ranked-candidate",
            selectedFormat: "wav"
          }
        ]
      }
    },
    {
      name: "keeps paid fallback candidates behind acceptable free-source matches",
      candidates: [
        buildCandidate({
          availableFormats: ["mp3"],
          candidateId: "soundcloud-original",
          mixLabel: "Original Mix",
          priceTier: "free",
          title: "Consciousness"
        }),
        buildCandidate({
          availableFormats: ["mp3"],
          authorizationBasis: "purchase-entitlement",
          candidateId: "beatport-extended",
          mixLabel: "Extended Mix",
          priceTier: "paid",
          providerId: "beatport",
          providerName: "Beatport",
          title: "Consciousness"
        })
      ],
      expected: {
        outcome: "selected",
        selected: {
          candidateId: "soundcloud-original",
          reason: "accepted-original-mix",
          selectedFormat: "mp3"
        },
        rejected: [
          {
            candidateId: "beatport-extended",
            reason: "superseded-by-higher-ranked-candidate",
            selectedFormat: "mp3"
          }
        ]
      }
    },
    {
      name: "accepts a high-confidence versionless fallback when it clears four minutes",
      candidates: [
        buildCandidate({
          availableFormats: ["wav"],
          candidateId: "bandcamp-fallback",
          durationSeconds: 301,
          mixConfidence: "high",
          mixLabel: null,
          providerId: "bandcamp",
          providerName: "Bandcamp",
          title: "Consciousness"
        })
      ],
      expected: {
        outcome: "selected",
        selected: {
          candidateId: "bandcamp-fallback",
          reason: "accepted-base-version-fallback",
          selectedFormat: "wav"
        },
        rejected: []
      }
    }
  ])("$name", ({ candidates, expected }) => {
    const result = matchTrackCandidates({
      candidates,
      track: targetTrack
    });

    expect(result.outcome).toBe(expected.outcome);

    if (result.outcome !== "selected") {
      throw new Error("Expected a selected result for this test case.");
    }

    expect({
      outcome: result.outcome,
      selected: {
        candidateId: result.selected.candidate.candidateId,
        reason: result.selected.reason,
        selectedFormat: result.selected.selectedFormat
      },
      rejected: result.rejected.map((rejection) => ({
        candidateId: rejection.candidate.candidateId,
        reason: rejection.reason,
        selectedFormat: rejection.selectedFormat
      }))
    }).toEqual(expected);
  });

  it.each([
    {
      name: "rejects low-confidence versionless fallbacks",
      candidates: [
        buildCandidate({
          candidateId: "soundcloud-low-confidence",
          durationSeconds: 301,
          mixConfidence: "medium",
          mixLabel: null,
          title: "Consciousness"
        })
      ],
      expectedMissReason: "no-eligible-candidate",
      expectedRejections: [
        {
          candidateId: "soundcloud-low-confidence",
          reason: "fallback-confidence-too-low",
          selectedFormat: "mp3"
        }
      ]
    },
    {
      name: "rejects short versionless fallbacks",
      candidates: [
        buildCandidate({
          candidateId: "soundcloud-too-short",
          durationSeconds: 239,
          mixConfidence: "high",
          mixLabel: null,
          title: "Consciousness"
        })
      ],
      expectedMissReason: "no-eligible-candidate",
      expectedRejections: [
        {
          candidateId: "soundcloud-too-short",
          reason: "fallback-duration-too-short",
          selectedFormat: "mp3"
        }
      ]
    },
    {
      name: "treats non-matching candidates as no authorized source match",
      candidates: [
        buildCandidate({
          artistName: "Different Artist",
          candidateId: "soundcloud-wrong-track",
          mixLabel: "Extended Mix",
          title: "Different Song"
        })
      ],
      expectedMissReason: "no-authorized-source-match",
      expectedRejections: [
        {
          candidateId: "soundcloud-wrong-track",
          reason: "title-and-artist-mismatch",
          selectedFormat: null
        }
      ]
    }
  ])("$name", ({ candidates, expectedMissReason, expectedRejections }) => {
    const result = matchTrackCandidates({
      candidates,
      track: targetTrack
    });

    expect(result).toMatchObject({
      outcome: "miss",
      miss: {
        reason: expectedMissReason
      },
      rejected: expectedRejections.map((rejection) => ({
        candidate: {
          candidateId: rejection.candidateId
        },
        reason: rejection.reason,
        selectedFormat: rejection.selectedFormat
      }))
    });
  });

  it("returns the same result for the same inputs", () => {
    const input = {
      candidates: [
        buildCandidate({
          candidateId: "soundcloud-original",
          mixLabel: "Original Mix",
          title: "Consciousness"
        }),
        buildCandidate({
          candidateId: "soundcloud-extended",
          mixLabel: "Extended Mix",
          title: "Consciousness"
        })
      ],
      track: targetTrack
    };

    expect(matchTrackCandidates(input)).toEqual(matchTrackCandidates(input));
  });
});

function buildCandidate(
  overrides: Partial<ProviderCandidate> & Pick<ProviderCandidate, "candidateId">
): ProviderCandidate {
  return {
    artistName: "Anyma",
    authorizationBasis: "uploader-enabled-download",
    availableFormats: ["mp3"],
    candidateId: overrides.candidateId,
    durationSeconds: 392,
    mixConfidence: "high",
    mixLabel: "Extended Mix",
    priceTier: "free",
    providerId: "soundcloud-direct-downloads",
    providerName: "SoundCloud Direct Downloads",
    provenance: {
      discoveredVia: "search",
      providerTrackId: overrides.candidateId,
      providerUrl: `https://example.test/${overrides.candidateId}`
    },
    title: "Consciousness",
    ...overrides
  };
}
