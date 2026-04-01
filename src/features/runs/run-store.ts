import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  buildAcquiredArtifactSourceNote,
  buildMissedArtifactSourceNote
} from "@/features/artifacts/run-track-artifact-source-note";
import type {
  ProviderArtifactMetadata,
  ProviderArtifactFormat,
  ProviderSourceBasis,
  ProviderPriceTier
} from "@/features/providers/provider-registry";
import type {
  TrackAcceptedDecision,
  TrackAudioFormat
} from "@/features/tracks/canonical-track";

export const runStatuses = [
  "queued",
  "ingesting",
  "matching",
  "awaiting-approval",
  "packaging",
  "completed",
  "failed"
] as const;

export const runTrackStatuses = [
  "queued",
  "matched",
  "awaiting-approval",
  "acquired",
  "missed",
  "failed"
] as const;

export const runTrackReviewStatuses = [
  "queued",
  "approved",
  "rejected",
  "purchased"
] as const;

export type PlaylistSource = "spotify" | "soundcloud";
export type RunStatus = (typeof runStatuses)[number];
export type RunTrackStatus = (typeof runTrackStatuses)[number];
export type RunTrackReviewStatus = (typeof runTrackReviewStatuses)[number];
export type ArtifactKind =
  | "downloads-zip"
  | "manifest-json"
  | "misses-txt"
  | "run-report";
export type AcquisitionAttemptOutcome =
  | "matched"
  | "missed"
  | "skipped"
  | "failed"
  | "purchased";

type RunRow = {
  id: string;
  source_type: PlaylistSource;
  playlist_url: string;
  playlist_title: string | null;
  status: RunStatus;
  resume_after_status: RunStatus | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  failed_at: string | null;
};

type RunTrackRow = {
  id: string;
  run_id: string;
  source_position: number;
  source_track_id: string | null;
  artist: string;
  title: string;
  version: string | null;
  status: RunTrackStatus;
  created_at: string;
  updated_at: string;
};

type RunArtifactRow = {
  id: string;
  run_id: string;
  artifact_kind: ArtifactKind;
  relative_path: string;
  created_at: string;
};

type AcquisitionAttemptRow = {
  created_at: string;
  id: string;
  note: string | null;
  outcome: AcquisitionAttemptOutcome;
  provider_key: string;
  run_track_id: string;
};

type RunTrackReviewRow = {
  source_basis: ProviderSourceBasis;
  available_formats: string;
  candidate_id: string;
  created_at: string;
  id: string;
  mix_label: string | null;
  price_tier: ProviderPriceTier;
  provider_key: string;
  provider_name: string;
  provider_url: string | null;
  queue_name: string;
  run_track_id: string;
  status: RunTrackReviewStatus;
  summary: string;
  updated_at: string;
};

export type RunSummary = {
  id: string;
  sourceType: PlaylistSource;
  playlistUrl: string;
  playlistTitle: string | null;
  status: RunStatus;
  resumeAfterStatus: RunStatus | null;
  createdAt: string;
  updatedAt: string;
  trackCount: number;
  artifactCount: number;
};

export type RunTrack = {
  id: string;
  runId: string;
  sourcePosition: number;
  sourceTrackId: string | null;
  artist: string;
  title: string;
  version: string | null;
  status: RunTrackStatus;
  createdAt: string;
  updatedAt: string;
};

export type RunArtifact = {
  id: string;
  runId: string;
  kind: ArtifactKind;
  relativePath: string;
  createdAt: string;
};

export type RunTrackAcquisitionAttempt = {
  createdAt: string;
  id: string;
  note: string | null;
  outcome: AcquisitionAttemptOutcome;
  providerKey: string;
  runTrackId: string;
};

export type RunTrackReview = {
  sourceBasis: ProviderSourceBasis;
  availableFormats: ProviderArtifactFormat[];
  candidateId: string;
  createdAt: string;
  id: string;
  mixLabel: string | null;
  priceTier: ProviderPriceTier;
  providerKey: string;
  providerName: string;
  providerUrl: string | null;
  queueName: string;
  runTrackId: string;
  status: RunTrackReviewStatus;
  summary: string;
  updatedAt: string;
};

