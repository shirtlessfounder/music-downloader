import { NextResponse } from "next/server";

import {
  RunArtifactsNotReadyError,
  generateRunArtifacts,
  listRunArtifactDownloads
} from "@/features/artifacts/run-artifacts";
import { getRunStore } from "@/features/runs/run-store";

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const runStore = getRunStore();

  if (!runStore.getRun(runId)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({
    artifacts: listRunArtifactDownloads({
      runId,
      runStore
    })
  });
}

export async function POST(_request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const runStore = getRunStore();

  if (!runStore.getRun(runId)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  try {
    await generateRunArtifacts({
      runId,
      runStore
    });
  } catch (error) {
    if (error instanceof RunArtifactsNotReadyError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    throw error;
  }

  return NextResponse.json({
    artifacts: listRunArtifactDownloads({
      runId,
      runStore
    })
  });
}
