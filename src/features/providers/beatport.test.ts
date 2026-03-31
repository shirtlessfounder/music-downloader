import { createBeatportProvider } from "./beatport";
import { createLiveProviderRegistry } from "./live-provider-registry";

describe("createBeatportProvider", () => {
  it("builds review queue candidates and queue metadata for paid fallback review", async () => {
    const provider = createBeatportProvider();

    const searchResult = await provider.search({
      track: {
        artistCredits: [
          {
            display: "Anyma",
            normalized: "anyma",
            role: "primary"
          }
        ],
        availableFormats: [],
        durationSeconds: 392,
        mix: {
          cleanTitle: "Consciousness",
          confidence: "high",
          displayLabel: "Extended Mix",
          kind: "extended",
          normalizedLabel: "extended mix",
          selectionClass: "preferred"
        },
        normalizedArtistKey: "anyma",
        normalizedTitle: "consciousness",
        preferredFormats: ["mp3", "wav"],
        primaryArtist: "Anyma",
        provenance: {
          rawArtists: ["Anyma"],
          rawDuration: null,
          rawTitle: "Consciousness (Extended Mix)",
          source: "playlist-run-track",
          sourceTrackId: "track-1"
        },
        title: "Consciousness"
      }
    });

    expect(searchResult).toEqual({
      candidates: [
        expect.objectContaining({
          artistName: "Anyma",
          availableFormats: ["mp3", "wav"],
          candidateId: "beatport-anyma-consciousness",
          mixLabel: "Extended Mix",
          priceTier: "paid",
          providerId: "beatport",
          providerName: "Beatport",
          title: "Consciousness"
        })
      ],
      outcome: "candidates"
    });

    if (searchResult.outcome !== "candidates") {
      throw new Error("Expected Beatport search to return a candidate.");
    }

    await expect(
      provider.queueForReview({
        candidate: searchResult.candidates[0],
        track: {
          ...searchResult.candidates[0],
          artistCredits: [],
          availableFormats: [],
          mix: {
            cleanTitle: "Consciousness",
            confidence: "high",
            displayLabel: "Extended Mix",
            kind: "extended",
            normalizedLabel: "extended mix",
            selectionClass: "preferred"
          },
          normalizedArtistKey: "anyma",
          normalizedTitle: "consciousness",
          preferredFormats: ["mp3", "wav"],
          primaryArtist: "Anyma",
          provenance: {
            rawArtists: ["Anyma"],
            rawDuration: null,
            rawTitle: "Consciousness (Extended Mix)",
            source: "playlist-run-track",
            sourceTrackId: "track-1"
          }
        }
      })
    ).resolves.toEqual({
      candidate: expect.objectContaining({
        candidateId: "beatport-anyma-consciousness"
      }),
      outcome: "queued-for-review",
      review: {
        queueName: "beatport-review",
        summary: "Queued after all automatic free-source providers missed."
      }
    });
  });

  it("registers Beatport as the live paid review provider", () => {
    const registry = createLiveProviderRegistry();

    expect(registry.listReviewQueue().map((provider) => provider.id)).toEqual([
      "beatport"
    ]);
  });
});
