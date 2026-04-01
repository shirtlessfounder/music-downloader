import type { SoundCloudCandidate } from './candidateTypes';
import { SoundCloudSearchPage } from './searchPage';

export interface SoundCloudSearchClient {
  search(query: string): Promise<SoundCloudCandidate[]>;
}

export class SoundCloudSearchBrowserClient implements SoundCloudSearchClient {
  constructor(private readonly searchPage: SoundCloudSearchPage) {}

  async search(query: string): Promise<SoundCloudCandidate[]> {
    return this.searchPage.search(query);
  }
}
