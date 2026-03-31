import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  buildAcquiredArtifactSourceNote,
  buildMissedArtifactSourceNote,
  generateRunArtifacts
} from "@/features/artifacts/run-artifacts";
import {
  ProviderRegistry,
  buildProviderMissResult,
  defineAutomaticProvider,
  defineReviewQueueProvider,
  type ProviderArtifactFormat,
  type ProviderAuthorizationBasis,
  type ProviderCandidate,
  type ProviderPriceTier
} from "@/features/providers/provider-registry";
import {
  createRunStore,
  getRunStore,
  resetRunStoreForTests,
  type ReplaceRunTrackInput,
  type RunDetail,
  type RunStore
} from "@/features/runs/run-store";
import type { CanonicalTrack } from "@/features/tracks/canonical-track";

export const e2eFixtureScenarios = [
  "resume-matching",
  "soundcloud-miss-heavy",
  "spotify-happy-path"
] as const;

export type E2eFixtureScenario = (typeof e2eFixtureScenarios)[number];

const SPOTIFY_HAPPY_PATH_URL =
  "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9";
const SOUNDCLOUD_MISS_HEAVY_URL =
  "https://soundcloud.com/dj-nova/sets/warehouse-finds";

type FixturePlaylistSnapshot = {
  playlistTitle: string | null;
  playlistUrl: string;
  tracks: ReplaceRunTrackInput[];
};

export function isE2eFixtureModeEnabled() {
  return process.env.MUSIC_DOWNLOADER_E2E_FIXTURES === "1";
}

export function resolveE2eFixturePlaylistSnapshot(
  playlistUrl: string
): FixturePlaylistSnapshot | null {
  if (!isE2eFixtureModeEnabled()) {
    return null;
  }

  if (playlistUrl === SPOTIFY_HAPPY_PATH_URL) {
    return {
      playlistTitle: "Warehouse Starters",
      playlistUrl: SPOTIFY_HAPPY_PATH_URL,
      tracks: buildSpotifyHappyPathTracks()
    };
  }

  if (playlistUrl === SOUNDCLOUD_MISS_HEAVY_URL) {
    return {
      playlistTitle: "Warehouse Finds",
      playlistUrl: SOUNDCLOUD_MISS_HEAVY_URL,
      tracks: buildSoundCloudReviewLaneTracks()
    };
  }

  return null;
}

