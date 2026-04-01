import { describe, expect, it } from 'vitest';
import { buildSoundCloudSearchQueries } from '../../../../src/core/providers/soundcloud/searchQueryBuilder';

describe('buildSoundCloudSearchQueries', () => {
  it('tries extended, then original, then plain title', () => {
    const queries = buildSoundCloudSearchQueries({
      artist: 'Artist',
      title: 'Track'
    });

    expect(queries).toEqual([
      'Artist Track Extended Mix',
      'Artist Track Original Mix',
      'Artist Track'
    ]);
  });
});
