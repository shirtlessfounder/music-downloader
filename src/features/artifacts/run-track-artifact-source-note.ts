import type {
  ProviderArtifactFormat,
  ProviderAuthorizationBasis,
  ProviderPriceTier,
  ProviderProvenance
} from "@/features/providers/provider-registry";
import type {
  TrackAcceptedDecision,
  TrackAudioFormat,
  TrackMissReason
} from "@/features/tracks/canonical-track";

export const RUN_TRACK_ARTIFACT_SOURCE_NOTE_SCHEMA =
  "run-track-artifact-source.v1";

export type ArtifactSourceNoteSchema =
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

export function parseRunTrackArtifactSourceNote(note: string | null) {
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
