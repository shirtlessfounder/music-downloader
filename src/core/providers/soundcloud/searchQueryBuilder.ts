import type { TrackIdentity } from '../../catalog/trackTypes';

function normalizePart(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function buildSoundCloudSearchQueries(
  track: Pick<TrackIdentity, 'artist' | 'title'>
): string[] {
  const artist = normalizePart(track.artist);
  const title = normalizePart(track.title);
  const baseQuery = normalizePart(`${artist} ${title}`);

  return [
    `${baseQuery} Extended Mix`,
    `${baseQuery} Original Mix`,
    baseQuery
  ];
}
