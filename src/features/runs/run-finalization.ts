import { generateRunArtifacts } from "@/features/artifacts/run-artifacts";

import {
  getRunStore,
  type RunDetail,
  type RunStatus,
  type RunStore,
  type RunTrackStatus
} from "./run-store";

type FinalizeTerminalRunDependencies = {
  runStore?: RunStore;
  workspaceRoot?: string;
};

const finalizableRunStatuses = new Set<RunStatus>([
  "matching",
  "awaiting-approval",
  "packaging"
]);
const terminalTrackStatuses = new Set<RunTrackStatus>(["acquired", "missed"]);

export async function finalizeTerminalRun(
  runId: string,
  dependencies: FinalizeTerminalRunDependencies = {}
): Promise<RunDetail> {
  const runStore = dependencies.runStore ?? getRunStore();
  const run = requireRun(runStore, runId);

  if (run.status === "completed" || run.status === "failed") {
    return run;
  }

  if (!finalizableRunStatuses.has(run.status)) {
    return run;
  }

  if (run.tracks.some((track) => !terminalTrackStatuses.has(track.status))) {
    return run;
  }

  if (run.status !== "packaging") {
    runStore.transitionRunStatus(runId, "packaging");
  }

  await generateRunArtifacts({
    runId,
    runStore,
    workspaceRoot: dependencies.workspaceRoot
  });

  return runStore.transitionRunStatus(runId, "completed");
}

function requireRun(runStore: RunStore, runId: string) {
  const run = runStore.getRun(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  return run;
}
