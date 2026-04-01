import type { ProviderId } from './providerTypes';

const FREE_SOURCE_ORDER: ProviderId[] = [
  'hypeddit',
  'reddit',
  'soundclouddl',
  'beatport'
];

export function buildFreeSourceOrder(): ProviderId[] {
  return [...FREE_SOURCE_ORDER];
}
