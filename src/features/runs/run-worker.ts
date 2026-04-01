import type { ProviderRegistry } from "@/features/providers/provider-registry";
import type { RunStore } from "@/features/runs/run-store";

import { executeQueuedRun } from "@/features/runs/live-run-orchestrator";

type RunWorker = {
  scheduleRun(runId: string): Promise<void>;
  waitForIdle(): Promise<void>;
};

type CreateRunWorkerDependencies = {
  processQueuedRun?: typeof executeQueuedRun;
  providerRegistry?: Pick<ProviderRegistry, "listAutomatic" | "listReviewQueue">;
  runStore?: RunStore;
  workspaceRoot?: string;
};

const sharedRunWorkerKey = "__music_downloader_shared_run_worker__" as const;

type GlobalWithRunWorker = typeof globalThis & {
  [sharedRunWorkerKey]?: RunWorker;
};

export function createRunWorker(
  dependencies: CreateRunWorkerDependencies = {}
): RunWorker {
  const pendingRunIds = new Set<string>();
  const activeRunIds = new Set<string>();
  const processQueuedRun = dependencies.processQueuedRun ?? executeQueuedRun;
  let drainPromise: Promise<void> | null = null;

  function drainQueue() {
    if (!drainPromise) {
      drainPromise = (async () => {
        try {
          while (pendingRunIds.size > 0) {
            const iterator = pendingRunIds.values().next();

            if (iterator.done) {
              return;
            }

            const runId = iterator.value;

            pendingRunIds.delete(runId);

            if (activeRunIds.has(runId)) {
              continue;
            }

            activeRunIds.add(runId);

            try {
              await processQueuedRun(runId, dependencies);
            } catch {
              continue;
            } finally {
              activeRunIds.delete(runId);
            }
          }
        } finally {
          drainPromise = null;
        }
      })();
    }

    return drainPromise;
  }

  return {
    scheduleRun(runId: string) {
      if (!activeRunIds.has(runId)) {
        pendingRunIds.add(runId);
      }

      return drainQueue();
    },

    async waitForIdle() {
      while (drainPromise) {
        await drainPromise;
      }
    }
  };
}

export function getSharedRunWorker() {
  const globalWithRunWorker = globalThis as GlobalWithRunWorker;

  if (!globalWithRunWorker[sharedRunWorkerKey]) {
    globalWithRunWorker[sharedRunWorkerKey] = createRunWorker();
  }

  return globalWithRunWorker[sharedRunWorkerKey];
}

export function resetSharedRunWorkerForTests() {
  const globalWithRunWorker = globalThis as GlobalWithRunWorker;

  delete globalWithRunWorker[sharedRunWorkerKey];
}
