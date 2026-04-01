import type { DownloadProvider, ProviderDownloadInput, ProviderResult } from '../providerTypes';
import type { SoundCloudDLConverterPage } from './page';
import { SoundCloudDLPageError } from './page';

export class SoundCloudDLProvider implements DownloadProvider {
  readonly id = 'soundclouddl' as const;

  constructor(private readonly converterPage: SoundCloudDLConverterPage) {}

  async download(input: ProviderDownloadInput): Promise<ProviderResult> {
    if (!input.sourceUrl) {
      return {
        status: 'terminal_failure',
        provider: this.id,
        reason: 'missing SoundCloud source URL'
      };
    }

    try {
      const result = await this.converterPage.convertTrack({
        sourceUrl: input.sourceUrl,
        format: 'mp3'
      });

      return {
        status: 'success',
        provider: this.id,
        format: 'mp3',
        downloadUrl: result.downloadUrl,
        sourceUrl: input.sourceUrl
      };
    } catch (error) {
      if (error instanceof SoundCloudDLPageError) {
        return {
          status: error.retryable ? 'retryable_failure' : 'terminal_failure',
          provider: this.id,
          reason: error.message
        };
      }

      throw error;
    }
  }
}
