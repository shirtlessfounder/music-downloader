/* @vitest-environment node */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  parseRunTrackArtifactSourceNote
} from "@/features/artifacts/run-artifacts";
import {
  buildProviderMissResult,
  buildProviderRejectedResult,
  defineAutomaticProvider,
  defineReviewQueueProvider,
  type AutomaticProviderDefinition,
  type ProviderCandidate,
  type ProviderRegistry,
  type ReviewQueueProviderDefinition
} from "@/features/providers/provider-registry";
import { createRunStore, type RunStore, type RunTrack } from "@/features/runs/run-store";

import {
  executeQueuedRun,
  submitLiveRunFromPlaylistUrl
} from "./live-run-orchestrator";

function createTempWorkspace() {
  const workspaceRoot = mkdtempSync(
    path.join(tmpdir(), "music-downloader-live-orchestrator-")
  );
  const databasePath = path.join(workspaceRoot, "data", "music-downloader.sqlite");

  return {
    cleanup() {
      rmSync(workspaceRoot, { force: true, recursive: true });
    },
    databasePath,
    workspaceRoot
  };
}

function createStubRegistry(
  automaticProviders: AutomaticProviderDefinition[],
  reviewProviders: ReviewQueueProviderDefinition[] = []
) {
  return {
    listAutomatic: () => automaticProviders,
    listReviewQueue: () => reviewProviders
  } satisfies Pick<ProviderRegistry, "listAutomatic" | "listReviewQueue">;
}

function createStubRun(
  runStore: RunStore,
  playlistUrl: string,
  tracks: Array<{
    artist: string;
    sourcePosition: number;
    title: string;
    version?: string | null;
  }>
) {
  const sourceType = playlistUrl.includes("spotify.com") ? "spotify" : "soundcloud";
  const run = runStore.createRun({
    playlistTitle: "Live Pipeline Fixture",
    playlistUrl,
    sourceType
  });

  runStore.replaceRunTracks(run.id, tracks);

  const hydratedRun = runStore.getRun(run.id);

  if (!hydratedRun) {
    throw new Error(`Expected stub run to exist after intake: ${run.id}`);
  }

  return hydratedRun;
}

