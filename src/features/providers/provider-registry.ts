import type {
  CanonicalConfidence,
  CanonicalTrack,
  TrackDecision,
  TrackMissReason
} from "../tracks/canonical-track";

export const PROVIDER_PRICE_TIERS = ["free", "free-or-owned", "paid"] as const;
export type ProviderPriceTier = (typeof PROVIDER_PRICE_TIERS)[number];

export const PROVIDER_AUTHORIZATION_BASES = [
  "uploader-enabled-download",
  "rights-holder-storefront",
  "purchase-entitlement"
] as const;
export type ProviderAuthorizationBasis =
  (typeof PROVIDER_AUTHORIZATION_BASES)[number];

export const PROVIDER_IMPLEMENTATION_BUCKETS = [
  "free-auto",
  "paid-review-queue"
] as const;
export type ProviderImplementationBucket =
  (typeof PROVIDER_IMPLEMENTATION_BUCKETS)[number];

export const PROVIDER_ARTIFACT_FORMATS = [
  "mp3",
  "wav",
  "aiff",
  "flac",
  "aac",
  "ogg-vorbis",
  "alac",
  "original-upload-format",
  "unknown"
] as const;
export type ProviderArtifactFormat = (typeof PROVIDER_ARTIFACT_FORMATS)[number];

export const PROVIDER_REJECTION_REASONS = [
  "auth-required",
  "provider-session-expired",
  "candidate-format-unavailable",
  "candidate-mix-rejected",
  "candidate-duration-too-short",
  "manual-review-required",
  "no-download-entitlement",
  "download-artifact-missing",
  "provider-error"
] as const;
export type ProviderRejectionReason = (typeof PROVIDER_REJECTION_REASONS)[number];

export const PROVIDER_MISS_REASONS = [
  "no-search-results",
  "no-authorized-candidate",
  "provider-not-configured"
] as const;
export type ProviderMissReason = (typeof PROVIDER_MISS_REASONS)[number];

export type ProviderTrackDecisionReason = Extract<
  TrackDecision,
  { outcome: "rejected" }
>["reason"];

export interface ProviderProvenance {
  discoveredVia:
    | "catalog"
    | "download-history"
    | "library"
    | "operator-input"
    | "search";
  providerTrackId?: string;
  providerUrl?: string;
  searchQuery?: string;
  sourcePageUrl?: string;
}

export interface ProviderCandidate {
  artistName: string;
  authorizationBasis: ProviderAuthorizationBasis;
  availableFormats: readonly ProviderArtifactFormat[];
  candidateId: string;
  durationSeconds: number | null;
  mixConfidence: CanonicalConfidence;
  mixLabel: string | null;
  priceTier: ProviderPriceTier;
  providerId: string;
  providerName: string;
  provenance: ProviderProvenance;
  title: string;
}

export interface ProviderArtifactMetadata {
  contentType?: string | null;
  fileExtension: string | null;
  fileName: string;
  format: ProviderArtifactFormat;
  sha256?: string | null;
  sizeBytes: number | null;
}

export interface ProviderReviewMetadata {
  queueName: string;
  summary: string;
}

export interface ProviderMiss {
  detail: string;
  providerId: string;
  providerName: string;
  reason: ProviderMissReason;
  trackMissReason: TrackMissReason;
}

export interface ProviderRejection {
  detail: string;
  providerId: string;
  providerName: string;
  reason: ProviderRejectionReason;
  retryable: boolean;
  trackDecisionReason?: ProviderTrackDecisionReason;
}

export interface ProviderCandidatesResult {
  outcome: "candidates";
  candidates: readonly ProviderCandidate[];
}

export interface ProviderMissResult {
  outcome: "miss";
  miss: ProviderMiss;
}

export interface ProviderRejectedResult {
  outcome: "rejected";
  candidate?: ProviderCandidate;
  rejection: ProviderRejection;
}

export interface ProviderAcquiredResult {
  outcome: "acquired";
  artifact: ProviderArtifactMetadata;
  candidate: ProviderCandidate;
}

export interface ProviderQueuedForReviewResult {
  outcome: "queued-for-review";
  candidate: ProviderCandidate;
  review: ProviderReviewMetadata;
}

export type ProviderSearchResult =
  | ProviderCandidatesResult
  | ProviderMissResult
  | ProviderRejectedResult;

export type ProviderAcquisitionResult =
  | ProviderAcquiredResult
  | ProviderMissResult
  | ProviderRejectedResult;

export type ProviderReviewQueueResult =
  | ProviderMissResult
  | ProviderQueuedForReviewResult
  | ProviderRejectedResult;

export interface ProviderSearchInput {
  track: CanonicalTrack;
}

export interface ProviderAcquireInput {
  candidate: ProviderCandidate;
  track: CanonicalTrack;
}

export interface ProviderReviewQueueInput {
  candidate: ProviderCandidate;
  track: CanonicalTrack;
}

interface BaseProviderDefinition<
  TMode extends ProviderRunMode,
  TPriceTier extends ProviderPriceTier,
  TBucket extends ProviderImplementationBucket
