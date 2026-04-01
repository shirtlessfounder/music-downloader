export type TrackIdentity = {
  artist: string;
  title: string;
  version?: string | null;
};

export type MixPreference = 'extended' | 'original' | 'long-fallback';

export type CatalogSource = 'spotify' | 'soundcloud';

export type CanonicalTrack = TrackIdentity & {
  source: CatalogSource;
  sourceUrl?: string | null;
  expectedDurationSeconds?: number | null;
  mixPreferenceOrder: readonly MixPreference[];
};
