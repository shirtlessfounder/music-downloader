/* @vitest-environment node */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  parseRunTrackArtifactSourceNote
} from "@/features/artifacts/run-artifacts";
import {
  buildProviderMissResult,
  defineAutomaticProvider,
  type AutomaticProviderDefinition,
  type ProviderCandidate,
  type ProviderRegistry
} from "@/features/providers/provider-registry";
import { createRunStore, type RunStore, type RunTrack } from "@/features/runs/run-store";

import { submitLiveRunFromPlaylistUrl } from "./live-run-orchestrator";

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

function createStubRegistry(providers: AutomaticProviderDefinition[]) {
  return {
    listAutomatic: () => providers
  } satisfies Pick<ProviderRegistry, "listAutomatic">;
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

describe("submitLiveRunFromPlaylistUrl", () => {
  it("executes automatic providers in priority order, persists selected outcomes, and packages fully auto-resolved runs", async () => {
    const tempWorkspace = createTempWorkspace();
    const runStore = createRunStore({ databasePath: tempWorkspace.databasePath });
    const searchCalls: string[] = [];

    const soundCloudProvider = defineAutomaticProvider({
      id: "soundcloud-direct-downloads",
      displayName: "SoundCloud Direct Downloads",
      authorizationBasis: "uploader-enabled-download",
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
          trackMissReason: "no-authorized-source-match"
        });
      },
      acquire: async () => {
        throw new Error("SoundCloud acquire should not run after a miss.");
      }
    });
    const bandcampProvider = defineAutomaticProvider({
      id: "bandcamp",
      displayName: "Bandcamp",
      authorizationBasis: "rights-holder-storefront",
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

  it("persists unresolved automatic misses without falsely completing or packaging the run", async () => {
    const tempWorkspace = createTempWorkspace();
    const runStore = createRunStore({ databasePath: tempWorkspace.databasePath });

    const soundCloudProvider = defineAutomaticProvider({
      id: "soundcloud-direct-downloads",
      displayName: "SoundCloud Direct Downloads",
      authorizationBasis: "uploader-enabled-download",
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
          trackMissReason: "no-authorized-source-match"
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
      authorizationBasis: "rights-holder-storefront",
      priceTier: "free-or-owned",
      priorityRank: 20,
      supportedFormats: ["mp3", "wav"],
      search: async () =>
        buildProviderMissResult({
          detail: "No Bandcamp result matched the requested track.",
          providerId: "bandcamp",
          providerName: "Bandcamp",
          reason: "no-search-results",
          trackMissReason: "no-authorized-source-match"
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

      expect(run.status).toBe("matching");
      expect(run.artifacts).toEqual([]);
      expect(run.tracks.map((track) => [track.sourcePosition, track.status])).toEqual([
        [1, "acquired"],
        [2, "missed"]
      ]);

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
            reason: "no-authorized-source-match"
          })
        })
      );
    } finally {
      runStore.close();
      tempWorkspace.cleanup();
    }
  });
});