> {
  authorizationBasis: ProviderAuthorizationBasis;
  displayName: string;
  id: string;
  implementationBucket: TBucket;
  mode: TMode;
  priorityRank: number;
  priceTier: TPriceTier;
  search(input: ProviderSearchInput): Promise<ProviderSearchResult>;
  supportedFormats: readonly ProviderArtifactFormat[];
}

export interface AutomaticProviderDefinition
  extends BaseProviderDefinition<
    "automatic",
    Exclude<ProviderPriceTier, "paid">,
    "free-auto"
  > {
  acquire(input: ProviderAcquireInput): Promise<ProviderAcquisitionResult>;
}

export interface ReviewQueueProviderDefinition
  extends BaseProviderDefinition<"review", "paid", "paid-review-queue"> {
  queueForReview(
    input: ProviderReviewQueueInput
  ): Promise<ProviderReviewQueueResult>;
}

export type ProviderDefinition =
  | AutomaticProviderDefinition
  | ReviewQueueProviderDefinition;

export class DuplicateProviderRegistrationError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super(`Provider "${providerId}" is already registered.`);
    this.name = "DuplicateProviderRegistrationError";
    this.providerId = providerId;
  }
}

const IMPLEMENTATION_BUCKET_ORDER: Record<ProviderImplementationBucket, number> = {
  "free-auto": 0,
  "paid-review-queue": 1
};

const RETRYABLE_REJECTION_REASONS = new Set<ProviderRejectionReason>([
  "auth-required",
  "provider-session-expired",
  "download-artifact-missing",
  "provider-error"
]);

type ProviderRunMode = "automatic" | "review";

type AutomaticProviderOptions = Omit<
  AutomaticProviderDefinition,
  "implementationBucket" | "mode"
>;

type ReviewQueueProviderOptions = Omit<
  ReviewQueueProviderDefinition,
  "implementationBucket" | "mode" | "priceTier"
>;

export function defineAutomaticProvider(
  options: AutomaticProviderOptions
): AutomaticProviderDefinition {
  return {
    ...options,
    implementationBucket: "free-auto",
    mode: "automatic"
  };
}

export function defineReviewQueueProvider(
  options: ReviewQueueProviderOptions
): ReviewQueueProviderDefinition {
  return {
    ...options,
    implementationBucket: "paid-review-queue",
    mode: "review",
    priceTier: "paid"
  };
}

export function isAutomaticProvider(
  provider: ProviderDefinition
): provider is AutomaticProviderDefinition {
  return provider.mode === "automatic";
}

export function isReviewQueueProvider(
  provider: ProviderDefinition
): provider is ReviewQueueProviderDefinition {
  return provider.mode === "review";
}

export function compareProviders(
  left: ProviderDefinition,
  right: ProviderDefinition
) {
  const bucketDifference =
    IMPLEMENTATION_BUCKET_ORDER[left.implementationBucket] -
    IMPLEMENTATION_BUCKET_ORDER[right.implementationBucket];

  if (bucketDifference !== 0) {
    return bucketDifference;
  }

  if (left.priorityRank !== right.priorityRank) {
    return left.priorityRank - right.priorityRank;
  }

  return left.id.localeCompare(right.id);
}

export class ProviderRegistry {
  readonly #providers = new Map<string, ProviderDefinition>();

  constructor(providers: readonly ProviderDefinition[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  get(providerId: string) {
    return this.#providers.get(providerId) ?? null;
  }

  list() {
    return [...this.#providers.values()].sort(compareProviders);
  }

  listAutomatic() {
    return this.list().filter(isAutomaticProvider);
  }

  listReviewQueue() {
    return this.list().filter(isReviewQueueProvider);
  }

  register(provider: ProviderDefinition) {
    if (this.#providers.has(provider.id)) {
      throw new DuplicateProviderRegistrationError(provider.id);
    }

    this.#providers.set(provider.id, provider);

    return provider;
  }
}

export function buildProviderMissResult(input: {
  detail: string;
  providerId: string;
  providerName: string;
  reason: ProviderMissReason;
  trackMissReason: TrackMissReason;
}): ProviderMissResult {
  return {
    outcome: "miss",
    miss: {
      detail: input.detail,
      providerId: input.providerId,
      providerName: input.providerName,
      reason: input.reason,
      trackMissReason: input.trackMissReason
    }
  };
}

export function buildProviderRejectedResult(input: {
  candidate?: ProviderCandidate;
  detail: string;
  providerId: string;
  providerName: string;
  reason: ProviderRejectionReason;
  trackDecisionReason?: ProviderTrackDecisionReason;
}): ProviderRejectedResult {
  return {
    outcome: "rejected",
    candidate: input.candidate,
    rejection: {
      detail: input.detail,
      providerId: input.providerId,
      providerName: input.providerName,
      reason: input.reason,
      retryable: RETRYABLE_REJECTION_REASONS.has(input.reason),
      trackDecisionReason: input.trackDecisionReason
    }
  };
}
