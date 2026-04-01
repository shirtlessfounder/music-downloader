/* @vitest-environment node */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  defineAutomaticProvider,
  type AutomaticProviderDefinition,
  type ProviderCandidate,
  type ProviderRegistry
} from "@/features/providers/provider-registry";

import { executeQueuedRun } from "./live-run-orchestrator";
import { createRunStore, type RunStore, type RunTrack } from "./run-store";
import { createRunWorker } from "./run-worker";

function createTempWorkspace() {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "music-downloader-run-worker-"));
  const databasePath = path.join(workspaceRoot, "data", "music-downloader.sqlite");

  return {
    cleanup() {
      rmSync(workspaceRoot, { force: true, recursive: true });
    },
    databasePath,
    workspaceRoot
  };
}

function createStubRegistry(automaticProviders: AutomaticProviderDefinition[]) {
  return {
    listAutomatic: () => automaticProviders,
    listReviewQueue: () => []
  } satisfies Pick<ProviderRegistry, "listAutomatic" | "listReviewQueue">;
}

function createQueuedRun(
  runStore: RunStore,
  playlistUrl: string,
  tracks: Array<{
    artist: string;
    sourcePosition: number;
    title: string;
    version?: string | null;
  }>
) {
  const run = runStore.createRun({
    playlistTitle: "Queued Worker Fixture",
    playlistUrl,
    sourceType: "spotify"
  });

  runStore.replaceRunTracks(run.id, tracks);

  return run;
}

function buildMatchingCandidate(
  provider: AutomaticProviderDefinition,
  track: RunTrack
): ProviderCandidate {
  return {
    artistName: track.artist,
    authorizationBasis: provider.authorizationBasis,
    availableFormats: ["mp3"],
    candidateId: `${provider.id}-${track.sourcePosition}`,
    durationSeconds: track.version ? 392 : 301,
    mixConfidence: "high",
    mixLabel: track.version ?? null,
    priceTier: provider.priceTier,
    providerId: provider.id,
    providerName: provider.displayName,
    provenance: {
      discoveredVia: "search",
      providerTrackId: `${provider.id}-${track.sourcePosition}`,
      providerUrl: `https://example.test/${provider.id}/${track.sourcePosition}`,
      searchQuery: `${track.artist} ${track.title}`
    },
    title: track.title
  };
}

describe("createRunWorker", () => {
  it("drains queued runs through the existing orchestration lifecycle", async () => {
    const tempWorkspace = createTempWorkspace();
    const runStore = createRunStore({ databasePath: tempWorkspace.databasePath });

    const bandcampProvider = defineAutomaticProvider({
      id: "bandcamp",
      displayName: "Bandcamp",
      authorizationBasis: "rights-holder-storefront",
      priceTier: "free-or-owned",
      priorityRank: 20,
      supportedFormats: ["mp3", "wav"],
      search: async ({ track }) => ({
        outcome: "candidates" as const,
        candidates: [
          buildMatchingCandidate(bandcampProvider, {
            artist: track.primaryArtist ?? "Unknown Artist",
            createdAt: "",
            id: `track-${track.title}`,
            runId: "run",
            sourcePosition: 1,
            sourceTrackId: null,
            status: "queued",
            title: track.title,
            updatedAt: "",
            version: track.mix.displayLabel
          })
        ]
      }),
      acquire: async ({ candidate, track }) => {
        const downloadDirectory = path.join(tempWorkspace.workspaceRoot, "downloads");
        const artifactFileName = `${track.title.toLowerCase().replace(/\s+/g, "-")}.mp3`;
        const localFilePath = path.join(downloadDirectory, artifactFileName);

        mkdirSync(downloadDirectory, { recursive: true });
        writeFileSync(localFilePath, `${candidate.providerName}:${track.title}\n`, "utf8");

        return {
          outcome: "acquired" as const,
          artifact: {
            contentType: "audio/mpeg",
            fileExtension: "mp3",
            fileName: artifactFileName,
            format: "mp3",
            localFilePath,
            sha256: null,
            sizeBytes: readFileSync(localFilePath).byteLength
          },
          candidate
        };
      }
    });

    try {
      const queuedRun = createQueuedRun(
        runStore,
        "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9",
        [
          {
            artist: "Anyma",
            sourcePosition: 1,
            title: "Consciousness",
            version: "Extended Mix"
          }
        ]
      );
      const worker = createRunWorker({
        providerRegistry: createStubRegistry([bandcampProvider]),
        runStore,
        workspaceRoot: tempWorkspace.workspaceRoot
      });

      await worker.scheduleRun(queuedRun.id);

      expect(runStore.getRun(queuedRun.id)).toEqual(
        expect.objectContaining({
          artifactCount: 3,
          status: "completed"
        })
      );
    } finally {
      runStore.close();
      tempWorkspace.cleanup();
    }
  });

  it("does not double-process the same queued run when scheduling starts more than once", async () => {
    const tempWorkspace = createTempWorkspace();
    const runStore = createRunStore({ databasePath: tempWorkspace.databasePath });

    try {
      const queuedRun = createQueuedRun(
        runStore,
        "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9",
        [
          {
            artist: "DJ Sealer",
            sourcePosition: 1,
            title: "Warehouse Tool"
          }
        ]
      );
      let releaseExecution: (() => void) | null = null;
      const processQueuedRun = vi.fn(async (runId: string) => {
        runStore.transitionRunStatus(runId, "ingesting");

        await new Promise<void>((resolve) => {
          releaseExecution = resolve;
        });

        runStore.transitionRunStatus(runId, "matching");
        runStore.transitionRunStatus(runId, "failed");

        return runStore.getRun(runId) ?? null;
      });
      const worker = createRunWorker({
        processQueuedRun: processQueuedRun as typeof executeQueuedRun,
        runStore
      });

      const firstDrain = worker.scheduleRun(queuedRun.id);
      const secondDrain = worker.scheduleRun(queuedRun.id);

      await vi.waitFor(() => {
        expect(processQueuedRun).toHaveBeenCalledTimes(1);
      });

      releaseExecution?.();
      await Promise.all([firstDrain, secondDrain]);

      expect(processQueuedRun).toHaveBeenCalledTimes(1);
      expect(runStore.getRun(queuedRun.id)?.status).toBe("failed");
    } finally {
      runStore.close();
      tempWorkspace.cleanup();
    }
  });
});