export type RunDetail = RunSummary & {
  tracks: RunTrack[];
  artifacts: RunArtifact[];
  reviewQueue: RunTrackReview[];
};

export type RunStatusSnapshot = Pick<
  RunSummary,
  | "id"
  | "status"
  | "resumeAfterStatus"
  | "updatedAt"
  | "trackCount"
  | "artifactCount"
>;

export type CreateRunInput = {
  playlistUrl: string;
  sourceType: PlaylistSource;
  playlistTitle?: string | null;
};

export type ReplaceRunTrackInput = {
  sourcePosition: number;
  artist: string;
  title: string;
  status?: RunTrackStatus;
  sourceTrackId?: string | null;
  version?: string | null;
};

export type RecordAcquisitionAttemptInput = {
  providerKey: string;
  outcome: AcquisitionAttemptOutcome;
  note?: string | null;
  runTrackId: string;
};

export type RecordRunArtifactInput = {
  kind: ArtifactKind;
  relativePath: string;
  runId: string;
};

export type QueueRunTrackReviewInput = {
  sourceBasis: ProviderSourceBasis;
  availableFormats: ProviderArtifactFormat[];
  candidateId: string;
  mixLabel?: string | null;
  priceTier: ProviderPriceTier;
  providerKey: string;
  providerName: string;
  providerUrl?: string | null;
  queueName: string;
  runTrackId: string;
  summary: string;
};

export type CompletePurchasedRunTrackReviewInput = {
  artifact: ProviderArtifactMetadata;
  reviewId: string;
};

type RunAggregateRow = RunRow & {
  artifact_count: number;
  track_count: number;
};

type RunStoreOptions = {
  databasePath?: string;
};

export type RunStore = ReturnType<typeof createRunStore>;

const allowedRunStatusTransitions: Record<RunStatus, RunStatus[]> = {
  queued: ["ingesting", "failed"],
  ingesting: ["matching", "failed"],
  matching: ["awaiting-approval", "packaging", "failed"],
  "awaiting-approval": ["packaging", "failed"],
  packaging: ["completed", "failed"],
  completed: [],
  failed: ["queued"]
};

const resumableRunStatuses: RunStatus[] = ["ingesting", "matching", "packaging"];
const allowedRunTrackReviewStatusTransitions: Record<
  RunTrackReviewStatus,
  RunTrackReviewStatus[]
> = {
  approved: ["rejected"],
  purchased: [],
  queued: ["approved", "rejected"],
  rejected: []
};

const migrations = [
  {
    name: "0001-initial",
    path: path.join(process.cwd(), "src/features/runs/migrations/0001-initial.sql")
  },
  {
    name: "0002-run-track-review-queue",
    path: path.join(
      process.cwd(),
      "src/features/runs/migrations/0002-run-track-review-queue.sql"
    )
  },
  {
    name: "0003-run-track-review-source-basis",
    path: path.join(
      process.cwd(),
      "src/features/runs/migrations/0003-run-track-review-source-basis.sql"
    )
  }
] as const;

let defaultRunStore: ReturnType<typeof createRunStore> | null = null;

function getDefaultDatabasePath() {
  return (
    process.env.MUSIC_DOWNLOADER_DB_PATH ??
    path.join(process.cwd(), "data", "music-downloader.sqlite")
  );
}

function getTimestamp() {
  return new Date().toISOString();
}

function assertValidRunTrackStatus(
  status: string
): asserts status is RunTrackStatus {
  if (!runTrackStatuses.includes(status as RunTrackStatus)) {
    throw new Error(`Unsupported run track status: ${status}`);
  }
}

function assertValidRunTrackReviewStatus(
  status: string
): asserts status is RunTrackReviewStatus {
  if (!runTrackReviewStatuses.includes(status as RunTrackReviewStatus)) {
    throw new Error(`Unsupported run track review status: ${status}`);
  }
}

function mapRunTrack(row: RunTrackRow): RunTrack {
  return {
    artist: row.artist,
    createdAt: row.created_at,
    id: row.id,
    runId: row.run_id,
    sourcePosition: row.source_position,
    sourceTrackId: row.source_track_id,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
    version: row.version
  };
}

