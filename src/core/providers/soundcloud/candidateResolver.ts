import type { CanonicalTrack, MixPreference } from '../../catalog/trackTypes';
import type { SoundCloudCandidate } from './candidateTypes';
import { pickBestCandidate } from './candidateScorer';
import { buildSoundCloudSearchQueries } from './searchQueryBuilder';
import type { SoundCloudSearchClient } from './searchBrowserClient';

export type ResolvedSoundCloudCandidate = {
  selected: SoundCloudCandidate;
  queryUsed: string;
  confidence: number;
  mixClass: MixPreference;
};

export type ResolveSoundCloudCandidateInput = {
  track: CanonicalTrack;
  client: SoundCloudSearchClient;
};

export async function resolveSoundCloudCandidate(
  input: ResolveSoundCloudCandidateInput
): Promise<ResolvedSoundCloudCandidate | null> {
  for (const query of buildSoundCloudSearchQueries(input.track)) {
    const candidates = await input.client.search(query);
    const selected = pickBestCandidate(input.track, candidates);

    if (selected) {
      return {
        selected: selected.candidate,
        queryUsed: query,
        confidence: selected.confidence,
        mixClass: selected.mixClass
      };
    }
  }

  return null;
}
