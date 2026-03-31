import { NextResponse } from "next/server";

import {
  getRunStore,
  type RunTrackReviewStatus
} from "@/features/runs/run-store";
import { finalizeTerminalRun } from "@/features/runs/run-finalization";

type RouteContext = {
  params: Promise<{
    reviewId: string;
    runId: string;
  }>;
};

const reviewActionToStatus: Record<string, RunTrackReviewStatus> = {
  approve: "approved",
  purchased: "purchased",
  reject: "rejected"
};

export async function POST(request: Request, context: RouteContext) {
  const payload = (await request.json().catch(() => null)) as
    | {
        action?: string;
      }
    | null;
  const nextStatus = payload?.action ? reviewActionToStatus[payload.action] : null;
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

  if (!nextStatus) {
    return NextResponse.json(
      { error: "action must be one of approve, reject, or purchased" },
      { status: 400 }
    );
  }

  try {
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