export function createE2eFixtureProviderRegistry(
  input: {
    workspaceRoot?: string;
  } = {}
) {
  if (!isE2eFixtureModeEnabled()) {
    return null;
  }

  const workspaceRoot = resolveWorkspaceRoot(input.workspaceRoot);

  const soundCloudProvider = defineAutomaticProvider({
    id: "soundcloud-direct-downloads",
    displayName: "SoundCloud Direct Downloads",
    authorizationBasis: "uploader-enabled-download",
    priceTier: "free",
    priorityRank: 10,
    supportedFormats: ["original-upload-format"],
    search: async ({ track }) => {
      if (
        track.primaryArtist === "Anyma" &&
        track.title === "Consciousness" &&
        track.mix.displayLabel === "Extended Mix"
      ) {
        return {
          outcome: "candidates" as const,
          candidates: [
            buildFixtureCandidate({
              authorizationBasis: "uploader-enabled-download",
              availableFormats: ["mp3"],
              candidateId: "soundcloud-201",
              durationSeconds: 392,
              priceTier: "free",
              providerId: "soundcloud-direct-downloads",
              providerName: "SoundCloud Direct Downloads",
              providerUrl: "https://soundcloud.com/anyma/consciousness",
              track
            })
          ]
        };
      }

      return buildFixtureSearchMiss({
        detail: "No uploader-enabled download matched this track on SoundCloud.",
        providerId: "soundcloud-direct-downloads",
        providerName: "SoundCloud Direct Downloads"
      });
    },
    acquire: async ({ candidate, track }) => {
      if (track.title !== "Consciousness") {
        return buildFixtureSearchMiss({
          detail: "Fixture acquisition only covers the Consciousness happy-path track.",
          providerId: "soundcloud-direct-downloads",
          providerName: "SoundCloud Direct Downloads"
        });
      }

      return {
        outcome: "acquired" as const,
        artifact: writeFixtureArtifact({
          contents: "fixture consciousness payload\n",
          fileName: "anyma-consciousness-extended-mix.mp3",
          workspaceRoot
        }),
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
    supportedFormats: ["mp3", "wav", "flac"],
    search: async ({ track }) => {
      if (track.primaryArtist === "Kx5" && track.title === "Escape") {
        return {
          outcome: "candidates" as const,
          candidates: [
            buildFixtureCandidate({
              authorizationBasis: "rights-holder-storefront",
              availableFormats: ["mp3", "wav"],
              candidateId: "bandcamp-301",
              durationSeconds: 301,
              priceTier: "free-or-owned",
              providerId: "bandcamp",
              providerName: "Bandcamp",
              providerUrl: "https://artist.bandcamp.com/track/escape",
              track
            })
          ]
        };
      }

      return buildFixtureSearchMiss({
        detail: "No Bandcamp result matched the requested track.",
        providerId: "bandcamp",
        providerName: "Bandcamp"
      });
    },
    acquire: async ({ candidate, track }) => {
      if (track.title !== "Escape") {
        return buildFixtureSearchMiss({
          detail: "Fixture acquisition only covers the Escape fallback track.",
          providerId: "bandcamp",
          providerName: "Bandcamp"
        });
      }

      return {
        outcome: "acquired" as const,
        artifact: writeFixtureArtifact({
          contents: "fixture escape payload\n",
          fileName: "kx5-escape.mp3",
          workspaceRoot
        }),
        candidate
      };
    }
  });

  const beatportProvider = defineReviewQueueProvider({
    id: "beatport",
    displayName: "Beatport",
    authorizationBasis: "purchase-entitlement",
    priorityRank: 90,
    supportedFormats: ["mp3", "wav", "aiff"],
    search: async ({ track }) => {
      if (
        (track.primaryArtist === "DJ Sealer" &&
          track.title === "Warehouse Tool" &&
          track.mix.displayLabel === "Extended Mix") ||
        (track.primaryArtist === "Selector Two" && track.title === "Loft Shaker")
      ) {
        return {
          outcome: "candidates" as const,
          candidates: [
            buildFixtureCandidate({
              authorizationBasis: "purchase-entitlement",
              availableFormats: ["mp3", "wav"],
              candidateId: `beatport-${track.normalizedTitle}`,
              durationSeconds: track.durationSeconds ?? 301,
              priceTier: "paid",
              providerId: "beatport",
              providerName: "Beatport",
              providerUrl: `https://www.beatport.com/track/${track.normalizedTitle.replace(/\s+/g, "-")}/queue`,
              track
            })
          ]
        };
      }

      return buildFixtureSearchMiss({
        detail: "No Beatport review candidate matched this fixture track.",
        providerId: "beatport",
        providerName: "Beatport"
      });
    },
    queueForReview: async ({ candidate }) => ({
      outcome: "queued-for-review" as const,
      candidate,
      review: {
        queueName: "beatport-review",
        summary: "Queued after all automatic free-source providers missed."
      }
    })
  });

  return new ProviderRegistry([
    soundCloudProvider,
    bandcampProvider,
    beatportProvider
  ]);
}

export async function seedE2eScenario(
  scenario: E2eFixtureScenario,
  input: {
    runStore?: RunStore;
    workspaceRoot?: string;
  } = {}
) {
  const workspaceRoot = resolveWorkspaceRoot(input.workspaceRoot);
  const runStore = input.runStore ?? getRunStore();

  switch (scenario) {
    case "spotify-happy-path":
      return seedSpotifyHappyPath({ runStore, workspaceRoot });
    case "soundcloud-miss-heavy":
      return seedSoundCloudMissHeavy({ runStore });
    case "resume-matching":
      return seedResumeMatching({ runStore });
    default:
      throw new Error(`Unsupported e2e fixture scenario: ${scenario}`);
  }
}

export function resetE2eFixtureState() {
  const workspaceRoot = resolveWorkspaceRoot();
  const databasePath = resolveDatabasePath(workspaceRoot);

  ensureFixtureEnvironment(workspaceRoot);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });

  const bootStore = createRunStore({ databasePath });

  bootStore.close();
  clearFixtureDatabase(databasePath);
  rmSync(path.join(workspaceRoot, "downloads"), {
    force: true,
    recursive: true
  });
  rmSync(path.join(workspaceRoot, "data", "runs"), {
    force: true,
    recursive: true
  });

  resetRunStoreForTests();
  getRunStore();
}

export function restartE2eRunStore() {
  const workspaceRoot = resolveWorkspaceRoot();
  const databasePath = resolveDatabasePath(workspaceRoot);

  ensureFixtureEnvironment(workspaceRoot);
  resetRunStoreForTests();

  const bootStore = createRunStore({ databasePath });
  const runCount = bootStore.listRuns().length;

  bootStore.close();

  return { runCount };
}

function ensureFixtureEnvironment(workspaceRoot = resolveWorkspaceRoot()) {
  process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT = workspaceRoot;
  process.env.MUSIC_DOWNLOADER_DB_PATH = resolveDatabasePath(workspaceRoot);
}

function resolveWorkspaceRoot(workspaceRoot?: string) {
  return (
    workspaceRoot ??
    process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT ??
    path.join(process.cwd(), ".e2e", "runtime")
  );
}

