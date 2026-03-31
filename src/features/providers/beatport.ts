import { type CanonicalTrack } from "@/features/tracks/canonical-track";

import { defineReviewQueueProvider } from "./provider-registry";

export const BEATPORT_PROVIDER_ID = "beatport";
export const BEATPORT_PROVIDER_NAME = "Beatport";
export const BEATPORT_REVIEW_QUEUE_NAME = "beatport-review";
export const BEATPORT_REVIEW_SUMMARY =
  "Queued after all automatic free-source providers missed.";

export function createBeatportProvider() {
  return defineReviewQueueProvider({
    id: BEATPORT_PROVIDER_ID,
    displayName: BEATPORT_PROVIDER_NAME,
    authorizationBasis: "purchase-entitlement",
    priorityRank: 90,
    supportedFormats: ["mp3", "wav", "aiff"],
    search: async ({ track }) => ({
      outcome: "candidates" as const,
      candidates: [buildBeatportCandidate(track)]
    }),
    queueForReview: async ({ candidate }) => ({
      outcome: "queued-for-review" as const,
      candidate,
      review: {
        queueName: BEATPORT_REVIEW_QUEUE_NAME,
        summary: BEATPORT_REVIEW_SUMMARY
      }
    })
  });
}

function buildBeatportCandidate(track: CanonicalTrack) {
  const artistName = track.primaryArtist ?? "Unknown Artist";
  const searchQuery = [artistName, track.title, track.mix.displayLabel]
    .filter(Boolean)
    .join(" ");
  const slug = [artistName, track.title]
    .map((segment) =>
      segment
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .join("-")
    .replace(/-+/g, "-");

  return {
    artistName,
    authorizationBasis: "purchase-entitlement" as const,
    availableFormats: ["mp3", "wav"] as const,
    candidateId: `${BEATPORT_PROVIDER_ID}-${slug}`,
    durationSeconds:
      track.durationSeconds ?? (track.mix.displayLabel ? 392 : 301),
    mixConfidence: track.mix.confidence,
    mixLabel: track.mix.displayLabel,
    priceTier: "paid" as const,
    providerId: BEATPORT_PROVIDER_ID,
    providerName: BEATPORT_PROVIDER_NAME,
    provenance: {
      discoveredVia: "search" as const,
      providerTrackId: `${BEATPORT_PROVIDER_ID}-${slug}`,
      providerUrl: `https://www.beatport.com/search/tracks?q=${encodeURIComponent(
        searchQuery
      )}`,
      searchQuery
    },
    title: track.title
  };
}
