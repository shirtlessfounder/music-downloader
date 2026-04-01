import type { MixPreference } from '../../catalog/trackTypes';

export type SoundCloudCandidate = {
  artist: string;
  title: string;
  url: string;
  durationSeconds: number;
};

export type CandidateSelection = {
  candidate: SoundCloudCandidate;
  confidence: number;
  mixClass: MixPreference;
};
