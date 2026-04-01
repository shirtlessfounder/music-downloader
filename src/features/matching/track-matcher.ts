import {
  buildMissDecision,
  canonicalizeTrack,
  evaluateTrackCandidate,
  type CanonicalTrack,
  type TrackAudioFormat,
  type TrackDecision
} from "@/features/tracks/canonical-track";
import type { ProviderCandidate } from "@/features/providers/provider-registry";

type AcceptedTrackDecision = Extract<TrackDecision, { outcome: "accepted" }>;
type MissTrackDecision = Extract<TrackDecision, { outcome: "miss" }>;

export const TRACK_MATCH_REJECTION_REASONS = [
  "artist-mismatch",
  "title-mismatch",
  "title-and-artist-mismatch",
  "fallback-confidence-too-low",
  "fallback-duration-missing",
  "fallback-duration-too-short",
  "format-not-eligible",
  "mix-version-not-eligible",
  "superseded-by-higher-ranked-candidate"
] as const;

export type TrackMatchRejectionReason =
  (typeof TRACK_MATCH_REJECTION_REASONS)[number];

export interface RejectedTrackCandidate {
  candidate: ProviderCandidate;
  details: string;
  reason: TrackMatchRejectionReason;
  selectedFormat: TrackAudioFormat | null;
}

export interface SelectedTrackCandidate {
  candidate: ProviderCandidate;
  details: string;
  reason: AcceptedTrackDecision["reason"];
  selectedFormat: TrackAudioFormat;
}

export type TrackMatchResult =
  | {
      outcome: "selected";
      rejected: readonly RejectedTrackCandidate[];
      selected: SelectedTrackCandidate;
    }
  | {
      miss: MissTrackDecision;
      outcome: "miss";
      rejected: readonly RejectedTrackCandidate[];
    };

interface RankedAcceptedCandidate {
  candidate: ProviderCandidate;
  decision: AcceptedTrackDecision;
  index: number;
}

export function matchTrackCandidates(input: {
  candidates: readonly ProviderCandidate[];
  track: CanonicalTrack;
}): TrackMatchResult {
  const rejected: RejectedTrackCandidate[] = [];
  const accepted: RankedAcceptedCandidate[] = [];
  let matchedRequestedTrack = false;

  input.candidates.forEach((candidate, index) => {
    const candidateTrack = canonicalizeProviderCandidate(candidate);
    const titleMatches = candidateTrack.normalizedTitle === input.track.normalizedTitle;
    const artistMatches = doesArtistMatch(input.track, candidateTrack);

    if (!titleMatches || !artistMatches) {
      rejected.push({
        candidate,
        details: buildIdentityMismatchDetails(titleMatches, artistMatches),
        reason: buildIdentityMismatchReason(titleMatches, artistMatches),
        selectedFormat: null
      });

      return;
    }

    matchedRequestedTrack = true;

    const decision = evaluateTrackCandidate(candidateTrack);

    if (
      decision.outcome === "accepted" &&
      decision.reason === "accepted-base-version-fallback" &&
      candidate.mixConfidence !== "high"
    ) {
      rejected.push({
        candidate,
        details:
          "Versionless fallback candidates need high mix confidence before they can be accepted.",
        reason: "fallback-confidence-too-low",
        selectedFormat: decision.selectedFormat
      });

      return;
    }

    if (decision.outcome !== "accepted") {
      rejected.push({
        candidate,
        details: decision.details,
        reason: decision.reason,
        selectedFormat: decision.selectedFormat
      });

      return;
    }

    accepted.push({
      candidate,
      decision,
      index
    });
  });

  if (accepted.length === 0) {
    return {
      miss: buildMissDecision(
        matchedRequestedTrack ? "no-eligible-candidate" : "no-supported-source-match"
      ),
      outcome: "miss",
      rejected
    };
  }

  const rankedAccepted = [...accepted].sort(compareAcceptedCandidates);
  const [winner, ...nonSelected] = rankedAccepted;

  rejected.push(
    ...nonSelected
      .sort((left, right) => left.index - right.index)
      .map(({ candidate, decision }) => ({
        candidate,
        details: `Candidate ranked behind "${winner.candidate.candidateId}" after applying the price, mix, and format preference rules.`,
        reason: "superseded-by-higher-ranked-candidate" as const,
        selectedFormat: decision.selectedFormat
      }))
  );

  return {
    outcome: "selected",
    rejected,
    selected: {
      candidate: winner.candidate,
      details: winner.decision.details,
      reason: winner.decision.reason,
      selectedFormat: winner.decision.selectedFormat
    }
  };
}

