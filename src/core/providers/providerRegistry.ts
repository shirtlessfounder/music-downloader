import type { DownloadProvider, ProviderId } from './providerTypes';

export type ProviderRegistry = Map<ProviderId, DownloadProvider>;

export function buildProviderRegistry(
  providers: readonly DownloadProvider[]
): ProviderRegistry {
  return new Map(providers.map((provider) => [provider.id, provider]));
}
