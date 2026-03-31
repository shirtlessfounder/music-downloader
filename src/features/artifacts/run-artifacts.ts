import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ProviderArtifactFormat,
  ProviderAuthorizationBasis,
  ProviderPriceTier,
  ProviderProvenance
} from "@/features/providers/provider-registry";
import {
  getRunStore,
  type ArtifactKind,
  type RecordRunArtifactInput,
  type RunArtifact,
  type RunStore,
  type RunTrack
} from "@/features/runs/run-store";
import type {
  TrackAcceptedDecision,
  TrackAudioFormat,
  TrackMissReason
} from "@/features/tracks/canonical-track";

export const RUN_TRACK_ARTIFACT_SOURCE_NOTE_SCHEMA =
  "run-track-artifact-source.v1";

const RUN_ARTIFACT_KIND_ORDER: ArtifactKind[] = [
  "downloads-zip",
  "misses-txt",
  "manifest-json",
  "run-report"
];

type ArtifactSourceNoteSchema =
  typeof RUN_TRACK_ARTIFACT_SOURCE_NOTE_SCHEMA;

type ArtifactSourceProviderDiscovery = ProviderProvenance["discoveredVia"];

export type RunTrackArtifactSourceProvider = {
  authorizationBasis: ProviderAuthorizationBasis;
  candidateId?: string | null;
  discoveredVia?: ArtifactSourceProviderDiscovery;
  priceTier: ProviderPriceTier;
  providerId: string;
  providerName: string;
  providerUrl?: string | null;
};

export type RunTrackArtifactSourceSelection = {
  details: string;
  reason: TrackAcceptedDecision["reason"];
  selectedFormat: TrackAudioFormat | null;
};

export type RunTrackArtifactSourceArtifact = {
  contentType?: string | null;
  fileExtension: string | null;
  fileName: string;
  format: ProviderArtifactFormat;
  localFilePath: string;
  sha256?: string | null;
  sizeBytes: number | null;
};

export type RunTrackArtifactSourceMiss = {
  detail: string;
  providerId?: string | null;
  providerName?: string | null;
  reason: TrackMissReason | string;
};

export type AcquiredArtifactSourceNote = {
  artifact: RunTrackArtifactSourceArtifact;
  outcome: "acquired";
  provider: RunTrackArtifactSourceProvider;
  schema: ArtifactSourceNoteSchema;
  selection: RunTrackArtifactSourceSelection;
};

export type MissedArtifactSourceNote = {
  miss: RunTrackArtifactSourceMiss;
  outcome: "missed";
  schema: ArtifactSourceNoteSchema;
};

export type RunTrackArtifactSourceNote =
  | AcquiredArtifactSourceNote
  | MissedArtifactSourceNote;

export type GeneratedRunArtifact = {
  absolutePath: string;
  kind: Exclude<ArtifactKind, "run-report">;
  relativePath: string;
};

export type RunArtifactDownload = {
  downloadUrl: string;
  kind: ArtifactKind;
};

type GenerateRunArtifactsInput = {
  runId: string;
  runStore?: RunStore;
  workspaceRoot?: string;
};

type ManifestTrackEntry =
  | {
      artist: string;
      miss: null;
      outcome: "acquired";
      selection: {
        artifactFormat: ProviderArtifactFormat;
        artifactSha256: string | null;
        artifactSizeBytes: number | null;
        providerId: string;
        providerName: string;
        providerUrl: string | null;
        selectedFormat: TrackAudioFormat | null;
        selectedReason: TrackAcceptedDecision["reason"];
        zipEntryName: string;
      };
      sourcePosition: number;
      title: string;
      version: string | null;
    }
  | {
      artist: string;
      miss: RunTrackArtifactSourceMiss;
      outcome: "missed";
      selection: null;
      sourcePosition: number;
      title: string;
      version: string | null;
    };

type RunArtifactsManifest = {
  generatedAt: string;
  run: {
    id: string;
    playlistTitle: string | null;
    playlistUrl: string;
    sourceType: string;
    status: string;
  };
  schemaVersion: 1;
  summary: {
    acquiredCount: number;
    missCount: number;
    trackCount: number;
  };
  tracks: ManifestTrackEntry[];
};

export class RunArtifactsNotReadyError extends Error {
  readonly runId: string;

  constructor(runId: string, message: string) {
    super(message);
    this.name = "RunArtifactsNotReadyError";
    this.runId = runId;
  }
}