function canonicalizeProviderCandidate(candidate: ProviderCandidate) {
  return canonicalizeTrack({
    artistName: candidate.artistName,
    availableFormats: [...candidate.availableFormats],
    duration: candidate.durationSeconds,
    source: candidate.providerId,
    sourceTrackId: candidate.candidateId,
    sourceUrl: candidate.provenance.providerUrl,
    title: buildCandidateTitle(candidate)
  });
}

function buildCandidateTitle(candidate: ProviderCandidate) {
  const mixLabel = candidate.mixLabel?.trim();

  if (!mixLabel) {
    return candidate.title;
  }

  if (candidate.title.toLowerCase().includes(mixLabel.toLowerCase())) {
    return candidate.title;
  }

  return `${candidate.title} (${mixLabel})`;
}

function doesArtistMatch(track: CanonicalTrack, candidateTrack: CanonicalTrack) {
  const targetArtists = getPrimaryArtists(track);
  const candidateArtists = getPrimaryArtists(candidateTrack);

  if (targetArtists.length === 0) {
    return candidateArtists.length === 0;
  }

  return targetArtists.some((artist) => candidateArtists.includes(artist));
}

function getPrimaryArtists(track: CanonicalTrack) {
  return track.artistCredits
    .filter((credit) => credit.role === "primary")
    .map((credit) => credit.normalized);
}

function buildIdentityMismatchReason(
  titleMatches: boolean,
  artistMatches: boolean
): TrackMatchRejectionReason {
  if (!titleMatches && !artistMatches) {
    return "title-and-artist-mismatch";
  }

  if (!titleMatches) {
    return "title-mismatch";
  }

  return "artist-mismatch";
}

function buildIdentityMismatchDetails(titleMatches: boolean, artistMatches: boolean) {
  if (!titleMatches && !artistMatches) {
    return "Candidate title and artist did not match the requested canonical track.";
  }

  if (!titleMatches) {
    return "Candidate title did not match the requested canonical track.";
  }

  return "Candidate artist did not match the requested canonical track.";
}

function compareAcceptedCandidates(
  left: RankedAcceptedCandidate,
  right: RankedAcceptedCandidate
) {
  const priceDifference =
    PRICE_TIER_ORDER[left.candidate.priceTier] -
    PRICE_TIER_ORDER[right.candidate.priceTier];

  if (priceDifference !== 0) {
    return priceDifference;
  }

  const mixDifference =
    ACCEPTED_REASON_ORDER[left.decision.reason] -
    ACCEPTED_REASON_ORDER[right.decision.reason];

  if (mixDifference !== 0) {
    return mixDifference;
  }

  const formatDifference =
    FORMAT_ORDER[left.decision.selectedFormat] -
    FORMAT_ORDER[right.decision.selectedFormat];

  if (formatDifference !== 0) {
    return formatDifference;
  }

  return left.index - right.index;
}

const PRICE_TIER_ORDER = {
  free: 0,
  "free-or-owned": 1,
  paid: 2
} as const;

const ACCEPTED_REASON_ORDER: Record<AcceptedTrackDecision["reason"], number> = {
  "accepted-extended-mix": 0,
  "accepted-original-mix": 1,
  "accepted-base-version-fallback": 2
};

const FORMAT_ORDER: Record<TrackAudioFormat, number> = {
  mp3: 0,
  wav: 1
};