function mapRunArtifact(row: RunArtifactRow): RunArtifact {
  return {
    createdAt: row.created_at,
    id: row.id,
    kind: row.artifact_kind,
    relativePath: row.relative_path,
    runId: row.run_id
  };
}

function mapRunTrackAcquisitionAttempt(
  row: AcquisitionAttemptRow
): RunTrackAcquisitionAttempt {
  return {
    createdAt: row.created_at,
    id: row.id,
    note: row.note,
    outcome: row.outcome,
    providerKey: row.provider_key,
    runTrackId: row.run_track_id
  };
}

function mapRunTrackReview(row: RunTrackReviewRow): RunTrackReview {
  return {
    sourceBasis: row.source_basis,
    availableFormats: JSON.parse(row.available_formats) as ProviderArtifactFormat[],
    candidateId: row.candidate_id,
    createdAt: row.created_at,
    id: row.id,
    mixLabel: row.mix_label,
    priceTier: row.price_tier,
    providerKey: row.provider_key,
    providerName: row.provider_name,
    providerUrl: row.provider_url,
    queueName: row.queue_name,
    runTrackId: row.run_track_id,
    status: row.status,
    summary: row.summary,
    updatedAt: row.updated_at
  };
}

function mapRunSummary(row: RunAggregateRow): RunSummary {
  return {
    artifactCount: Number(row.artifact_count),
    createdAt: row.created_at,
    id: row.id,
    playlistTitle: row.playlist_title,
    playlistUrl: row.playlist_url,
    resumeAfterStatus: row.resume_after_status,
    sourceType: row.source_type,
    status: row.status,
    trackCount: Number(row.track_count),
    updatedAt: row.updated_at
  };
}

function ensureAllowedTransition(currentStatus: RunStatus, nextStatus: RunStatus) {
  if (!allowedRunStatusTransitions[currentStatus].includes(nextStatus)) {
    throw new Error(
      `Invalid run status transition: ${currentStatus} -> ${nextStatus}`
    );
  }
}

function createMissingDirectories(databasePath: string) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
}

