import {
  buildAcquiredArtifactSourceNote,
  buildMissedArtifactSourceNote,
  generateRunArtifacts
} from "@/features/artifacts/run-artifacts";
import {
  matchTrackCandidates,
  type SelectedTrackCandidate
} from "@/features/matching/track-matcher";
import { createLiveProviderRegistry } from "@/features/providers/live-provider-registry";
import type {
  AutomaticProviderDefinition,
  ProviderAcquiredResult,
  ProviderRegistry
} from "@/features/providers/provider-registry";
import {
  getRunStore,
  type RunDetail,
  type RunStore,
  type RunTrack
} from "@/features/runs/run-store";
import { canonicalizeTrack } from "@/features/tracks/canonical-track";

import { createRunFromPlaylistUrl } from "../ingestion/playlist-intake";

type SubmitLiveRunDependencies = {
  createRunFromPlaylistUrl?: typeof createRunFromPlaylistUrl;
  providerRegistry?: Pick<ProviderRegistry, "listAutomatic">;
  runStore?: RunStore;
  workspaceRoot?: string;
};

export async function submitLiveRunFromPlaylistUrl(
  playlistUrl: string,
  dependencies: SubmitLiveRunDependencies = {}
): Promise<RunDetail> {
  const runStore = dependencies.runStore ?? getRunStore();
  const providerRegistry =
    dependencies.providerRegistry ??
    createLiveProviderRegistry({ workspaceRoot: dependencies.workspaceRoot });
  let runId: string | null = null;

  try {
    const createdRun = await (
      dependencies.createRunFromPlaylistUrl ?? createRunFromPlaylistUrl
    )(playlistUrl, { runStore });

    runId = createdRun.id;

    runStore.transitionRunStatus(runId, "ingesting");
    runStore.transitionRunStatus(runId, "matching");

    const hydratedRun = requireRun(runStore, runId);

    for (const track of hydratedRun.tracks) {
      await resolveTrackWithAutomaticProviders({
        providers: providerRegistry.listAutomatic(),
        runStore,
        track
      });
    }

    const resolvedRun = requireRun(runStore, runId);

    if (resolvedRun.tracks.some((track) => track.status === "failed")) {
      return runStore.transitionRunStatus(runId, "failed");
    }

    if (resolvedRun.tracks.every((track) => track.status === "acquired")) {
      runStore.transitionRunStatus(runId, "packaging");
      await generateRunArtifacts({
        runId,
        runStore,
        workspaceRoot: dependencies.workspaceRoot
      });

      return runStore.transitionRunStatus(runId, "completed");
    }

    return resolvedRun;
  } catch (error) {
    if (runId) {
      failRunIfPossible(runStore, runId);
    }

    throw error;
  }
}