function resolveDatabasePath(workspaceRoot: string) {
  return (
    process.env.MUSIC_DOWNLOADER_DB_PATH ??
    path.join(workspaceRoot, "data", "music-downloader.sqlite")
  );
}

function clearFixtureDatabase(databasePath: string) {
  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA foreign_keys = ON");
  database.exec("BEGIN");

  try {
    database.exec("DELETE FROM acquisition_attempts");
    database.exec("DELETE FROM run_track_reviews");
    database.exec("DELETE FROM run_artifacts");
    database.exec("DELETE FROM run_tracks");
    database.exec("DELETE FROM runs");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

async function seedSpotifyHappyPath(input: {
  runStore: RunStore;
  workspaceRoot: string;
}) {
  const run = input.runStore.createRun({
    playlistTitle: "Warehouse Starters",
    playlistUrl: SPOTIFY_HAPPY_PATH_URL,
    sourceType: "spotify"
  });
  const tracks = input.runStore.replaceRunTracks(run.id, buildSpotifyHappyPathTracks());

  input.runStore.transitionRunStatus(run.id, "ingesting");
  input.runStore.transitionRunStatus(run.id, "matching");

  const firstArtifact = writeFixtureArtifact({
    contents: "fixture consciousness payload\n",
    fileName: "anyma-consciousness-extended-mix.mp3",
    workspaceRoot: input.workspaceRoot
  });
  const secondArtifact = writeFixtureArtifact({
    contents: "fixture escape payload\n",
    fileName: "kx5-escape.mp3",
    workspaceRoot: input.workspaceRoot
  });

  input.runStore.updateRunTrackStatus(tracks[0].id, "acquired");
  input.runStore.recordAcquisitionAttempt({
    note: JSON.stringify(
      buildAcquiredArtifactSourceNote({
        artifact: firstArtifact,
        provider: {
          authorizationBasis: "uploader-enabled-download",
          candidateId: "soundcloud-201",
          discoveredVia: "search",
          priceTier: "free",
          providerId: "soundcloud-direct-downloads",
          providerName: "SoundCloud Direct Downloads",
          providerUrl: "https://soundcloud.com/anyma/consciousness"
        },
        selection: {
          details: "Extended Mix matched the highest-priority mix preference.",
          reason: "accepted-extended-mix",
          selectedFormat: "mp3"
        }
      })
    ),
    outcome: "matched",
    providerKey: "soundcloud-direct-downloads",
    runTrackId: tracks[0].id
  });

  input.runStore.updateRunTrackStatus(tracks[1].id, "acquired");
  input.runStore.recordAcquisitionAttempt({
    note: JSON.stringify(
      buildAcquiredArtifactSourceNote({
        artifact: secondArtifact,
        provider: {
          authorizationBasis: "rights-holder-storefront",
          candidateId: "bandcamp-301",
          discoveredVia: "catalog",
          priceTier: "free",
          providerId: "bandcamp",
          providerName: "Bandcamp",
          providerUrl: "https://artist.bandcamp.com/track/escape"
        },
        selection: {
          details:
            "No exact preferred mix existed, so the long base version passed fallback rules.",
          reason: "accepted-base-version-fallback",
          selectedFormat: "mp3"
        }
      })
    ),
    outcome: "matched",
    providerKey: "bandcamp",
    runTrackId: tracks[1].id
  });

  input.runStore.transitionRunStatus(run.id, "packaging");
  await generateRunArtifacts({
    runId: run.id,
    runStore: input.runStore,
    workspaceRoot: input.workspaceRoot
  });
  input.runStore.transitionRunStatus(run.id, "completed");

  return requireRun(input.runStore, run.id);
}

function seedSoundCloudMissHeavy(input: { runStore: RunStore }) {
  const run = input.runStore.createRun({
    playlistTitle: "Warehouse Finds",
    playlistUrl: SOUNDCLOUD_MISS_HEAVY_URL,
    sourceType: "soundcloud"
  });
  const tracks = input.runStore.replaceRunTracks(run.id, [
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
    },
    {
      artist: "Afterhours Unit",
      sourcePosition: 3,
      title: "Rotor Glow"
    }
  ]);

  input.runStore.transitionRunStatus(run.id, "ingesting");
  input.runStore.transitionRunStatus(run.id, "matching");

  input.runStore.updateRunTrackStatus(tracks[1].id, "missed");
  input.runStore.recordAcquisitionAttempt({
    note: JSON.stringify(
      buildMissedArtifactSourceNote({
        miss: {
          detail: "No authorized direct-download source matched the required version.",
          providerId: "track-matcher",
          providerName: "Track matcher",
          reason: "no-authorized-source-match"
        }
      })
    ),
    outcome: "missed",
    providerKey: "track-matcher",
    runTrackId: tracks[1].id
  });

  input.runStore.queueRunTrackReview({
    authorizationBasis: "purchase-entitlement",
    availableFormats: ["mp3", "wav"],
    candidateId: "beatport-queue-1",
    mixLabel: "Extended Mix",
    priceTier: "paid",
    providerKey: "beatport",
    providerName: "Beatport",
    providerUrl: "https://www.beatport.com/track/warehouse-tool/queue-1",
    queueName: "beatport-review",
    runTrackId: tracks[0].id,
    summary: "Queued after all automatic free-source providers missed."
  });
  const rejectedReview = input.runStore.queueRunTrackReview({
    authorizationBasis: "purchase-entitlement",
    availableFormats: ["mp3"],
    candidateId: "beatport-queue-2",
    mixLabel: null,
    priceTier: "paid",
    providerKey: "beatport",
    providerName: "Beatport",
    providerUrl: "https://www.beatport.com/track/rotor-glow/queue-2",
    queueName: "beatport-review",
    runTrackId: tracks[2].id,
    summary: "Queued after all automatic free-source providers missed."
  });

  input.runStore.transitionRunTrackReviewStatus(rejectedReview.id, "rejected");

  return requireRun(input.runStore, run.id);
}

function buildSpotifyHappyPathTracks(): ReplaceRunTrackInput[] {
  return [
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
  ];
}

function buildSoundCloudReviewLaneTracks(): ReplaceRunTrackInput[] {
  return [
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
  ];
}

function seedResumeMatching(input: { runStore: RunStore }) {
  const run = input.runStore.createRun({
    playlistTitle: "Resume Matching Fixture",
    playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DWZxZ8T6qM2Yj",
    sourceType: "spotify"
  });
  const tracks = input.runStore.replaceRunTracks(run.id, [
    {
      artist: "Anyma",
      sourcePosition: 1,
      title: "Pictures Of You",
      version: "Extended Mix"
    },
    {
      artist: "Cassian",
      sourcePosition: 2,
      title: "React"
    }
  ]);

  input.runStore.transitionRunStatus(run.id, "ingesting");
  input.runStore.transitionRunStatus(run.id, "matching");
  input.runStore.updateRunTrackStatus(tracks[0].id, "matched");
  input.runStore.updateRunTrackStatus(tracks[1].id, "failed");

  return requireRun(input.runStore, run.id);
}

function requireRun(runStore: RunStore, runId: string): RunDetail {
  const run = runStore.getRun(runId);

  if (!run) {
    throw new Error(`Fixture run not found after seeding: ${runId}`);
  }

  return run;
}

function buildFixtureCandidate(input: {
  authorizationBasis: ProviderAuthorizationBasis;
  availableFormats: readonly ProviderArtifactFormat[];
  candidateId: string;
  durationSeconds: number;
  priceTier: ProviderPriceTier;
  providerId: string;
  providerName: string;
  providerUrl: string;
  track: CanonicalTrack;
}): ProviderCandidate {
  return {
    artistName: input.track.primaryArtist ?? "Unknown Artist",
    authorizationBasis: input.authorizationBasis,
    availableFormats: input.availableFormats,
    candidateId: input.candidateId,
    durationSeconds: input.durationSeconds,
    mixConfidence: input.track.mix.confidence,
    mixLabel: input.track.mix.displayLabel,
    priceTier: input.priceTier,
    providerId: input.providerId,
    providerName: input.providerName,
    provenance: {
      discoveredVia: "search",
      providerTrackId: input.candidateId,
      providerUrl: input.providerUrl,
      searchQuery: [
        input.track.primaryArtist,
        input.track.title,
        input.track.mix.displayLabel
      ]
        .filter(Boolean)
        .join(" ")
    },
    title: input.track.title
  };
}

function buildFixtureSearchMiss(input: {
  detail: string;
  providerId: string;
  providerName: string;
}) {
  return buildProviderMissResult({
    detail: input.detail,
    providerId: input.providerId,
    providerName: input.providerName,
    reason: "no-search-results",
    trackMissReason: "no-authorized-source-match"
  });
}

function writeFixtureArtifact(input: {
  contents: string;
  fileName: string;
  workspaceRoot: string;
}) {
  const artifactDirectory = path.join(input.workspaceRoot, "downloads");
  const absolutePath = path.join(artifactDirectory, input.fileName);
  const fileBuffer = Buffer.from(input.contents, "utf8");

  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(absolutePath, fileBuffer);

  return {
    contentType: "audio/mpeg",
    fileExtension: "mp3",
    fileName: input.fileName,
    format: "mp3" as const,
    localFilePath: absolutePath,
    sha256: createHash("sha256").update(fileBuffer).digest("hex"),
    sizeBytes: fileBuffer.length
  };
}