function buildMatchingCandidate(
  provider: AutomaticProviderDefinition,
  track: RunTrack
): ProviderCandidate {
  return {
    artistName: track.artist,
    sourceBasis: provider.sourceBasis,
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

describe("submitLiveRunFromPlaylistUrl", () => {
  it("resumes interrupted matching runs from persisted queued state", async () => {
    const tempWorkspace = createTempWorkspace();
    let initialRunStore: RunStore | undefined;
    let resumedRunStore: RunStore | undefined;

    const bandcampProvider = defineAutomaticProvider({
      id: "bandcamp",
      displayName: "Bandcamp",
      sourceBasis: "rights-holder-storefront",
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
      initialRunStore = createRunStore({ databasePath: tempWorkspace.databasePath });

      const interruptedRun = createStubRun(
        initialRunStore,
        "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9",
        [
          {
            artist: "Anyma",
            sourcePosition: 1,
            title: "Consciousness",
            version: "Extended Mix"
          },
          {
            artist: "Kx5",
            sourcePosition: 2,
            title: "Escape"
          }
        ]
      );

      initialRunStore.transitionRunStatus(interruptedRun.id, "ingesting");
      initialRunStore.transitionRunStatus(interruptedRun.id, "matching");
      initialRunStore.close();
      initialRunStore = undefined;

      resumedRunStore = createRunStore({ databasePath: tempWorkspace.databasePath });

      expect(resumedRunStore.getRunStatusSnapshot(interruptedRun.id)).toEqual(
        expect.objectContaining({
          resumeAfterStatus: "matching",
          status: "queued"
        })
      );

      const resumedRun = await executeQueuedRun(interruptedRun.id, {
        providerRegistry: createStubRegistry([bandcampProvider]),
        runStore: resumedRunStore,
        workspaceRoot: tempWorkspace.workspaceRoot
      });

      expect(resumedRun.status).toBe("completed");
      expect(resumedRun.resumeAfterStatus).toBe("matching");
      expect(resumedRun.tracks.map((track) => [track.sourcePosition, track.status])).toEqual(
        [
          [1, "acquired"],
          [2, "acquired"]
        ]
      );
      expect([...resumedRun.artifacts.map((artifact) => artifact.kind)].sort()).toEqual([
        "downloads-zip",
        "manifest-json",
        "misses-txt"
      ]);
    } finally {
      initialRunStore?.close();
      resumedRunStore?.close();
      tempWorkspace.cleanup();
    }
  });

  it("executes automatic providers in priority order, persists selected outcomes, and packages fully auto-resolved runs", async () => {
    const tempWorkspace = createTempWorkspace();
    const runStore = createRunStore({ databasePath: tempWorkspace.databasePath });
    const searchCalls: string[] = [];

    const soundCloudProvider = defineAutomaticProvider({
      id: "soundcloud-direct-downloads",
      displayName: "SoundCloud Direct Downloads",
      sourceBasis: "uploader-enabled-download",
      priceTier: "free",
      priorityRank: 10,
      supportedFormats: ["original-upload-format"],
      search: async ({ track }) => {
        searchCalls.push(`soundcloud:${track.primaryArtist}:${track.title}`);

        return buildProviderMissResult({
          detail: "No uploader-enabled download matched this track on SoundCloud.",
          providerId: "soundcloud-direct-downloads",
          providerName: "SoundCloud Direct Downloads",
          reason: "no-search-results",
          trackMissReason: "no-supported-source-match"
        });
      },
      acquire: async () => {
        throw new Error("SoundCloud acquire should not run after a miss.");
      }
    });
    const bandcampProvider = defineAutomaticProvider({
      id: "bandcamp",
      displayName: "Bandcamp",
      sourceBasis: "rights-holder-storefront",
      priceTier: "free-or-owned",
      priorityRank: 20,
      supportedFormats: ["mp3", "wav"],
      search: async ({ track }) => {
        searchCalls.push(`bandcamp:${track.primaryArtist}:${track.title}`);

        return {
          outcome: "candidates" as const,
          candidates: [
            buildMatchingCandidate(bandcampProvider, {
              artist: track.primaryArtist ?? "Unknown Artist",
              createdAt: "",
              id: `track-${track.title}`,
              runId: "run",
              sourcePosition: searchCalls.length,
              sourceTrackId: null,
              status: "queued",
              title: track.title,
              updatedAt: "",
              version: track.mix.displayLabel
            })
          ]
        };
      },
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
      const run = await submitLiveRunFromPlaylistUrl(
        "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9",
        {
          createRunFromPlaylistUrl: async (playlistUrl) =>
            createStubRun(runStore, playlistUrl, [
              {
                artist: "Anyma",
                sourcePosition: 1,
                title: "Consciousness",
                version: "Extended Mix"
              },
              {
                artist: "Kx5",
                sourcePosition: 2,
                title: "Escape"
              }
            ]),
          providerRegistry: createStubRegistry([soundCloudProvider, bandcampProvider]),
          runStore,
          workspaceRoot: tempWorkspace.workspaceRoot
        }
      );

      expect(searchCalls).toEqual([
        "soundcloud:Anyma:Consciousness",
        "bandcamp:Anyma:Consciousness",
        "soundcloud:Kx5:Escape",
        "bandcamp:Kx5:Escape"
      ]);
      expect(run.status).toBe("completed");
      expect([...run.artifacts.map((artifact) => artifact.kind)].sort()).toEqual([
        "downloads-zip",
        "manifest-json",
        "misses-txt"
      ]);

      const persistedRun = runStore.getRun(run.id);

      expect(persistedRun?.tracks.map((track) => [track.sourcePosition, track.status])).toEqual(
        [
          [1, "acquired"],
          [2, "acquired"]
        ]
      );

      const attempts = runStore.listRunTrackAttempts(run.id);

      expect(attempts.map((attempt) => [attempt.providerKey, attempt.outcome])).toEqual([
        ["bandcamp", "matched"],
        ["soundcloud-direct-downloads", "skipped"],
        ["bandcamp", "matched"],
        ["soundcloud-direct-downloads", "skipped"]
      ]);
      expect(
        parseRunTrackArtifactSourceNote(
          attempts.find((attempt) => attempt.providerKey === "bandcamp")?.note ?? null
        )
      ).toEqual(
        expect.objectContaining({
          outcome: "acquired"
        })
      );

      const manifestArtifact = persistedRun?.artifacts.find(
        (artifact) => artifact.kind === "manifest-json"
      );

      expect(manifestArtifact).toBeDefined();

      const manifest = JSON.parse(
        readFileSync(
          path.join(tempWorkspace.workspaceRoot, manifestArtifact?.relativePath ?? ""),
          "utf8"
        )
      ) as {
        summary: {
          acquiredCount: number;
          missCount: number;
          trackCount: number;
        };
      };

      expect(manifest.summary).toEqual({
        acquiredCount: 2,
        missCount: 0,
        trackCount: 2
      });
    } finally {
      runStore.close();
      tempWorkspace.cleanup();
    }
  });

  it("packages mixed acquired and missed runs once every track reaches a terminal status", async () => {
    const tempWorkspace = createTempWorkspace();
    const runStore = createRunStore({ databasePath: tempWorkspace.databasePath });

    const soundCloudProvider = defineAutomaticProvider({
      id: "soundcloud-direct-downloads",
      displayName: "SoundCloud Direct Downloads",
      sourceBasis: "uploader-enabled-download",
      priceTier: "free",
      priorityRank: 10,
      supportedFormats: ["original-upload-format"],
      search: async ({ track }) => {
        if (track.title === "Consciousness") {
          return {
            outcome: "candidates" as const,
            candidates: [
              buildMatchingCandidate(soundCloudProvider, {
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
          };
        }

        return buildProviderMissResult({
          detail: "No uploader-enabled download matched this track on SoundCloud.",
          providerId: "soundcloud-direct-downloads",
          providerName: "SoundCloud Direct Downloads",
          reason: "no-search-results",
          trackMissReason: "no-supported-source-match"
        });
      },
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
    const bandcampProvider = defineAutomaticProvider({
      id: "bandcamp",
      displayName: "Bandcamp",
      sourceBasis: "rights-holder-storefront",
      priceTier: "free-or-owned",
      priorityRank: 20,
      supportedFormats: ["mp3", "wav"],
      search: async () =>
        buildProviderMissResult({
          detail: "No Bandcamp result matched the requested track.",
          providerId: "bandcamp",
          providerName: "Bandcamp",
          reason: "no-search-results",
          trackMissReason: "no-supported-source-match"
        }),
      acquire: async () => {
        throw new Error("Bandcamp acquire should not run after a miss.");
      }
    });

    try {
      const run = await submitLiveRunFromPlaylistUrl(
        "https://soundcloud.com/dj-nova/sets/warehouse-finds",
        {
          createRunFromPlaylistUrl: async (playlistUrl) =>
            createStubRun(runStore, playlistUrl, [
              {
                artist: "Anyma",
                sourcePosition: 1,
                title: "Consciousness",
                version: "Extended Mix"
              },
              {
                artist: "Unknown Artist",
                sourcePosition: 2,
                title: "Missing Track"
              }
            ]),
          providerRegistry: createStubRegistry([soundCloudProvider, bandcampProvider]),
          runStore,
          workspaceRoot: tempWorkspace.workspaceRoot
        }
      );

      expect(run.status).toBe("completed");
      expect([...run.artifacts.map((artifact) => artifact.kind)].sort()).toEqual([
        "downloads-zip",
        "manifest-json",
        "misses-txt"
      ]);
      expect(run.tracks.map((track) => [track.sourcePosition, track.status])).toEqual([
        [1, "acquired"],
        [2, "missed"]
      ]);

      const persistedRun = runStore.getRun(run.id);
      const attempts = runStore.listRunTrackAttempts(run.id);
      const latestMissAttempt = attempts.find(
        (attempt) => attempt.providerKey === "track-matcher"
      );

      expect(latestMissAttempt).toEqual(
        expect.objectContaining({
          outcome: "missed"
        })
      );
      expect(parseRunTrackArtifactSourceNote(latestMissAttempt?.note ?? null)).toEqual(
        expect.objectContaining({
          outcome: "missed",
          miss: expect.objectContaining({
            reason: "no-supported-source-match"
          })
        })
      );

      const manifestArtifact = persistedRun?.artifacts.find(
        (artifact) => artifact.kind === "manifest-json"
      );

      expect(manifestArtifact).toBeDefined();

      const manifest = JSON.parse(
        readFileSync(
          path.join(tempWorkspace.workspaceRoot, manifestArtifact?.relativePath ?? ""),
          "utf8"
        )
      ) as {
        summary: {
          acquiredCount: number;
          missCount: number;
          trackCount: number;
        };
      };

      expect(manifest.summary).toEqual({
        acquiredCount: 1,
        missCount: 1,
        trackCount: 2
      });
    } finally {
      runStore.close();
      tempWorkspace.cleanup();
    }
  });

  it("queues Beatport review candidates when automatic providers exhaust eligible tracks", async () => {
    const tempWorkspace = createTempWorkspace();
    const runStore = createRunStore({ databasePath: tempWorkspace.databasePath });

    const soundCloudProvider = defineAutomaticProvider({
      id: "soundcloud-direct-downloads",
      displayName: "SoundCloud Direct Downloads",
      sourceBasis: "uploader-enabled-download",
      priceTier: "free",
      priorityRank: 10,
      supportedFormats: ["original-upload-format"],
      search: async () =>
        buildProviderMissResult({
          detail: "No uploader-enabled download matched this track on SoundCloud.",
          providerId: "soundcloud-direct-downloads",
          providerName: "SoundCloud Direct Downloads",
          reason: "no-search-results",
          trackMissReason: "no-supported-source-match"
        }),
      acquire: async () => {
        throw new Error("SoundCloud acquire should not run after a miss.");
      }
    });
    const bandcampProvider = defineAutomaticProvider({
      id: "bandcamp",
      displayName: "Bandcamp",
      sourceBasis: "rights-holder-storefront",
      priceTier: "free-or-owned",
      priorityRank: 20,
      supportedFormats: ["mp3", "wav"],
      search: async () =>
        buildProviderMissResult({
          detail: "No Bandcamp result matched the requested track.",
          providerId: "bandcamp",
          providerName: "Bandcamp",
          reason: "no-search-results",
          trackMissReason: "no-supported-source-match"
        }),
      acquire: async () => {
        throw new Error("Bandcamp acquire should not run after a miss.");
      }
    });
    const beatportProvider = defineReviewQueueProvider({
      id: "beatport",
      displayName: "Beatport",
      sourceBasis: "purchase-entitlement",
      priorityRank: 90,
      supportedFormats: ["mp3", "wav", "aiff"],
      search: async ({ track }) => ({
        outcome: "candidates" as const,
        candidates: [
          {
            artistName: track.primaryArtist ?? "Unknown Artist",
            sourceBasis: "purchase-entitlement",
            availableFormats: ["mp3", "wav"],
            candidateId: `beatport-${track.normalizedTitle}`,
            durationSeconds: track.durationSeconds ?? 301,
            mixConfidence: track.mix.confidence,
            mixLabel: track.mix.displayLabel,
            priceTier: "paid",
            providerId: "beatport",
            providerName: "Beatport",
            provenance: {
              discoveredVia: "search" as const,
              providerTrackId: `beatport-${track.normalizedTitle}`,
              providerUrl: `https://www.beatport.com/search?q=${encodeURIComponent(
                `${track.primaryArtist ?? ""} ${track.title}`
              )}`,
              searchQuery: `${track.primaryArtist ?? ""} ${track.title}`.trim()
            },
            title: track.title
          }
        ]
      }),
      acquirePurchased: async ({ candidate }) =>
        buildProviderRejectedResult({
          candidate,
          detail:
            "Stub Beatport provider does not acquire purchased downloads in this orchestration test.",
          providerId: "beatport",
          providerName: "Beatport",
          reason: "provider-error"
        }),
      queueForReview: async ({ candidate }) => ({
        outcome: "queued-for-review" as const,
        candidate,
        review: {
          queueName: "beatport-review",
          summary: "Queued after all automatic free-source providers missed."
        }
      })
    });

    try {
      const run = await submitLiveRunFromPlaylistUrl(
        "https://soundcloud.com/dj-nova/sets/warehouse-finds",
        {
          createRunFromPlaylistUrl: async (playlistUrl) =>
            createStubRun(runStore, playlistUrl, [
              {
                artist: "DJ Sealer",
                sourcePosition: 1,
                title: "Warehouse Tool",
                version: "Extended Mix"
              },
              {
                artist: "Selector Two",
                sourcePosition: 2,
                title: "Loft Shaker"
              }
            ]),
          providerRegistry: createStubRegistry(
            [soundCloudProvider, bandcampProvider],
            [beatportProvider]
          ),
          runStore,
          workspaceRoot: tempWorkspace.workspaceRoot
        }
      );

      expect(run.status).toBe("awaiting-approval");
      expect(run.artifacts).toEqual([]);
      expect(run.tracks.map((track) => [track.sourcePosition, track.status])).toEqual([
        [1, "awaiting-approval"],
        [2, "awaiting-approval"]
      ]);
      expect(
        run.reviewQueue.map((review) => [
          review.candidateId,
          review.queueName,
          review.status
        ])
      ).toEqual([
        ["beatport-warehouse tool", "beatport-review", "queued"],
        ["beatport-loft shaker", "beatport-review", "queued"]
      ]);

      const attempts = runStore.listRunTrackAttempts(run.id);

      expect(attempts.map((attempt) => [attempt.providerKey, attempt.outcome])).toEqual([
        ["bandcamp", "skipped"],
        ["soundcloud-direct-downloads", "skipped"],
        ["bandcamp", "skipped"],
        ["soundcloud-direct-downloads", "skipped"]
      ]);
      expect(
        attempts.some((attempt) => attempt.providerKey === "track-matcher")
      ).toBe(false);
    } finally {
      runStore.close();
      tempWorkspace.cleanup();
    }
  });

  it("resolves the Spotify happy-path fixture through the live orchestration path when e2e fixture mode is enabled", async () => {
    const tempWorkspace = createTempWorkspace();
    const runStore = createRunStore({ databasePath: tempWorkspace.databasePath });
    const originalFixtureMode = process.env.MUSIC_DOWNLOADER_E2E_FIXTURES;

    process.env.MUSIC_DOWNLOADER_E2E_FIXTURES = "1";

    try {
      const run = await submitLiveRunFromPlaylistUrl(
        "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9",
        {
          runStore,
          workspaceRoot: tempWorkspace.workspaceRoot
        }
      );

      expect(run.playlistTitle).toBe("Warehouse Starters");
      expect(run.status).toBe("completed");
      expect(run.tracks.map((track) => [track.sourcePosition, track.status])).toEqual([
        [1, "acquired"],
        [2, "acquired"]
      ]);
      expect([...run.artifacts.map((artifact) => artifact.kind)].sort()).toEqual([
        "downloads-zip",
        "manifest-json",
        "misses-txt"
      ]);
    } finally {
      if (originalFixtureMode === undefined) {
        delete process.env.MUSIC_DOWNLOADER_E2E_FIXTURES;
      } else {
        process.env.MUSIC_DOWNLOADER_E2E_FIXTURES = originalFixtureMode;
      }

      runStore.close();
      tempWorkspace.cleanup();
    }
  });

  it("resolves the SoundCloud review-lane fixture through the live orchestration path when e2e fixture mode is enabled", async () => {
    const tempWorkspace = createTempWorkspace();
    const runStore = createRunStore({ databasePath: tempWorkspace.databasePath });
    const originalFixtureMode = process.env.MUSIC_DOWNLOADER_E2E_FIXTURES;

    process.env.MUSIC_DOWNLOADER_E2E_FIXTURES = "1";

    try {
      const run = await submitLiveRunFromPlaylistUrl(
        "https://soundcloud.com/dj-nova/sets/warehouse-finds",
        {
          runStore,
          workspaceRoot: tempWorkspace.workspaceRoot
        }
      );

      expect(run.playlistTitle).toBe("Warehouse Finds");
      expect(run.status).toBe("awaiting-approval");
      expect(run.artifacts).toEqual([]);
      expect(run.tracks.map((track) => [track.sourcePosition, track.status])).toEqual([
        [1, "awaiting-approval"],
        [2, "awaiting-approval"]
      ]);
      expect(
        run.reviewQueue.map((review) => [
          review.candidateId,
          review.queueName,
          review.status
        ])
      ).toEqual([
        ["beatport-warehouse tool", "beatport-review", "queued"],
        ["beatport-loft shaker", "beatport-review", "queued"]
      ]);
    } finally {
      if (originalFixtureMode === undefined) {
        delete process.env.MUSIC_DOWNLOADER_E2E_FIXTURES;
      } else {
        process.env.MUSIC_DOWNLOADER_E2E_FIXTURES = originalFixtureMode;
      }

      runStore.close();
      tempWorkspace.cleanup();
    }
  });

  it("marks the run failed when automatic providers end with a retryable provider rejection", async () => {
    const tempWorkspace = createTempWorkspace();
    const runStore = createRunStore({ databasePath: tempWorkspace.databasePath });

    const soundCloudProvider = defineAutomaticProvider({
      id: "soundcloud-direct-downloads",
      displayName: "SoundCloud Direct Downloads",
      sourceBasis: "uploader-enabled-download",
      priceTier: "free",
      priorityRank: 10,
      supportedFormats: ["original-upload-format"],
      search: async () =>
        buildProviderRejectedResult({
          detail:
            "SoundCloud provider session expired before automatic acquisition could continue.",
          providerId: "soundcloud-direct-downloads",
          providerName: "SoundCloud Direct Downloads",
          reason: "provider-session-expired"
        }),
      acquire: async () => {
        throw new Error("SoundCloud acquire should not run after a rejection.");
      }
    });
    const bandcampProvider = defineAutomaticProvider({
      id: "bandcamp",
      displayName: "Bandcamp",
      sourceBasis: "rights-holder-storefront",
      priceTier: "free-or-owned",
      priorityRank: 20,
      supportedFormats: ["mp3", "wav"],
      search: async () =>
        buildProviderMissResult({
          detail: "No Bandcamp result matched the requested track.",
          providerId: "bandcamp",
          providerName: "Bandcamp",
          reason: "no-search-results",
          trackMissReason: "no-supported-source-match"
        }),
      acquire: async () => {
        throw new Error("Bandcamp acquire should not run after a miss.");
      }
    });

    try {
      const run = await submitLiveRunFromPlaylistUrl(
        "https://soundcloud.com/dj-nova/sets/warehouse-finds",
        {
          createRunFromPlaylistUrl: async (playlistUrl) =>
            createStubRun(runStore, playlistUrl, [
              {
                artist: "Anyma",
                sourcePosition: 1,
                title: "Consciousness",
                version: "Extended Mix"
              }
            ]),
          providerRegistry: createStubRegistry([soundCloudProvider, bandcampProvider]),
          runStore,
          workspaceRoot: tempWorkspace.workspaceRoot
        }
      );

      expect(run.status).toBe("failed");
      expect(run.artifacts).toEqual([]);
      expect(run.tracks.map((track) => [track.sourcePosition, track.status])).toEqual([
        [1, "failed"]
      ]);

      const attempts = runStore.listRunTrackAttempts(run.id);

      expect(attempts.map((attempt) => [attempt.providerKey, attempt.outcome])).toEqual([
        ["bandcamp", "skipped"],
        ["soundcloud-direct-downloads", "failed"]
      ]);
      expect(
        attempts.find((attempt) => attempt.providerKey === "soundcloud-direct-downloads")?.note
      ).toContain("provider session expired");
    } finally {
      runStore.close();
      tempWorkspace.cleanup();
    }
  });
});
