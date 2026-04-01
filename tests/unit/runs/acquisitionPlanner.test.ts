import { describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '../../../src/core/catalog/trackTypes';
import { planTrackAcquisition } from '../../../src/core/runs/acquisitionPlanner';

const track: CanonicalTrack = {
  artist: 'Artist',
  title: 'Track',
  source: 'spotify',
  mixPreferenceOrder: ['extended', 'original', 'long-fallback']
};

describe('planTrackAcquisition', () => {
  it('falls through stronger free providers, resolves SoundCloud, and records provenance', async () => {
    const attempts: string[] = [];
    const result = await planTrackAcquisition({
      track,
      providerRegistry: new Map([
        [
          'hypeddit',
          {
            id: 'hypeddit',
            async download() {
              attempts.push('hypeddit');
              return {
                status: 'terminal_failure',
                provider: 'hypeddit',
                reason: 'miss'
              } as const;
            }
          }
        ],
        [
          'reddit',
          {
            id: 'reddit',
            async download() {
              attempts.push('reddit');
              return {
                status: 'terminal_failure',
                provider: 'reddit',
                reason: 'miss'
              } as const;
            }
          }
        ],
        [
          'soundclouddl',
          {
            id: 'soundclouddl',
            async download(input) {
              attempts.push(`soundclouddl:${input.sourceUrl}`);
              return {
                status: 'success',
                provider: 'soundclouddl',
                format: 'mp3',
                downloadUrl: 'https://soundclouddl.cc/downloads/track.mp3',
                sourceUrl: input.sourceUrl ?? null
              } as const;
            }
          }
        ]
      ]),
      resolveSoundCloudCandidate: async () => ({
        selected: {
          artist: 'Artist',
          title: 'Track Extended Mix',
          url: 'https://soundcloud.com/artist/track-extended',
          durationSeconds: 405
        },
        queryUsed: 'Artist Track Extended Mix',
        confidence: 100,
        mixClass: 'extended'
      })
    });

    expect(attempts).toEqual([
      'hypeddit',
      'reddit',
      'soundclouddl:https://soundcloud.com/artist/track-extended'
    ]);
    expect(result).toEqual({
      result: {
        status: 'success',
        provider: 'soundclouddl',
        format: 'mp3',
        downloadUrl: 'https://soundclouddl.cc/downloads/track.mp3',
        sourceUrl: 'https://soundcloud.com/artist/track-extended'
      },
      provenance: {
        providerId: 'soundclouddl',
        matchedSoundCloudUrl: 'https://soundcloud.com/artist/track-extended',
        queryUsed: 'Artist Track Extended Mix',
        confidence: 100,
        selectedMixClass: 'extended'
      }
    });
  });
});
