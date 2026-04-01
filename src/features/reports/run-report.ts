import {
  listRunArtifactDownloads,
  parseRunTrackArtifactSourceNote,
  type RunTrackArtifactSourceNote
} from "@/features/artifacts/run-artifacts";
import {
  type ArtifactKind,
  getRunStore,
  type RunDetail,
  type RunStore,
  type RunTrack,
  type RunTrackAcquisitionAttempt,
  type RunTrackReview
} from "@/features/runs/run-store";
import type { TrackAcceptedDecision, TrackAudioFormat } from "@/features/tracks/canonical-track";
import type {
  ProviderAuthorizationBasis,
  ProviderPriceTier,
  ProviderProvenance
} from "@/features/providers/provider-registry";

export type RunReportTrackResolution =
  | {
      details: string;
      provider: {
        authorizationBasis: ProviderAuthorizationBasis;
        discoveredVia: ProviderProvenance["discoveredVia"] | null;
        name: string;
        priceTier: ProviderPriceTier;
        url: string | null;
      };
      selectedFormat: TrackAudioFormat | null;
      selectionReason: TrackAcceptedDecision["reason"];
      type: "selected";
    }
  | {
      details: string;
      provider: {
        id: string | null;
        name: string | null;
      } | null;
      reason: string;
      type: "miss";
    };

export type RunReportTrack = RunTrack & {
  latestAttempt: {
    outcome: RunTrackAcquisitionAttempt["outcome"];
    providerKey: string;
  } | null;
  reviewQueueEntry: RunReportReviewQueueEntry | null;
  resolution: RunReportTrackResolution | null;
};

export type RunReportArtifact = {
  downloadUrl: string;
  kind: ArtifactKind;
  label: string;
};

export type RunReportBase = Omit<RunDetail, "artifacts" | "reviewQueue" | "tracks">;

export type RunReportReviewQueueEntry = RunTrackReview & {
  track: Pick<
    RunTrack,
    "artist" | "id" | "sourcePosition" | "title" | "version"
  >;
};

export type RunReportDetail = RunReportBase & {
  artifacts: RunReportArtifact[];
  completedTrackCount: number;
  missCount: number;
  reviewQueue: RunReportReviewQueueEntry[];
  selectedSourceCount: number;
  tracks: RunReportTrack[];
};

export function getRunReport(input: { runId: string; runStore?: RunStore }) {
  const runStore = input.runStore ?? getRunStore();
  const run = runStore.getRun(input.runId);

  if (!run) {
    return null;
  }

  const attempts = runStore.listRunTrackAttempts(input.runId);
  const attemptsByTrackId = groupAttemptsByTrackId(attempts);
  const reviewQueue = run.reviewQueue
    .map((review) => mapRunReportReviewQueueEntry(review, run.tracks))
    .filter((review): review is RunReportReviewQueueEntry => review !== null);
  const reviewQueueByTrackId = groupReviewQueueByTrackId(reviewQueue);
  const tracks = run.tracks.map((track) =>
    mapRunReportTrack(
      track,
      attemptsByTrackId.get(track.id) ?? [],
      reviewQueueByTrackId.get(track.id) ?? null
    )
  );

  return {
    ...run,
    artifactCount: run.artifactCount,
    artifacts: listRunArtifactDownloads({
      runId: run.id,
      runStore
    }).map((artifact) => ({
      ...artifact,
      label: formatArtifactLabel(artifact.kind)
    })),
    completedTrackCount: tracks.filter((track) =>
      track.status === "acquired" ||
      track.status === "missed" ||
      track.status === "failed"
    ).length,
    missCount: tracks.filter((track) => track.status === "missed").length,
    reviewQueue,
    selectedSourceCount: tracks.filter(
      (track) =>
        track.resolution?.type === "selected" ||
        track.reviewQueueEntry?.status === "purchased"
    ).length,
    tracks
  };
}

function groupAttemptsByTrackId(attempts: RunTrackAcquisitionAttempt[]) {
  const attemptsByTrackId = new Map<string, RunTrackAcquisitionAttempt[]>();

  for (const attempt of attempts) {
    const existingAttempts = attemptsByTrackId.get(attempt.runTrackId);

    if (existingAttempts) {
      existingAttempts.push(attempt);
      continue;
    }

    attemptsByTrackId.set(attempt.runTrackId, [attempt]);
  }

  return attemptsByTrackId;
}

function groupReviewQueueByTrackId(reviewQueue: RunReportReviewQueueEntry[]) {
  return new Map(reviewQueue.map((review) => [review.runTrackId, review]));
}

function mapRunReportTrack(
  track: RunTrack,
  attempts: RunTrackAcquisitionAttempt[],
  reviewQueueEntry: RunReportReviewQueueEntry | null
): RunReportTrack {
  const latestAttempt = attempts.at(0);
  const note = attempts
    .map((attempt) => parseRunTrackArtifactSourceNote(attempt.note))
    .find(
      (candidate): candidate is RunTrackArtifactSourceNote => candidate !== null
    ) ?? null;

  return {
    ...track,
    latestAttempt: latestAttempt
      ? {
          outcome: latestAttempt.outcome,
          providerKey: latestAttempt.providerKey
        }
      : null,
    reviewQueueEntry,
    resolution: mapRunReportTrackResolution(note)
  };
}

function mapRunReportReviewQueueEntry(
  review: RunTrackReview,
  tracks: RunTrack[]
) {
  const track = tracks.find((candidate) => candidate.id === review.runTrackId);

  if (!track) {
    return null;
  }

  return {
    ...review,
    track: {
      artist: track.artist,
      id: track.id,
      sourcePosition: track.sourcePosition,
      title: track.title,
      version: track.version
    }
  } satisfies RunReportReviewQueueEntry;
}

function mapRunReportTrackResolution(
  note: RunTrackArtifactSourceNote | null
): RunReportTrackResolution | null {
  if (!note) {
    return null;
  }

  if (note.outcome === "acquired") {
    return {
      details: note.selection.details,
      provider: {
        authorizationBasis: note.provider.authorizationBasis,
        discoveredVia: note.provider.discoveredVia ?? null,
        name: note.provider.providerName,
        priceTier: note.provider.priceTier,
        url: note.provider.providerUrl ?? null
      },
      selectedFormat: note.selection.selectedFormat,
      selectionReason: note.selection.reason,
      type: "selected"
    };
  }

  return {
    details: note.miss.detail,
    provider:
      note.miss.providerId || note.miss.providerName
        ? {
            id: note.miss.providerId ?? null,
            name: note.miss.providerName ?? null
          }
        : null,
    reason: note.miss.reason,
    type: "miss"
  };
}

function formatArtifactLabel(kind: string) {
  switch (kind) {
    case "downloads-zip":
      return "downloads.zip";
    case "manifest-json":
      return "manifest.json";
    case "misses-txt":
      return "misses.txt";
    case "run-report":
      return "run-report.html";
    default:
      return kind;
  }
}