export class RunArtifactNotFoundError extends Error {
  readonly artifactKind: ArtifactKind;
  readonly runId: string;

  constructor(runId: string, artifactKind: ArtifactKind) {
    super(`Run "${runId}" does not have a generated ${artifactKind} artifact.`);
    this.name = "RunArtifactNotFoundError";
    this.artifactKind = artifactKind;
    this.runId = runId;
  }
}

export function buildAcquiredArtifactSourceNote(input: {
  artifact: RunTrackArtifactSourceArtifact;
  provider: RunTrackArtifactSourceProvider;
  selection: RunTrackArtifactSourceSelection;
}): AcquiredArtifactSourceNote {
  return {
    artifact: input.artifact,
    outcome: "acquired",
    provider: input.provider,
    schema: RUN_TRACK_ARTIFACT_SOURCE_NOTE_SCHEMA,
    selection: input.selection
  };
}

export function buildMissedArtifactSourceNote(input: {
  miss: RunTrackArtifactSourceMiss;
}): MissedArtifactSourceNote {
  return {
    miss: input.miss,
    outcome: "missed",
    schema: RUN_TRACK_ARTIFACT_SOURCE_NOTE_SCHEMA
  };
}

export function buildRunArtifactDownloadUrl(runId: string, kind: ArtifactKind) {
  return `/api/runs/${encodeURIComponent(runId)}/artifacts/${kind}`;
}

