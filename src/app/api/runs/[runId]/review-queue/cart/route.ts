import path from "node:path";

import { NextResponse } from "next/server";

import { BrowserSessionService } from "@/features/browser/browser-session-service";
import { openBeatportCartForReviews } from "@/features/providers/beatport-cart";
import { getRunStore } from "@/features/runs/run-store";

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const runStore = getRunStore();
  const run = runStore.getRun(runId);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const eligibleReviews = run.reviewQueue
    .filter(
      (review) =>
        review.providerKey === "beatport" &&
        (review.status === "queued" || review.status === "approved")
    )
    .map((review) => {
      const track = run.tracks.find((candidate) => candidate.id === review.runTrackId);

      if (!track) {
        throw new Error(`Run track not found for review: ${review.id}`);
      }

      return {
        artist: track.artist,
        candidateId: review.candidateId,
        mixLabel: review.mixLabel,
        providerUrl: review.providerUrl,
        reviewId: review.id,
        title: track.title
      };
    });

  if (eligibleReviews.length === 0) {
    return NextResponse.json({
      cartUrl: null,
      results: [],
      summary: {
        added: 0,
        alreadyInCart: 0,
        failed: 0,
        notFound: 0,
        total: 0
      }
    });
  }

  const cartResult = await openBeatportCartForReviews({
    browserSessionService: new BrowserSessionService({
      workspaceRoot: resolveWorkspaceRoot()
    }),
    reviews: eligibleReviews
  });

  if (cartResult.outcome === "failed") {
    return NextResponse.json({ error: cartResult.detail }, { status: 409 });
  }

  for (const result of cartResult.results) {
    runStore.updateRunTrackReviewCartResult({
      cartDetail: result.cartDetail,
      cartStatus: result.cartStatus,
      reviewId: result.reviewId
    });
  }

  return NextResponse.json(cartResult);
}

function resolveWorkspaceRoot() {
  return (
    process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd())
  );
}
