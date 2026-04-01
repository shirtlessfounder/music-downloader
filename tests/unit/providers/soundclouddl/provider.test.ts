import { describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '../../../../src/core/catalog/trackTypes';
import { SoundCloudDLPageError } from '../../../../src/core/providers/soundclouddl/page';
import { SoundCloudDLProvider } from '../../../../src/core/providers/soundclouddl/provider';

const track: CanonicalTrack = {
  artist: 'Artist',
  title: 'Track',
  source: 'spotify',
  mixPreferenceOrder: ['extended', 'original', 'long-fallback']
};

describe('SoundCloudDLProvider', () => {
  it('submits the chosen SoundCloud URL as MP3 and returns provider provenance', async () => {
    const calls: Array<{ sourceUrl: string; format: 'mp3' }> = [];
    const provider = new SoundCloudDLProvider({
      async convertTrack(input) {
        calls.push(input);

        return {
          downloadUrl: 'https://soundclouddl.cc/downloads/track.mp3'
        };
      }
    });

    const result = await provider.download({
      track,
      sourceUrl: 'https://soundcloud.com/artist/track-extended'
    });

    expect(calls).toEqual([
      {
        sourceUrl: 'https://soundcloud.com/artist/track-extended',
        format: 'mp3'
      }
    ]);
    expect(result).toEqual({
      status: 'success',
      provider: 'soundclouddl',
      format: 'mp3',
      downloadUrl: 'https://soundclouddl.cc/downloads/track.mp3',
      sourceUrl: 'https://soundcloud.com/artist/track-extended'
    });
  });

  it('classifies transient browser failures as retryable', async () => {
    const provider = new SoundCloudDLProvider({
      async convertTrack() {
        throw new SoundCloudDLPageError('timeout waiting for conversion', true);
      }
    });

    const result = await provider.download({
      track,
      sourceUrl: 'https://soundcloud.com/artist/track-extended'
    });

    expect(result).toEqual({
      status: 'retryable_failure',
      provider: 'soundclouddl',
      reason: 'timeout waiting for conversion'
    });
  });

  it('classifies terminal conversion failures as terminal', async () => {
    const provider = new SoundCloudDLProvider({
      async convertTrack() {
        throw new SoundCloudDLPageError('converter rejected track', false);
      }
    });

    const result = await provider.download({
      track,
      sourceUrl: 'https://soundcloud.com/artist/track-extended'
    });

    expect(result).toEqual({
      status: 'terminal_failure',
      provider: 'soundclouddl',
      reason: 'converter rejected track'
    });
  });
});
