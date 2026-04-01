import { NextResponse } from "next/server";

import { getRunStore } from "@/features/runs/run-store";
import { getSharedRunWorker } from "@/features/runs/run-worker";

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  getSharedRunWorker();

  const { runId } = await context.params;
  const run = getRunStore().getRun(runId);

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json(run);
}
