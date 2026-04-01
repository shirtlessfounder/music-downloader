import type { CanonicalTrack } from '../catalog/trackTypes';
import { buildFreeSourceOrder } from '../providers/freeSourceOrder';
import type { ProviderRegistry } from '../providers/providerRegistry';
import type { ProviderFailureResult } from '../providers/providerTypes';
import type { ResolvedSoundCloudCandidate } from '../providers/soundcloud/candidateResolver';
import type { PlannedAcquisition } from './provenanceTypes';

export type PlanTrackAcquisitionInput = {
  track: CanonicalTrack;
  providerRegistry: ProviderRegistry;
  resolveSoundCloudCandidate: (
    track: CanonicalTrack
  ) => Promise<ResolvedSoundCloudCandidate | null>;
};

export async function planTrackAcquisition(
  input: PlanTrackAcquisitionInput
): Promise<PlannedAcquisition> {
  let lastFailure: ProviderFailureResult | null = null;

  for (const providerId of buildFreeSourceOrder()) {
    const provider = input.providerRegistry.get(providerId);

    if (!provider) {
      continue;
    }

    if (providerId === 'soundclouddl') {
      const resolvedCandidate = await input.resolveSoundCloudCandidate(input.track);

      if (!resolvedCandidate) {
        lastFailure = {
          status: 'terminal_failure',
          provider: providerId,
          reason: 'no matching SoundCloud candidate'
        };
        continue;
      }

      const result = await provider.download({
        track: input.track,
        sourceUrl: resolvedCandidate.selected.url
      });

      if (result.status === 'success') {
        return {
          result,
          provenance: {
            providerId,
            matchedSoundCloudUrl: resolvedCandidate.selected.url,
            queryUsed: resolvedCandidate.queryUsed,
            confidence: resolvedCandidate.confidence,
            selectedMixClass: resolvedCandidate.mixClass
          }
        };
      }

      lastFailure = result;
      continue;
    }

    const result = await provider.download({
      track: input.track
    });

    if (result.status === 'success') {
      return {
        result,
        provenance: {
          providerId
        }
      };
    }

    lastFailure = result;
  }

  return {
    result: lastFailure ?? {
      status: 'terminal_failure',
      provider: 'beatport',
      reason: 'no providers available'
    },
    provenance: null
  };
}
