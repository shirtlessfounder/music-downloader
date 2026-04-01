import type { CanonicalTrack } from '../catalog/trackTypes';

export const providerIds = [
  'hypeddit',
  'reddit',
  'soundclouddl',
  'beatport'
] as const;

export type ProviderId = (typeof providerIds)[number];

export type AudioFormat = 'mp3' | 'wav';

export type ProviderSuccessResult = {
  status: 'success';
  provider: ProviderId;
  format: AudioFormat;
  downloadUrl: string;
  sourceUrl?: string | null;
};

export type ProviderFailureResult = {
  status: 'retryable_failure' | 'terminal_failure';
  provider: ProviderId;
  reason: string;
};

export type ProviderResult = ProviderSuccessResult | ProviderFailureResult;

export type ProviderDownloadInput = {
  track: CanonicalTrack;
};

export interface DownloadProvider {
  id: ProviderId;
  download(input: ProviderDownloadInput): Promise<ProviderResult>;
}
