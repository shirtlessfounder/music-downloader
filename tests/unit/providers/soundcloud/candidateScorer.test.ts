import { describe, expect, it } from 'vitest';
import type { CanonicalTrack } from '../../../../src/core/catalog/trackTypes';
import { pickBestCandidate } from '../../../../src/core/providers/soundcloud/candidateScorer';
import type { SoundCloudCandidate } from '../../../../src/core/providers/soundcloud/candidateTypes';

const track: CanonicalTrack = {
  artist: 'Artist',
  title: 'Track',
  source: 'spotify',
  mixPreferenceOrder: ['extended', 'original', 'long-fallback']
};

function candidate(
  title: string,
  durationSeconds: number,
  url = 'https://soundcloud.com/artist/track'
): SoundCloudCandidate {
  return {
    artist: 'Artist',
    title,
    url,
    durationSeconds
  };
}

describe('pickBestCandidate', () => {
  it('prefers an exact extended mix over other valid candidates', () => {
    const result = pickBestCandidate(track, [
      candidate('Track Original Mix', 325, 'https://soundcloud.com/artist/original'),
      candidate('Track Extended Mix', 402, 'https://soundcloud.com/artist/extended')
    ]);

    expect(result?.candidate.url).toBe('https://soundcloud.com/artist/extended');
    expect(result?.mixClass).toBe('extended');
  });

  it('falls back to original mix when no extended mix is available', () => {
    const result = pickBestCandidate(track, [
      candidate('Track', 401, 'https://soundcloud.com/artist/plain'),
      candidate('Track Original Mix', 320, 'https://soundcloud.com/artist/original')
    ]);

    expect(result?.candidate.url).toBe('https://soundcloud.com/artist/original');
    expect(result?.mixClass).toBe('original');
  });

  it('accepts a long plain match only when confidence stays high', () => {
    const result = pickBestCandidate(track, [
      candidate('Track', 301, 'https://soundcloud.com/artist/plain')
    ]);

    expect(result?.candidate.url).toBe('https://soundcloud.com/artist/plain');
    expect(result?.mixClass).toBe('long-fallback');
  });

  it('rejects remix, live, and radio-edit noise', () => {
    const result = pickBestCandidate(track, [
      candidate('Track Remix', 330, 'https://soundcloud.com/artist/remix'),
      candidate('Track Live', 340, 'https://soundcloud.com/artist/live'),
      candidate('Track Radio Edit', 210, 'https://soundcloud.com/artist/radio')
    ]);

    expect(result).toBeNull();
  });
});
