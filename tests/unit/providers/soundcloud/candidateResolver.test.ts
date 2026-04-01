import { describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '../../../../src/core/catalog/trackTypes';
import type { SoundCloudCandidate } from '../../../../src/core/providers/soundcloud/candidateTypes';
import { resolveSoundCloudCandidate } from '../../../../src/core/providers/soundcloud/candidateResolver';

const track: CanonicalTrack = {
  artist: 'Artist',
  title: 'Track',
  source: 'spotify',
  mixPreferenceOrder: ['extended', 'original', 'long-fallback']
};

describe('resolveSoundCloudCandidate', () => {
  it('uses query order plus scorer output to choose one high-confidence candidate', async () => {
    const queries: string[] = [];
    const fakeSearchClient = {
      async search(query: string): Promise<SoundCloudCandidate[]> {
        queries.push(query);

        if (query.includes('Extended Mix')) {
          return [
            {
              artist: 'Artist',
              title: 'Track Extended Mix',
              url: 'https://soundcloud.com/artist/track-extended',
              durationSeconds: 405
            }
          ];
        }

        return [];
      }
    };

    const result = await resolveSoundCloudCandidate({
      track,
      client: fakeSearchClient
    });

    expect(queries).toEqual([
      'Artist Track Extended Mix'
    ]);
    expect(result?.selected.url).toContain('soundcloud.com/');
    expect(result?.queryUsed).toContain('Extended Mix');
    expect(result?.mixClass).toBe('extended');
  });
});
