import type { CanonicalTrack, MixPreference } from '../../catalog/trackTypes';
import type { CandidateSelection, SoundCloudCandidate } from './candidateTypes';

const NOISE_PATTERN = /\b(remix|live|radio edit|edit)\b/i;

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function includesNormalized(haystack: string, needle: string): boolean {
  return haystack.includes(needle);
}

function getMixClass(candidate: SoundCloudCandidate): MixPreference | null {
  if (/\bextended mix\b/i.test(candidate.title)) {
    return 'extended';
  }

  if (/\boriginal mix\b/i.test(candidate.title)) {
    return 'original';
  }

  if (candidate.durationSeconds >= 240) {
    return 'long-fallback';
  }

  return null;
}

function getConfidence(
  track: CanonicalTrack,
  candidate: SoundCloudCandidate
): number {
  const normalizedArtist = normalizeText(track.artist);
  const normalizedTitle = normalizeText(track.title);
  const normalizedCandidate = normalizeText(
    `${candidate.artist} ${candidate.title}`
  );

  let score = 0;

  if (includesNormalized(normalizedCandidate, normalizedArtist)) {
    score += 45;
  }

  if (includesNormalized(normalizedCandidate, normalizedTitle)) {
    score += 45;
  }

  if (/\bextended mix\b/i.test(candidate.title)) {
    score += 10;
  } else if (/\boriginal mix\b/i.test(candidate.title)) {
    score += 6;
  }

  return score;
}

function isRejected(candidate: SoundCloudCandidate): boolean {
  return NOISE_PATTERN.test(candidate.title);
}

function getMixPriority(track: CanonicalTrack, mixClass: MixPreference): number {
  const index = track.mixPreferenceOrder.indexOf(mixClass);

  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

export function pickBestCandidate(
  track: CanonicalTrack,
  candidates: readonly SoundCloudCandidate[]
): CandidateSelection | null {
  const ranked = candidates
    .filter((candidate) => !isRejected(candidate))
    .map((candidate) => {
      const mixClass = getMixClass(candidate);
      const confidence = getConfidence(track, candidate);

      return {
        candidate,
        confidence,
        mixClass
      };
    })
    .filter((entry) => {
      if (entry.mixClass === 'extended' || entry.mixClass === 'original') {
        return entry.confidence >= 90;
      }

      if (entry.mixClass === 'long-fallback') {
        return entry.confidence >= 90;
      }

      return false;
    })
    .sort((left, right) => {
      const priorityDelta =
        getMixPriority(track, left.mixClass) - getMixPriority(track, right.mixClass);

      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }

      return right.candidate.durationSeconds - left.candidate.durationSeconds;
    });

  if (ranked.length === 0) {
    return null;
  }

  const best = ranked[0];

  return {
    candidate: best.candidate,
    confidence: best.confidence,
    mixClass: best.mixClass
  };
}
