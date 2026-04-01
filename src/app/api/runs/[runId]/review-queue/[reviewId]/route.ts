import { NextResponse } from "next/server";

import { createLiveProviderRegistry } from "@/features/providers/live-provider-registry";
import {
  getRunStore,
  type RunTrack,
  type RunTrackReview,
  type RunTrackReviewStatus
} from "@/features/runs/run-store";
import { finalizeTerminalRun } from "@/features/runs/run-finalization";
import { canonicalizeTrack } from "@/features/tracks/canonical-track";

type RouteContext = {
  params: Promise<{
    reviewId: string;
    runId: string;
  }>;
};

const reviewActionToStatus: Record<string, Exclude<RunTrackReviewStatus, "purchased">> = {
  approve: "approved",
  reject: "rejected"
};

export async function POST(request: Request, context: RouteContext) {
  const payload = (await request.json().catch(() => null)) as
    | {
        action?: string;
      }
    | null;
  const action = payload?.action?.trim();
  const nextStatus = action ? reviewActionToStatus[action] : null;
  const { reviewId, runId } = await context.params;
  const runStore = getRunStore();
  const run = runStore.getRun(runId);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const review = run.reviewQueue.find((candidate) => candidate.id === reviewId);

  if (!review) {
    return NextResponse.json({ error: "Review candidate not found" }, { status: 404 });
  }

  if (!action || (action !== "purchased" && !nextStatus)) {
    return NextResponse.json(
      { error: "action must be one of approve, reject, or purchased" },
      { status: 400 }
    );
  }

  try {
    if (action === "purchased") {
      const track = run.tracks.find((candidate) => candidate.id === review.runTrackId);

      if (!track) {
        return NextResponse.json({ error: "Run track not found" }, { status: 404 });
      }

      const providerRegistry = createLiveProviderRegistry();
      const provider = providerRegistry.get(review.providerKey);

      if (!provider || !("acquirePurchased" in provider)) {
        return NextResponse.json(
          { error: `Review provider not available: ${review.providerKey}` },
          { status: 409 }
        );
      }

      const acquisitionResult = await provider.acquirePurchased({
        candidate: buildReviewCandidate(review, track),
        track: canonicalizeTrack({
          artistName: track.artist,
          availableFormats: review.availableFormats,
          source: "playlist-run-track",
          sourceTrackId: track.sourceTrackId ?? track.id,
          title: buildRequestedTrackTitle(track)
        })
      });

      if (acquisitionResult.outcome !== "acquired") {
        return NextResponse.json(
          {
            error:
              acquisitionResult.outcome === "rejected"
                ? acquisitionResult.rejection.detail
                : acquisitionResult.miss.detail
          },
          { status: 409 }
        );
      }

      const updatedReview = runStore.completePurchasedRunTrackReview({
        artifact: acquisitionResult.artifact,
        reviewId
      });

      await finalizeTerminalRun(runId, { runStore });

      return NextResponse.json(updatedReview);
    }

    if (!nextStatus) {
      throw new Error(`Unsupported review action: ${action}`);
    }

    const updatedReview = runStore.transitionRunTrackReviewStatus(reviewId, nextStatus);

    await finalizeTerminalRun(runId, { runStore });

    return NextResponse.json(updatedReview);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to update review status"
      },
      { status: 409 }
    );
  }
}

function buildRequestedTrackTitle(track: RunTrack) {
  return track.version ? `${track.title} (${track.version})` : track.title;
}

function buildReviewCandidate(review: RunTrackReview, track: RunTrack) {
  return {
    artistName: track.artist,
    sourceBasis: review.sourceBasis,
    availableFormats: review.availableFormats,
    candidateId: review.candidateId,
    durationSeconds: null,
    mixConfidence: "high" as const,
    mixLabel: review.mixLabel,
    priceTier: review.priceTier,
    providerId: review.providerKey,
    providerName: review.providerName,
    provenance: {
      discoveredVia: "search" as const,
      providerUrl: review.providerUrl ?? undefined,
      searchQuery: [track.artist, track.title, review.mixLabel]
        .filter((value): value is string => Boolean(value))
        .join(" ")
    },
    title: track.title
  };
}
