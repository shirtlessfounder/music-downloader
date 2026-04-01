import { NextResponse } from "next/server";

import {
  isE2eFixtureModeEnabled,
  restartE2eRunStore
} from "@/features/e2e/e2e-fixtures";
import { getSharedRunWorker } from "@/features/runs/run-worker";

export async function POST() {
  if (!isE2eFixtureModeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const result = restartE2eRunStore();
  getSharedRunWorker();

  return NextResponse.json({
    ok: true,
    runCount: result.runCount
  });
}
