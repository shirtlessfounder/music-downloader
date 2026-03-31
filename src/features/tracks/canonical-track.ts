export const TRACK_AUDIO_FORMATS = ["mp3", "wav"] as const;
export type TrackAudioFormat = (typeof TRACK_AUDIO_FORMATS)[number];

export const TRACK_MISS_REASONS = [
  "no-eligible-candidate",
  "no-authorized-source-match"
] as const;
export type TrackMissReason = (typeof TRACK_MISS_REASONS)[number];

export type CanonicalMixKind = "extended" | "original" | "base" | "variant";
export type CanonicalMixSelectionClass = "preferred" | "fallback" | "reject";
export type CanonicalConfidence = "high" | "medium" | "low";

export interface CanonicalArtistCredit {
  display: string;
  normalized: string;
  role: "primary" | "featured";
}

export interface CanonicalMixMetadata {
  cleanTitle: string;
  displayLabel: string | null;
  normalizedLabel: string | null;
  kind: CanonicalMixKind;
  selectionClass: CanonicalMixSelectionClass;
  confidence: CanonicalConfidence;
}

export interface CanonicalTrackInput {
  source: string;
  title: string;
  artistName?: string;
  artistNames?: string[];
  sourceTrackId?: string;
  sourceUrl?: string;
  duration?: number | string | null;
  availableFormats?: string[];
}

export interface CanonicalTrack {
  artistCredits: CanonicalArtistCredit[];
  primaryArtist: string | null;
  normalizedArtistKey: string;
  title: string;
  normalizedTitle: string;
  mix: CanonicalMixMetadata;
  durationSeconds: number | null;
  preferredFormats: readonly TrackAudioFormat[];
  availableFormats: TrackAudioFormat[];
  provenance: {
    source: string;
    sourceTrackId?: string;
    sourceUrl?: string;
    rawArtists: string[];
    rawTitle: string;
    rawDuration: number | string | null;
  };
}

export const DEFAULT_TRACK_SELECTION_POLICY = {
  preferredMixKinds: ["extended", "original"] as const,
  fallbackMixKind: "base" as const,
  preferredFormats: ["mp3", "wav"] as const,
  minimumFallbackDurationSeconds: 240
};

export type TrackDecision =
  | {
      outcome: "accepted";
      reason:
        | "accepted-extended-mix"
        | "accepted-original-mix"
        | "accepted-base-version-fallback";
      selectedFormat: TrackAudioFormat;
      details: string;
    }
  | {
      outcome: "rejected";
      reason:
        | "mix-version-not-eligible"
        | "fallback-duration-too-short"
        | "fallback-duration-missing"
        | "format-not-eligible";
      selectedFormat: TrackAudioFormat | null;
      details: string;
    }
  | {
      outcome: "miss";
      reason: TrackMissReason;
      selectedFormat: null;
      details: string;
    };

const FEATURED_ARTIST_PATTERN = /\s+(?:feat\.?|ft\.?|featuring)\s+(.+)$/i;
const TRAILING_LABEL_PATTERN = /\s*[\[(]([^[\]()]+)[\])]\s*$/;
const CLOCK_DURATION_PATTERN = /^\d{1,2}:\d{2}(?::\d{2})?$/;
const NUMERIC_DURATION_PATTERN = /^\d+(?:\.\d+)?$/;
const ARTIST_SEPARATOR_PATTERN = /\s*(?:,|&| x | vs\.? |\/| b2b )\s*/i;
const PROMOTIONAL_LABEL_PATTERN =
  /\s*[\[(](?:free(?:\s+download|\s+dl)?|download|dl|out now|buy link|premiere|clip)[^)\]]*[\])]\s*$/i;

export function canonicalizeTrack(input: CanonicalTrackInput): CanonicalTrack {
  const sourceFields = resolveSourceFields(input);
  const mix = extractMixMetadata(sourceFields.title);
  const titleWithFeaturesRemoved = extractFeaturedArtists(mix.cleanTitle);
  const primaryArtists = buildPrimaryCredits(sourceFields.rawArtists);
  const featuredArtists = buildCredits(titleWithFeaturesRemoved.featuredArtists, "featured");
  const artistCredits = dedupeCredits([...primaryArtists, ...featuredArtists]);

  return {
    artistCredits,
    primaryArtist:
      artistCredits.find((credit) => credit.role === "primary")?.display ?? null,
    normalizedArtistKey: artistCredits
      .filter((credit) => credit.role === "primary")
      .map((credit) => credit.normalized)
      .join(" "),
    title: titleWithFeaturesRemoved.title,
    normalizedTitle: normalizeSearchText(titleWithFeaturesRemoved.title),
    mix,
    durationSeconds: parseDurationSeconds(input.duration ?? null),
    preferredFormats: DEFAULT_TRACK_SELECTION_POLICY.preferredFormats,
    availableFormats: normalizeFormats(input.availableFormats ?? []),
    provenance: {
      source: input.source,
      sourceTrackId: input.sourceTrackId,
      sourceUrl: input.sourceUrl,
      rawArtists: sourceFields.rawArtists,
      rawTitle: input.title,
      rawDuration: input.duration ?? null
    }
  };
}

