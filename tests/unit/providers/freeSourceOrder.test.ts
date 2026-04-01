import { describe, expect, it } from 'vitest';
import { buildFreeSourceOrder } from '../../../src/core/providers/freeSourceOrder';

describe('buildFreeSourceOrder', () => {
  it('places soundclouddl after stronger free sources and before paid fallback', () => {
    expect(buildFreeSourceOrder()).toEqual([
      'hypeddit',
      'reddit',
      'soundclouddl',
      'beatport'
    ]);
  });
});