function ensureSchema(database: DatabaseSync) {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  for (const migration of migrations) {
    const migrationAlreadyApplied = database
      .prepare("SELECT name FROM schema_migrations WHERE name = ?")
      .get(migration.name) as { name: string } | undefined;

    if (migrationAlreadyApplied) {
      continue;
    }

    const schemaSql = readFileSync(migration.path, "utf8");

    database.exec("BEGIN");

    try {
      database.exec(schemaSql);
      database
        .prepare(
          "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)"
        )
        .run(migration.name, getTimestamp());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function getRunStore() {
  if (!defaultRunStore) {
    defaultRunStore = createRunStore();
  }

  return defaultRunStore;
}

export function resetRunStoreForTests() {
  if (!defaultRunStore) {
    return;
  }

  defaultRunStore.close();
  defaultRunStore = null;
}

export function createRunStore(options: RunStoreOptions = {}) {
  const databasePath = options.databasePath ?? getDefaultDatabasePath();

  createMissingDirectories(databasePath);

  const database = new DatabaseSync(databasePath);

  ensureSchema(database);

  function readRunTrack(trackId: string) {
    return database
      .prepare("SELECT * FROM run_tracks WHERE id = ?")
      .get(trackId) as RunTrackRow | undefined;
  }

  function readRunTrackReview(reviewId: string) {
    return database
      .prepare("SELECT * FROM run_track_reviews WHERE id = ?")
      .get(reviewId) as RunTrackReviewRow | undefined;
  }

  function readRunAggregate(runId: string) {
    return database
      .prepare(
        `
          SELECT
            runs.*,
            (
              SELECT COUNT(*)
              FROM run_tracks
              WHERE run_tracks.run_id = runs.id
            ) AS track_count,
            (
              SELECT COUNT(*)
              FROM run_artifacts
              WHERE run_artifacts.run_id = runs.id
            ) AS artifact_count
          FROM runs
          WHERE runs.id = ?
        `
      )
      .get(runId) as RunAggregateRow | undefined;
  }

  function getRunOrThrow(runId: string) {
    const run = readRunAggregate(runId);

    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    return run;
  }

  function updateRunStatusDirect(
    runId: string,
    currentStatus: RunStatus,
    nextStatus: RunStatus,
    now: string
  ) {
    if (currentStatus === nextStatus) {
      return;
    }

    ensureAllowedTransition(currentStatus, nextStatus);

    database
      .prepare(
        `
          UPDATE runs
          SET status = ?,
              resume_after_status = ?,
              updated_at = ?,
              completed_at = ?,
              failed_at = ?
          WHERE id = ?
        `
      )
      .run(nextStatus, null, now, null, null, runId);
  }

  function insertAcquisitionAttemptDirect(input: {
    note?: string | null;
    now: string;
    outcome: AcquisitionAttemptOutcome;
    providerKey: string;
    runTrackId: string;
  }) {
    database
      .prepare(
        `
          INSERT INTO acquisition_attempts (
            id,
            run_track_id,
            provider_key,
            outcome,
            note,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        crypto.randomUUID(),
        input.runTrackId,
        input.providerKey,
        input.outcome,
        input.note ?? null,
        input.now
      );
  }

  function buildRejectedReviewMissNote(review: RunTrackReviewRow) {
    return JSON.stringify(
      buildMissedArtifactSourceNote({
        miss: {
          detail: `Rejected during ${review.provider_name} paid review.`,
          providerId: review.provider_key,
          providerName: review.provider_name,
          reason: "paid-review-rejected"
        }
      })
    );
  }

  function buildPurchasedReviewAcquisitionNote(
    review: RunTrackReviewRow,
    artifact: ProviderArtifactMetadata
  ) {
    return JSON.stringify(
      buildAcquiredArtifactSourceNote({
        artifact,
        provider: {
          sourceBasis: review.source_basis,
          priceTier: review.price_tier,
          providerId: review.provider_key,
          providerName: review.provider_name,
          providerUrl: review.provider_url
        },
        selection: {
          details:
            "Beatport paid review confirmed the owned download and captured it for packaging.",
          reason: resolvePurchasedReviewSelectionReason(review.mix_label),
          selectedFormat: resolvePurchasedReviewSelectedFormat(
            artifact.format,
            review.available_formats
          )
        }
      })
    );
  }

  function resolvePurchasedReviewSelectionReason(
    mixLabel: string | null
  ): TrackAcceptedDecision["reason"] {
    const normalizedMixLabel = mixLabel?.trim().toLowerCase();

    if (normalizedMixLabel === "extended mix") {
      return "accepted-extended-mix";
    }

    if (normalizedMixLabel === "original mix") {
      return "accepted-original-mix";
    }

    return "accepted-base-version-fallback";
  }

  function resolvePurchasedReviewSelectedFormat(
    artifactFormat: ProviderArtifactFormat,
    availableFormats: string
  ): TrackAudioFormat | null {
    if (artifactFormat === "mp3" || artifactFormat === "wav") {
      return artifactFormat;
    }

    const candidateFormat = (JSON.parse(availableFormats) as ProviderArtifactFormat[]).find(
      (format): format is TrackAudioFormat => format === "mp3" || format === "wav"
    );

    return candidateFormat ?? null;
  }

  function syncRunStatusForReviewQueue(runId: string, now: string) {
    const currentRun = getRunOrThrow(runId);
    const unresolvedReviews = database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM run_track_reviews
          INNER JOIN run_tracks
            ON run_tracks.id = run_track_reviews.run_track_id
          WHERE run_tracks.run_id = ?
            AND run_track_reviews.status IN ('queued', 'approved')
        `
      )
      .get(runId) as { count: number };

    if (unresolvedReviews.count > 0) {
      if (currentRun.status === "matching") {
        updateRunStatusDirect(runId, currentRun.status, "awaiting-approval", now);
      }

      return;
    }

    if (currentRun.status === "awaiting-approval") {
      updateRunStatusDirect(runId, currentRun.status, "packaging", now);
    }
  }

  function requeueInterruptedRuns() {
    const now = getTimestamp();
    const runsToResume = database
      .prepare(
        `
          SELECT id, status
          FROM runs
          WHERE status IN (?, ?, ?)
        `
      )
      .all(...resumableRunStatuses) as Array<{
      id: string;
      status: RunStatus;
    }>;

    const updateStatement = database.prepare(
      `
        UPDATE runs
        SET status = ?,
            resume_after_status = ?,
            updated_at = ?,
            completed_at = ?,
            failed_at = ?
        WHERE id = ?
      `
    );

    for (const run of runsToResume) {
      updateStatement.run("queued", run.status, now, null, null, run.id);
    }

    return runsToResume.length;
  }

  requeueInterruptedRuns();

  return {
    close() {
      database.close();
    },

    createRun(input: CreateRunInput): RunDetail {
      const now = getTimestamp();
      const id = crypto.randomUUID();

      database
        .prepare(
          `
            INSERT INTO runs (
              id,
              source_type,
              playlist_url,
              playlist_title,
              status,
              resume_after_status,
              created_at,
              updated_at,
              completed_at,
              failed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          id,
          input.sourceType,
          input.playlistUrl,
          input.playlistTitle ?? null,
          "queued",
          null,
          now,
          now,
          null,
          null
        );

      const run = this.getRun(id);

      if (!run) {
        throw new Error(`Run not found after creation: ${id}`);
      }

      return run;
    },

    getRun(runId: string): RunDetail | null {
      const row = readRunAggregate(runId);

      if (!row) {
        return null;
      }

      const tracks = database
        .prepare(
          `
            SELECT *
            FROM run_tracks
            WHERE run_id = ?
            ORDER BY source_position ASC
          `
        )
        .all(runId) as RunTrackRow[];
      const artifacts = database
        .prepare(
          `
            SELECT *
            FROM run_artifacts
            WHERE run_id = ?
            ORDER BY created_at ASC
          `
        )
        .all(runId) as RunArtifactRow[];
      const reviewQueue = database
        .prepare(
          `
            SELECT run_track_reviews.*
            FROM run_track_reviews
            INNER JOIN run_tracks
              ON run_tracks.id = run_track_reviews.run_track_id
            WHERE run_tracks.run_id = ?
            ORDER BY
              CASE run_track_reviews.status
                WHEN 'queued' THEN 0
                WHEN 'approved' THEN 1
                WHEN 'purchased' THEN 2
                ELSE 3
              END,
              run_tracks.source_position ASC,
              run_track_reviews.created_at ASC
          `
        )
        .all(runId) as RunTrackReviewRow[];

      return {
        ...mapRunSummary(row),
        artifacts: artifacts.map(mapRunArtifact),
        reviewQueue: reviewQueue.map(mapRunTrackReview),
        tracks: tracks.map(mapRunTrack)
      };
    },

    getRunStatusSnapshot(runId: string): RunStatusSnapshot | null {
      const row = readRunAggregate(runId);

      if (!row) {
        return null;
      }

      const summary = mapRunSummary(row);

      return {
        artifactCount: summary.artifactCount,
        id: summary.id,
        resumeAfterStatus: summary.resumeAfterStatus,
        status: summary.status,
        trackCount: summary.trackCount,
        updatedAt: summary.updatedAt
      };
    },

    listQueuedRunIds(): string[] {
      const rows = database
        .prepare(
          `
            SELECT id
            FROM runs
            WHERE status = 'queued'
            ORDER BY updated_at ASC, created_at ASC
          `
        )
        .all() as Array<{ id: string }>;

      return rows.map((row) => row.id);
    },

    listRuns(limit = 10): RunSummary[] {
      const rows = database
        .prepare(
          `
            SELECT
              runs.*,
              (
                SELECT COUNT(*)
                FROM run_tracks
                WHERE run_tracks.run_id = runs.id
              ) AS track_count,
              (
                SELECT COUNT(*)
                FROM run_artifacts
                WHERE run_artifacts.run_id = runs.id
              ) AS artifact_count
            FROM runs
            ORDER BY updated_at DESC, created_at DESC
            LIMIT ?
          `
        )
        .all(limit) as RunAggregateRow[];

      return rows.map(mapRunSummary);
    },

    recordAcquisitionAttempt(input: RecordAcquisitionAttemptInput) {
      const now = getTimestamp();
      const id = crypto.randomUUID();

      database
        .prepare(
          `
            INSERT INTO acquisition_attempts (
              id,
              run_track_id,
              provider_key,
              outcome,
              note,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          id,
          input.runTrackId,
          input.providerKey,
          input.outcome,
          input.note ?? null,
          now
        );

      return id;
    },

    queueRunTrackReview(input: QueueRunTrackReviewInput) {
      if (input.priceTier !== "paid") {
        throw new Error(
          `Run track reviews only support paid fallback providers: ${input.providerKey}`
        );
      }

      const track = readRunTrack(input.runTrackId);

      if (!track) {
        throw new Error(`Run track not found: ${input.runTrackId}`);
      }

      const run = getRunOrThrow(track.run_id);

      if (run.status !== "matching" && run.status !== "awaiting-approval") {
        throw new Error(
          `Run track reviews can only be queued while matching or awaiting approval: ${run.status}`
        );
      }

      const existingReview = database
        .prepare(
          `
            SELECT id
            FROM run_track_reviews
            WHERE run_track_id = ?
          `
        )
        .get(input.runTrackId) as { id: string } | undefined;

      if (existingReview) {
        throw new Error(
          `Run track already has a queued paid review candidate: ${input.runTrackId}`
        );
      }

      const now = getTimestamp();
      const id = crypto.randomUUID();

      database.exec("BEGIN");

      try {
        database
          .prepare(
            `
              INSERT INTO run_track_reviews (
                id,
                run_track_id,
                provider_key,
                provider_name,
                provider_url,
                source_basis,
                price_tier,
                candidate_id,
                mix_label,
                available_formats,
                queue_name,
                summary,
                status,
                created_at,
                updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            id,
            input.runTrackId,
            input.providerKey,
            input.providerName,
            input.providerUrl ?? null,
            input.sourceBasis,
            input.priceTier,
            input.candidateId,
            input.mixLabel ?? null,
            JSON.stringify(input.availableFormats),
            input.queueName,
            input.summary,
            "queued",
            now,
            now
          );

        database
          .prepare(
            `
              UPDATE run_tracks
              SET status = ?,
                  updated_at = ?
              WHERE id = ?
            `
          )
          .run("awaiting-approval", now, input.runTrackId);
        database
          .prepare("UPDATE runs SET updated_at = ? WHERE id = ?")
          .run(now, track.run_id);
        syncRunStatusForReviewQueue(track.run_id, now);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      const review = readRunTrackReview(id);

      if (!review) {
        throw new Error(`Run track review not found after insert: ${id}`);
      }

      return mapRunTrackReview(review);
    },

    recordRunArtifact(input: RecordRunArtifactInput) {
      const now = getTimestamp();
      const id = crypto.randomUUID();

      getRunOrThrow(input.runId);

      database
        .prepare(
          `
            INSERT INTO run_artifacts (
              id,
              run_id,
              artifact_kind,
              relative_path,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
          `
        )
        .run(id, input.runId, input.kind, input.relativePath, now);

      database
        .prepare("UPDATE runs SET updated_at = ? WHERE id = ?")
        .run(now, input.runId);

      return this.getRun(input.runId)?.artifacts.at(-1) ?? null;
    },

    replaceRunArtifacts(runId: string, artifacts: RecordRunArtifactInput[]) {
      const now = getTimestamp();

      getRunOrThrow(runId);

      database.exec("BEGIN");

      try {
        const kinds = [...new Set(artifacts.map((artifact) => artifact.kind))];

        if (kinds.length > 0) {
          const placeholders = kinds.map(() => "?").join(", ");

          database
            .prepare(
              `
                DELETE FROM run_artifacts
                WHERE run_id = ?
                  AND artifact_kind IN (${placeholders})
              `
            )
            .run(runId, ...kinds);
        }

        const insertArtifact = database.prepare(
          `
            INSERT INTO run_artifacts (
              id,
              run_id,
              artifact_kind,
              relative_path,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
          `
        );

        for (const artifact of artifacts) {
          insertArtifact.run(
            crypto.randomUUID(),
            artifact.runId,
            artifact.kind,
            artifact.relativePath,
            now
          );
        }

        database
          .prepare("UPDATE runs SET updated_at = ? WHERE id = ?")
          .run(now, runId);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      return this.getRun(runId)?.artifacts ?? [];
    },

    replaceRunTracks(runId: string, tracks: ReplaceRunTrackInput[]): RunTrack[] {
      const now = getTimestamp();

      getRunOrThrow(runId);

      database.exec("BEGIN");

      try {
        database.prepare("DELETE FROM run_tracks WHERE run_id = ?").run(runId);

        const insertTrack = database.prepare(
          `
            INSERT INTO run_tracks (
              id,
              run_id,
              source_position,
              source_track_id,
              artist,
              title,
              version,
              status,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        );

        for (const track of tracks) {
          insertTrack.run(
            crypto.randomUUID(),
            runId,
            track.sourcePosition,
            track.sourceTrackId ?? null,
            track.artist,
            track.title,
            track.version ?? null,
            track.status ?? "queued",
            now,
            now
          );
        }

        database
          .prepare("UPDATE runs SET updated_at = ? WHERE id = ?")
          .run(now, runId);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      return this.getRun(runId)?.tracks ?? [];
    },

    resumeInterruptedRuns() {
      return requeueInterruptedRuns();
    },

    listRunTrackAttempts(runId: string): RunTrackAcquisitionAttempt[] {
      getRunOrThrow(runId);

      const attempts = database
        .prepare(
          `
            SELECT acquisition_attempts.*
            FROM acquisition_attempts
            INNER JOIN run_tracks
              ON run_tracks.id = acquisition_attempts.run_track_id
            WHERE run_tracks.run_id = ?
            ORDER BY acquisition_attempts.created_at DESC, acquisition_attempts.rowid DESC
          `
        )
        .all(runId) as AcquisitionAttemptRow[];

      return attempts.map(mapRunTrackAcquisitionAttempt);
    },

    completePurchasedRunTrackReview(input: CompletePurchasedRunTrackReviewInput) {
      const review = readRunTrackReview(input.reviewId);

      if (!review) {
        throw new Error(`Run track review not found: ${input.reviewId}`);
      }

      if (review.status !== "queued" && review.status !== "approved") {
        throw new Error(
          `Purchased reviews can only be completed from queued or approved status: ${review.status}`
        );
      }

      const track = readRunTrack(review.run_track_id);

      if (!track) {
        throw new Error(`Run track not found: ${review.run_track_id}`);
      }

      const now = getTimestamp();
      const note = buildPurchasedReviewAcquisitionNote(review, input.artifact);

      database.exec("BEGIN");

      try {
        database
          .prepare(
            `
              UPDATE run_track_reviews
              SET status = ?,
                  updated_at = ?
              WHERE id = ?
            `
          )
          .run("purchased", now, input.reviewId);
        database
          .prepare(
            `
              UPDATE run_tracks
              SET status = ?,
                  updated_at = ?
              WHERE id = ?
            `
          )
          .run("acquired", now, track.id);
        insertAcquisitionAttemptDirect({
          note,
          now,
          outcome: "matched",
          providerKey: review.provider_key,
          runTrackId: track.id
        });
        database
          .prepare("UPDATE runs SET updated_at = ? WHERE id = ?")
          .run(now, track.run_id);
        syncRunStatusForReviewQueue(track.run_id, now);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      const updatedReview = readRunTrackReview(input.reviewId);

      if (!updatedReview) {
        throw new Error(`Run track review not found after update: ${input.reviewId}`);
      }

      return mapRunTrackReview(updatedReview);
    },

    transitionRunTrackReviewStatus(
      reviewId: string,
      nextStatus: RunTrackReviewStatus
    ) {
      assertValidRunTrackReviewStatus(nextStatus);

      if (nextStatus === "purchased") {
        throw new Error(
          "Use completePurchasedRunTrackReview to persist a purchased owned-download acquisition."
        );
      }

      const review = readRunTrackReview(reviewId);

      if (!review) {
        throw new Error(`Run track review not found: ${reviewId}`);
      }

      if (!allowedRunTrackReviewStatusTransitions[review.status].includes(nextStatus)) {
        throw new Error(
          `Invalid run track review transition: ${review.status} -> ${nextStatus}`
        );
      }

      const track = readRunTrack(review.run_track_id);

      if (!track) {
        throw new Error(`Run track not found: ${review.run_track_id}`);
      }

      const now = getTimestamp();
      const nextTrackStatus =
        nextStatus === "rejected" ? "missed" : "awaiting-approval";

      database.exec("BEGIN");

      try {
        database
          .prepare(
            `
              UPDATE run_track_reviews
              SET status = ?,
                  updated_at = ?
              WHERE id = ?
            `
          )
          .run(nextStatus, now, reviewId);
        database
          .prepare(
            `
              UPDATE run_tracks
              SET status = ?,
                  updated_at = ?
              WHERE id = ?
            `
          )
          .run(nextTrackStatus, now, track.id);
        if (nextStatus === "rejected") {
          insertAcquisitionAttemptDirect({
            note: buildRejectedReviewMissNote(review),
            now,
            outcome: "missed",
            providerKey: review.provider_key,
            runTrackId: track.id
          });
        }
        database
          .prepare("UPDATE runs SET updated_at = ? WHERE id = ?")
          .run(now, track.run_id);
        syncRunStatusForReviewQueue(track.run_id, now);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }

      const updatedReview = readRunTrackReview(reviewId);

      if (!updatedReview) {
        throw new Error(`Run track review not found after update: ${reviewId}`);
      }

      return mapRunTrackReview(updatedReview);
    },

    transitionRunStatus(runId: string, nextStatus: RunStatus): RunDetail {
      const currentRun = getRunOrThrow(runId);

      ensureAllowedTransition(currentRun.status, nextStatus);

      const now = getTimestamp();
      const completedAt = nextStatus === "completed" ? now : null;
      const failedAt = nextStatus === "failed" ? now : null;
      const resumeAfterStatus = currentRun.resume_after_status;

      database
        .prepare(
          `
            UPDATE runs
            SET status = ?,
                resume_after_status = ?,
                updated_at = ?,
                completed_at = ?,
                failed_at = ?
            WHERE id = ?
          `
        )
        .run(
          nextStatus,
          resumeAfterStatus,
          now,
          completedAt,
          failedAt,
          runId
        );

      const run = this.getRun(runId);

      if (!run) {
        throw new Error(`Run not found after transition: ${runId}`);
      }

      return run;
    },

    resumeRun(runId: string): RunDetail {
      const currentRun = getRunOrThrow(runId);

      if (currentRun.status !== "queued" || !currentRun.resume_after_status) {
        const existingRun = this.getRun(runId);

        if (!existingRun) {
          throw new Error(`Run not found after resume lookup: ${runId}`);
        }

        return existingRun;
      }

      if (!resumableRunStatuses.includes(currentRun.resume_after_status)) {
        throw new Error(
          `Run cannot resume from persisted status: ${currentRun.resume_after_status}`
        );
      }

      const now = getTimestamp();

      database
        .prepare(
          `
            UPDATE runs
            SET status = ?,
                updated_at = ?,
                completed_at = NULL,
                failed_at = NULL
            WHERE id = ?
          `
        )
        .run(currentRun.resume_after_status, now, runId);

      const resumedRun = this.getRun(runId);

      if (!resumedRun) {
        throw new Error(`Run not found after resume: ${runId}`);
      }

      return resumedRun;
    },

    updateRunTrackStatus(trackId: string, nextStatus: RunTrackStatus): RunTrack {
      const track = readRunTrack(trackId);

      if (!track) {
        throw new Error(`Run track not found: ${trackId}`);
      }

      assertValidRunTrackStatus(nextStatus);

      const now = getTimestamp();

      database
        .prepare(
          `
            UPDATE run_tracks
            SET status = ?,
                updated_at = ?
            WHERE id = ?
          `
        )
        .run(nextStatus, now, trackId);
      database
        .prepare("UPDATE runs SET updated_at = ? WHERE id = ?")
        .run(now, track.run_id);

      const updatedTrack = readRunTrack(trackId);

      if (!updatedTrack) {
        throw new Error(`Run track not found after update: ${trackId}`);
      }

      return mapRunTrack(updatedTrack);
    }
  };
}
