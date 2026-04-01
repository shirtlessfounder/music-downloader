import type { MixPreference } from '../catalog/trackTypes';
import type { ProviderId, ProviderResult } from '../providers/providerTypes';

export type AcquisitionProvenance = {
  providerId: ProviderId;
  matchedSoundCloudUrl?: string | null;
  queryUsed?: string | null;
  confidence?: number | null;
  selectedMixClass?: MixPreference | null;
};

export type PlannedAcquisition = {
  result: ProviderResult;
  provenance: AcquisitionProvenance | null;
};