async function resolveTrackWithAutomaticProviders(input: {
  providers: AutomaticProviderDefinition[];
  runStore: RunStore;
  track: RunTrack;
}) {
  const canonicalTrack = canonicalizeTrack({
    artistName: input.track.artist,
    source: "playlist-run-track",
    sourceTrackId: input.track.sourceTrackId ?? input.track.id,
    title: buildRequestedTrackTitle(input.track)
  });
  let hasRetryableFailure = false;

  for (const provider of input.providers) {
    const searchResult = await provider.search({ track: canonicalTrack });

    if (searchResult.outcome === "miss") {
      input.runStore.recordAcquisitionAttempt({
        note: searchResult.miss.detail,
        outcome: "skipped",
        providerKey: provider.id,
        runTrackId: input.track.id
      });
      continue;
    }

    if (searchResult.outcome === "rejected") {
      input.runStore.recordAcquisitionAttempt({
        note: searchResult.rejection.detail,
        outcome: searchResult.rejection.retryable ? "failed" : "skipped",
        providerKey: provider.id,
        runTrackId: input.track.id
      });
      hasRetryableFailure ||= searchResult.rejection.retryable;
      continue;
    }

    const matchResult = matchTrackCandidates({
      candidates: searchResult.candidates,
      track: canonicalTrack
    });

    if (matchResult.outcome === "miss") {
      input.runStore.recordAcquisitionAttempt({
        note: matchResult.miss.details,
        outcome: "skipped",
        providerKey: provider.id,
        runTrackId: input.track.id
      });
      continue;
    }

    input.runStore.updateRunTrackStatus(input.track.id, "matched");

    const acquisitionResult = await provider.acquire({
      candidate: matchResult.selected.candidate,
      track: canonicalTrack
    });

    if (acquisitionResult.outcome === "acquired") {
      persistAcquiredTrack({
        acquisitionResult,
        provider,
        runStore: input.runStore,
        selectedDetails: matchResult.selected,
        track: input.track
      });
      return;
    }

    if (acquisitionResult.outcome === "miss") {
      input.runStore.recordAcquisitionAttempt({
        note: acquisitionResult.miss.detail,
        outcome: "skipped",
        providerKey: provider.id,
        runTrackId: input.track.id
      });
      continue;
    }

    input.runStore.recordAcquisitionAttempt({
      note: acquisitionResult.rejection.detail,
      outcome: acquisitionResult.rejection.retryable ? "failed" : "skipped",
      providerKey: provider.id,
      runTrackId: input.track.id
    });
    hasRetryableFailure ||= acquisitionResult.rejection.retryable;
  }

  if (hasRetryableFailure) {
    input.runStore.updateRunTrackStatus(input.track.id, "failed");
    return;
  }

  input.runStore.updateRunTrackStatus(input.track.id, "missed");
  input.runStore.recordAcquisitionAttempt({
    note: JSON.stringify(
      buildMissedArtifactSourceNote({
        miss: {
          detail:
            "All automatic authorized-source providers were exhausted without selecting an eligible acquisition candidate.",
          providerId: "track-matcher",
          providerName: "Track matcher",
          reason: "no-authorized-source-match"
        }
      })
    ),
    outcome: "missed",
    providerKey: "track-matcher",
    runTrackId: input.track.id
  });
}

function persistAcquiredTrack(input: {
  acquisitionResult: ProviderAcquiredResult;
  provider: AutomaticProviderDefinition;
  runStore: RunStore;
  selectedDetails: SelectedTrackCandidate;
  track: RunTrack;
}) {
  input.runStore.updateRunTrackStatus(input.track.id, "acquired");
  input.runStore.recordAcquisitionAttempt({
    note: JSON.stringify(
      buildAcquiredArtifactSourceNote({
        artifact: {
          ...input.acquisitionResult.artifact
        },
        provider: {
          authorizationBasis: input.provider.authorizationBasis,
          candidateId: input.acquisitionResult.candidate.candidateId,
          discoveredVia:
            input.acquisitionResult.candidate.provenance.discoveredVia ?? "search",
          priceTier: input.provider.priceTier,
          providerId: input.provider.id,
          providerName: input.provider.displayName,
          providerUrl:
            input.acquisitionResult.candidate.provenance.providerUrl ??
            input.acquisitionResult.candidate.provenance.sourcePageUrl ??
            null
        },
        selection: {
          details: input.selectedDetails.details,
          reason: input.selectedDetails.reason,
          selectedFormat: input.selectedDetails.selectedFormat
        }
      })
    ),
    outcome: "matched",
    providerKey: input.provider.id,
    runTrackId: input.track.id
  });
}

function buildRequestedTrackTitle(track: RunTrack) {
  return track.version ? `${track.title} (${track.version})` : track.title;
}

function failRunIfPossible(runStore: RunStore, runId: string) {
  const run = runStore.getRun(runId);

  if (!run || run.status === "completed" || run.status === "failed") {
    return;
  }

  runStore.transitionRunStatus(runId, "failed");
}

function requireRun(runStore: RunStore, runId: string) {
  const run = runStore.getRun(runId);

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  return run;
}