export function extractMixMetadata(rawTitle: string): CanonicalMixMetadata {
  const titleWithoutPromotions = stripPromotionalLabels(rawTitle);
  const labelMatch = titleWithoutPromotions.match(TRAILING_LABEL_PATTERN);

  if (labelMatch) {
    const displayLabel = cleanDisplayText(labelMatch[1]);
    const classification = classifyMixLabel(displayLabel);
    const cleanTitle = cleanDisplayText(
      titleWithoutPromotions.slice(0, titleWithoutPromotions.length - labelMatch[0].length)
    );

    if (classification !== null) {
      return {
        cleanTitle,
        displayLabel,
        normalizedLabel: normalizeSearchText(displayLabel),
        ...classification,
        confidence: "high"
      };
    }

    return {
      cleanTitle,
      displayLabel,
      normalizedLabel: normalizeSearchText(displayLabel),
      kind: "variant",
      selectionClass: "reject",
      confidence: "high"
    };
  }

  return {
    cleanTitle: cleanDisplayText(titleWithoutPromotions),
    displayLabel: null,
    normalizedLabel: null,
    kind: "base",
    selectionClass: "fallback",
    confidence: "high"
  };
}

export function parseDurationSeconds(value: number | string | null): number | null {
  if (value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? coerceDurationNumber(value) : null;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  if (CLOCK_DURATION_PATTERN.test(trimmedValue)) {
    return trimmedValue
      .split(":")
      .map((part) => Number(part))
      .reduce((total, part) => total * 60 + part, 0);
  }

  if (NUMERIC_DURATION_PATTERN.test(trimmedValue)) {
    return coerceDurationNumber(Number(trimmedValue));
  }

  return null;
}

export function evaluateTrackCandidate(
  track: CanonicalTrack,
  policy = DEFAULT_TRACK_SELECTION_POLICY
): TrackDecision {
  const selectedFormat = selectPreferredFormat(
    track.availableFormats,
    policy.preferredFormats
  );

  if (selectedFormat === null) {
    return {
      outcome: "rejected",
      reason: "format-not-eligible",
      selectedFormat: null,
      details: "Candidate did not offer an approved MP3 or WAV asset."
    };
  }

  if (track.mix.kind === policy.preferredMixKinds[0]) {
    return {
      outcome: "accepted",
      reason: "accepted-extended-mix",
      selectedFormat,
      details: "Extended Mix matched the highest-priority mix preference."
    };
  }

  if (track.mix.kind === policy.preferredMixKinds[1]) {
    return {
      outcome: "accepted",
      reason: "accepted-original-mix",
      selectedFormat,
      details: "Original Mix matched the approved fallback preference order."
    };
  }

  if (
    track.mix.selectionClass === "fallback" &&
    track.mix.kind === policy.fallbackMixKind
  ) {
    if (track.durationSeconds === null) {
      return {
        outcome: "rejected",
        reason: "fallback-duration-missing",
        selectedFormat,
        details: "Versionless fallback candidates need a known duration."
      };
    }

    if (track.durationSeconds > policy.minimumFallbackDurationSeconds) {
      return {
        outcome: "accepted",
        reason: "accepted-base-version-fallback",
        selectedFormat,
        details: "Versionless track cleared the fallback duration threshold."
      };
    }

    return {
      outcome: "rejected",
      reason: "fallback-duration-too-short",
      selectedFormat,
      details: "Versionless fallback candidates must run longer than four minutes."
    };
  }

  return {
    outcome: "rejected",
    reason: "mix-version-not-eligible",
    selectedFormat,
    details: `${track.mix.displayLabel ?? "This version"} is outside the approved mix preference order.`
  };
}

export function buildMissDecision(reason: TrackMissReason): TrackDecision {
  return {
    outcome: "miss",
    reason,
    selectedFormat: null,
    details: MISS_REASON_DETAILS[reason]
  };
}

function resolveSourceFields(input: CanonicalTrackInput): {
  rawArtists: string[];
  title: string;
} {
  const explicitRawArtists = [...(input.artistNames ?? [])];

  if (input.artistName) {
    explicitRawArtists.push(input.artistName);
  }

  if (explicitRawArtists.length > 0) {
    return {
      rawArtists: explicitRawArtists.map(cleanDisplayText).filter(Boolean),
      title: cleanDisplayText(input.title)
    };
  }

  if (input.source === "soundcloud") {
    const splitTitle = input.title.split(/\s+-\s+/);

    if (splitTitle.length > 1) {
      const [artistSegment, ...titleSegments] = splitTitle;

      return {
        rawArtists: [cleanDisplayText(artistSegment)],
        title: cleanDisplayText(titleSegments.join(" - "))
      };
    }
  }

  return {
    rawArtists: [],
    title: cleanDisplayText(input.title)
  };
}

function buildPrimaryCredits(rawArtists: string[]): CanonicalArtistCredit[] {
  const credits: CanonicalArtistCredit[] = [];

  for (const rawArtist of rawArtists) {
    const featuredArtistMatch = rawArtist.match(FEATURED_ARTIST_PATTERN);
    const primaryArtistSegment = rawArtist.replace(FEATURED_ARTIST_PATTERN, "");

    credits.push(...buildCredits(splitArtistNames(primaryArtistSegment), "primary"));

    if (featuredArtistMatch) {
      credits.push(...buildCredits(splitArtistNames(featuredArtistMatch[1]), "featured"));
    }
  }

  return credits;
}

function buildCredits(
  names: string[],
  role: CanonicalArtistCredit["role"]
): CanonicalArtistCredit[] {
  return names
    .map(cleanDisplayText)
    .filter(Boolean)
    .map((name) => ({
      display: name,
      normalized: normalizeSearchText(name),
      role
    }));
}

function extractFeaturedArtists(title: string): {
  title: string;
  featuredArtists: string[];
} {
  const match = title.match(FEATURED_ARTIST_PATTERN);

  if (!match) {
    return { title: cleanDisplayText(title), featuredArtists: [] };
  }

  return {
    title: cleanDisplayText(title.slice(0, match.index)),
    featuredArtists: splitArtistNames(match[1])
  };
}

function splitArtistNames(value: string): string[] {
  return cleanDisplayText(value)
    .split(ARTIST_SEPARATOR_PATTERN)
    .map(cleanDisplayText)
    .filter(Boolean);
}

function dedupeCredits(credits: CanonicalArtistCredit[]): CanonicalArtistCredit[] {
  const seen = new Set<string>();

  return credits.filter((credit) => {
    const key = `${credit.role}:${credit.normalized}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function selectPreferredFormat(
  availableFormats: TrackAudioFormat[],
  preferredFormats: readonly TrackAudioFormat[]
): TrackAudioFormat | null {
  for (const format of preferredFormats) {
    if (availableFormats.includes(format)) {
      return format;
    }
  }

  return null;
}

function normalizeFormats(formats: string[]): TrackAudioFormat[] {
  const available = new Set<TrackAudioFormat>();

  for (const format of formats) {
    const normalized = format.trim().toLowerCase();

    if (normalized === "mp3" || normalized === "wav") {
      available.add(normalized);
    }
  }

  return [...available];
}

function classifyMixLabel(
  displayLabel: string
): Pick<CanonicalMixMetadata, "kind" | "selectionClass"> | null {
  const normalizedLabel = normalizeSearchText(displayLabel);

  if (normalizedLabel.includes("extended mix")) {
    return { kind: "extended", selectionClass: "preferred" };
  }

  if (normalizedLabel.includes("original mix")) {
    return { kind: "original", selectionClass: "preferred" };
  }

  if (/\b(mix|edit|remix|dub|vip|version|rework|bootleg)\b/.test(normalizedLabel)) {
    return { kind: "variant", selectionClass: "reject" };
  }

  return null;
}

function stripPromotionalLabels(value: string): string {
  let nextValue = cleanDisplayText(value);

  while (PROMOTIONAL_LABEL_PATTERN.test(nextValue)) {
    nextValue = cleanDisplayText(nextValue.replace(PROMOTIONAL_LABEL_PATTERN, ""));
  }

  return nextValue;
}

function cleanDisplayText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value: string): string {
  return cleanDisplayText(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function coerceDurationNumber(value: number): number {
  return value > 10_000 ? Math.round(value / 1_000) : Math.round(value);
}

const MISS_REASON_DETAILS: Record<TrackMissReason, string> = {
  "no-eligible-candidate": "No authorized candidate met the selection rules.",
  "no-authorized-source-match": "No authorized source matched the requested track."
};