export async function generateRunArtifacts(
  input: GenerateRunArtifactsInput
): Promise<{
  artifacts: GeneratedRunArtifact[];
  manifest: RunArtifactsManifest;
}> {
  const runStore = input.runStore ?? getRunStore();
  const workspaceRoot = resolveWorkspaceRoot(input.workspaceRoot);
  const run = runStore.getRun(input.runId);

  if (!run) {
    throw new Error(`Run not found: ${input.runId}`);
  }

  const attempts = runStore.listRunTrackAttempts(input.runId);
  const notesByTrackId = getLatestArtifactSourceNotesByTrackId(attempts);
  const zipEntries: Array<{ data: Buffer; name: string }> = [];
  const manifestTracks: ManifestTrackEntry[] = [];

  for (const track of run.tracks) {
    const note = notesByTrackId.get(track.id);

    if (track.status === "acquired") {
      if (note?.outcome !== "acquired") {
        throw new RunArtifactsNotReadyError(
          run.id,
          `Run track "${track.id}" is acquired but does not have a persisted artifact source note.`
        );
      }

      const fileBytes = await readFile(
        /* turbopackIgnore: true */ note.artifact.localFilePath
      );
      const zipEntryName = buildZipEntryName(track, note.artifact);

      zipEntries.push({
        data: fileBytes,
        name: zipEntryName
      });
      manifestTracks.push({
        artist: track.artist,
        miss: null,
        outcome: "acquired",
        selection: {
          artifactFormat: note.artifact.format,
          artifactSha256: note.artifact.sha256 ?? null,
          artifactSizeBytes: note.artifact.sizeBytes,
          providerId: note.provider.providerId,
          providerName: note.provider.providerName,
          providerUrl: note.provider.providerUrl ?? null,
          selectedFormat: note.selection.selectedFormat,
          selectedReason: note.selection.reason,
          zipEntryName
        },
        sourcePosition: track.sourcePosition,
        title: track.title,
        version: track.version
      });

      continue;
    }

    if (track.status === "missed") {
      if (note?.outcome !== "missed") {
        throw new RunArtifactsNotReadyError(
          run.id,
          `Run track "${track.id}" is missed but does not have a persisted miss note.`
        );
      }

      manifestTracks.push({
        artist: track.artist,
        miss: note.miss,
        outcome: "missed",
        selection: null,
        sourcePosition: track.sourcePosition,
        title: track.title,
        version: track.version
      });

      continue;
    }

    throw new RunArtifactsNotReadyError(
      run.id,
      `Run track "${track.id}" is still "${track.status}" and cannot be packaged yet.`
    );
  }

  const artifactDirectory = getRunArtifactDirectory(workspaceRoot, run.id);
  const downloadsZipPath = path.join(artifactDirectory, "downloads.zip");
  const missesPath = path.join(artifactDirectory, "misses.txt");
  const manifestPath = path.join(artifactDirectory, "manifest.json");
  const manifest: RunArtifactsManifest = {
    generatedAt: new Date().toISOString(),
    run: {
      id: run.id,
      playlistTitle: run.playlistTitle,
      playlistUrl: run.playlistUrl,
      sourceType: run.sourceType,
      status: run.status
    },
    schemaVersion: 1,
    summary: {
      acquiredCount: manifestTracks.filter((track) => track.outcome === "acquired")
        .length,
      missCount: manifestTracks.filter((track) => track.outcome === "missed").length,
      trackCount: manifestTracks.length
    },
    tracks: manifestTracks
  };

  await mkdir(/* turbopackIgnore: true */ artifactDirectory, { recursive: true });
  await writeStoreZip(downloadsZipPath, zipEntries);
  await writeFile(
    /* turbopackIgnore: true */ missesPath,
    renderMissesText(manifestTracks),
    "utf8"
  );
  await writeFile(
    /* turbopackIgnore: true */ manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  const records: Array<
    RecordRunArtifactInput & {
      kind: GeneratedRunArtifact["kind"];
    }
  > = [
    {
      kind: "downloads-zip",
      relativePath: toRelativeWorkspacePath(workspaceRoot, downloadsZipPath),
      runId: run.id
    },
    {
      kind: "misses-txt",
      relativePath: toRelativeWorkspacePath(workspaceRoot, missesPath),
      runId: run.id
    },
    {
      kind: "manifest-json",
      relativePath: toRelativeWorkspacePath(workspaceRoot, manifestPath),
      runId: run.id
    }
  ];

  runStore.replaceRunArtifacts(run.id, records);

  return {
    artifacts: records.map((record) => ({
      absolutePath: path.join(workspaceRoot, record.relativePath),
      kind: record.kind,
      relativePath: record.relativePath
    })),
    manifest
  };
}

export function listRunArtifactDownloads(input: {
  runId: string;
  runStore?: RunStore;
}) {
  const runStore = input.runStore ?? getRunStore();
  const run = runStore.getRun(input.runId);

  if (!run) {
    throw new Error(`Run not found: ${input.runId}`);
  }

  return [...run.artifacts]
    .sort(compareArtifactsByKind)
    .map((artifact) => ({
      downloadUrl: buildRunArtifactDownloadUrl(run.id, artifact.kind),
      kind: artifact.kind
    })) satisfies RunArtifactDownload[];
}

export function resolveRunArtifact(input: {
  artifactKind: ArtifactKind;
  runId: string;
  runStore?: RunStore;
  workspaceRoot?: string;
}): RunArtifact & { absolutePath: string } {
  const runStore = input.runStore ?? getRunStore();
  const workspaceRoot = resolveWorkspaceRoot(input.workspaceRoot);
  const run = runStore.getRun(input.runId);

  if (!run) {
    throw new Error(`Run not found: ${input.runId}`);
  }

  const artifact = [...run.artifacts]
    .sort(compareArtifactsByKind)
    .find((candidate) => candidate.kind === input.artifactKind);

  if (!artifact) {
    throw new RunArtifactNotFoundError(input.runId, input.artifactKind);
  }

  return {
    ...artifact,
    absolutePath: path.join(workspaceRoot, artifact.relativePath)
  };
}

function getLatestArtifactSourceNotesByTrackId(
  attempts: ReturnType<RunStore["listRunTrackAttempts"]>
) {
  const notesByTrackId = new Map<string, RunTrackArtifactSourceNote>();

  for (const attempt of attempts) {
    if (notesByTrackId.has(attempt.runTrackId)) {
      continue;
    }

    const note = parseRunTrackArtifactSourceNote(attempt.note);

    if (note) {
      notesByTrackId.set(attempt.runTrackId, note);
    }
  }

  return notesByTrackId;
}

function parseRunTrackArtifactSourceNote(note: string | null) {
  if (!note) {
    return null;
  }

  try {
    const parsed = JSON.parse(note) as Record<string, unknown>;

    if (
      parsed.schema !== RUN_TRACK_ARTIFACT_SOURCE_NOTE_SCHEMA ||
      (parsed.outcome !== "acquired" && parsed.outcome !== "missed")
    ) {
      return null;
    }

    return parsed as RunTrackArtifactSourceNote;
  } catch {
    return null;
  }
}

function buildZipEntryName(
  track: RunTrack,
  artifact: RunTrackArtifactSourceArtifact
) {
  const extension = resolveArtifactExtension(artifact);

  return `${buildTrackLabel(track)}.${extension}`;
}

function resolveArtifactExtension(artifact: RunTrackArtifactSourceArtifact) {
  const fileExtension =
    artifact.fileExtension?.trim().replace(/^\./, "").toLowerCase() ??
    path.extname(artifact.fileName).replace(/^\./, "").toLowerCase();

  if (fileExtension) {
    return fileExtension;
  }

  if (/^[a-z0-9-]+$/i.test(artifact.format)) {
    return artifact.format.toLowerCase();
  }

  return "bin";
}

function buildTrackLabel(track: RunTrack) {
  const baseLabel = `${padTrackPosition(track.sourcePosition)} - ${track.artist} - ${track.title}`;

  return sanitizeFileName(track.version ? `${baseLabel} (${track.version})` : baseLabel);
}

function sanitizeFileName(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function padTrackPosition(sourcePosition: number) {
  return String(sourcePosition).padStart(3, "0");
}

function renderMissesText(tracks: ManifestTrackEntry[]) {
  const missedTracks = tracks.filter(
    (track): track is Extract<ManifestTrackEntry, { outcome: "missed" }> =>
      track.outcome === "missed"
  );

  if (missedTracks.length === 0) {
    return "";
  }

  return `${missedTracks
    .map(
      (track) =>
        `${buildTrackLabelFromManifest(track)} :: ${track.miss.reason} :: ${track.miss.detail}`
    )
    .join("\n")}\n`;
}

function buildTrackLabelFromManifest(track: ManifestTrackEntry) {
  const baseLabel = `${padTrackPosition(track.sourcePosition)} - ${track.artist} - ${track.title}`;

  return track.version ? `${baseLabel} (${track.version})` : baseLabel;
}

function resolveWorkspaceRoot(workspaceRoot?: string) {
  return (
    workspaceRoot ??
    process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd())
  );
}

function getRunArtifactDirectory(workspaceRoot: string, runId: string) {
  return path.join(workspaceRoot, "data", "runs", sanitizeRunId(runId), "artifacts");
}

function sanitizeRunId(runId: string) {
  return runId.replace(/[^a-z0-9-_.]+/gi, "-");
}

function toRelativeWorkspacePath(workspaceRoot: string, absolutePath: string) {
  const relativePath = path.relative(workspaceRoot, absolutePath);

  return relativePath.split(path.sep).join("/");
}

function compareArtifactsByKind(left: RunArtifact, right: RunArtifact) {
  return (
    RUN_ARTIFACT_KIND_ORDER.indexOf(left.kind) -
    RUN_ARTIFACT_KIND_ORDER.indexOf(right.kind)
  );
}

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_DOS_TIME = (12 << 11) | (0 << 5);
const ZIP_DOS_DATE = ((2026 - 1980) << 9) | (3 << 5) | 31;
const CRC32_TABLE = buildCrc32Table();

async function writeStoreZip(
  destinationPath: string,
  entries: Array<{ data: Buffer; name: string }>
) {
  const localHeaders: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileName = Buffer.from(entry.name, "utf8");
    const crc32 = calculateCrc32(entry.data);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(ZIP_STORE_METHOD, 8);
    localHeader.writeUInt16LE(ZIP_DOS_TIME, 10);
    localHeader.writeUInt16LE(ZIP_DOS_DATE, 12);
    localHeader.writeUInt32LE(crc32, 14);
    localHeader.writeUInt32LE(entry.data.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localHeaders.push(localHeader, fileName, entry.data);

    const centralHeader = Buffer.alloc(46);

    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(ZIP_STORE_METHOD, 10);
    centralHeader.writeUInt16LE(ZIP_DOS_TIME, 12);
    centralHeader.writeUInt16LE(ZIP_DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc32, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralDirectory.push(centralHeader, fileName);
    offset += localHeader.length + fileName.length + entry.data.length;
  }

  const centralDirectoryBuffer = Buffer.concat(centralDirectory);
  const endOfCentralDirectory = Buffer.alloc(22);

  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryBuffer.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  await writeFile(
    /* turbopackIgnore: true */ destinationPath,
    Buffer.concat([...localHeaders, centralDirectoryBuffer, endOfCentralDirectory])
  );
}

function buildCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

function calculateCrc32(buffer: Buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
