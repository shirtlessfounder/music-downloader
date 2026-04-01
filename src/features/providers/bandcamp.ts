import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

import { BrowserSessionService } from "@/features/browser/browser-session-service";
import { canonicalizeTrack, type CanonicalTrack } from "@/features/tracks/canonical-track";

import {
  buildProviderMissResult,
  buildProviderRejectedResult,
  defineAutomaticProvider,
  type ProviderAcquireInput,
  type ProviderArtifactFormat,
  type ProviderCandidate,
  type ProviderSearchInput
} from "./provider-registry";
import { openAuthenticatedBackgroundProviderSession } from "./provider-browser-session";

export const BANDCAMP_PROVIDER_ID = "bandcamp";
export const BANDCAMP_PROVIDER_NAME = "Bandcamp";
export const BANDCAMP_SESSION_NAME = BANDCAMP_PROVIDER_ID;

const DEFAULT_BANDCAMP_BASE_URL = "https://bandcamp.com";
const SEARCH_RESULT_LINK_SELECTOR = [
  '[data-testid="bandcamp-search-result"]',
  'a[href*="/album/"]',
  'a[href*="/track/"]'
].join(", ");
const DOWNLOAD_LINK_SELECTOR = [
  '[data-testid="bandcamp-download-link"]',
  'a[download][data-format-key]',
  'a[download][href*="/download"]'
].join(", ");
const DOWNLOAD_PAGE_LINK_SELECTOR = [
  'a[data-entitlement][href*="/download"]:not([download])',
  'a[href*="/download"]:not([download])'
].join(", ");

type BandcampEntitlement =
  | "free"
  | "no-minimum"
  | "redeemable"
  | "owned"
  | "paid-only"
  | "unknown";

interface BandcampProviderDependencies {
  baseUrl?: string;
  browserSessionService: Pick<
    BrowserSessionService,
    "openSession" | "requireAuthenticatedSession"
  >;
  maxSearchResults?: number;
  sessionName?: string;
}

interface ParsedDownloadOption {
  contentType: string | null;
  fileName: string | null;
  formatKey: string | null;
  label: string | null;
  reacquireSelector: string | null;
}

interface ParsedReleaseSnapshot {
  artistName: string | null;
  downloadOptions: ParsedDownloadOption[];
  durationSeconds: number | null;
  entitlement: BandcampEntitlement;
  providerTrackId: string | null;
  providerUrl: string;
  title: string | null;
}

interface ParsedBandcampPageSnapshot extends ParsedReleaseSnapshot {
  downloadPageUrl: string | null;
}

type RankedDownloadFormat = Exclude<ProviderArtifactFormat, "unknown">;

interface RankedDownloadOption {
  format: RankedDownloadFormat;
  option: ParsedDownloadOption;
}

export function createBandcampProvider(
  dependencies: BandcampProviderDependencies
) {
  const baseUrl = dependencies.baseUrl ?? DEFAULT_BANDCAMP_BASE_URL;
  const maxSearchResults = dependencies.maxSearchResults ?? 5;
  const sessionName = dependencies.sessionName ?? BANDCAMP_SESSION_NAME;

  return defineAutomaticProvider({
    id: BANDCAMP_PROVIDER_ID,
    displayName: BANDCAMP_PROVIDER_NAME,
    sourceBasis: "rights-holder-storefront",
    priceTier: "free-or-owned",
    priorityRank: 20,
    supportedFormats: ["mp3", "wav", "aiff", "flac", "aac", "ogg-vorbis", "alac"],
    search: async (input) =>
      searchBandcamp({
        baseUrl,
        browserSessionService: dependencies.browserSessionService,
        input,
        maxSearchResults,
        sessionName
      }),
    acquire: async (input) =>
      acquireBandcampDownload({
        browserSessionService: dependencies.browserSessionService,
        input,
        sessionName
      })
  });
}

async function searchBandcamp(input: {
  baseUrl: string;
  browserSessionService: BandcampProviderDependencies["browserSessionService"];
  input: ProviderSearchInput;
  maxSearchResults: number;
  sessionName: string;
}) {
  const sessionResult = await openAuthenticatedSession(
    input.browserSessionService,
    input.sessionName
  );

  if ("outcome" in sessionResult) {
    return sessionResult;
  }

  const searchQuery = buildSearchQuery(input.input.track);

  try {
    return await sessionResult.withPage(async (page) => {
      await page.goto(buildSearchUrl(input.baseUrl, searchQuery), { waitUntil: "load" });

      const releaseUrls = (await readSearchResultUrls(page)).slice(0, input.maxSearchResults);

      if (releaseUrls.length === 0) {
        return buildProviderMissResult({
          detail: "No Bandcamp releases matched the requested artist/title search query.",
          providerId: BANDCAMP_PROVIDER_ID,
          providerName: BANDCAMP_PROVIDER_NAME,
          reason: "no-search-results",
          trackMissReason: "no-supported-source-match"
        });
      }

      const candidates: ProviderCandidate[] = [];
      let unavailableFormatDetail: string | null = null;
      let unauthorizedDetail: string | null = null;

      for (const releaseUrl of releaseUrls) {
        await page.goto(releaseUrl, { waitUntil: "load" });
        const snapshot = await parseReleaseSnapshot(page);

        if (!isTrackMatch(input.input.track, snapshot)) {
          continue;
        }

        if (!isAutoAcquirableEntitlement(snapshot.entitlement)) {
          unauthorizedDetail = buildUnauthorizedDetail(snapshot.entitlement);
          continue;
        }

        const availableFormats = resolveCandidateAvailableFormats(snapshot.downloadOptions);

        if (availableFormats.length === 0) {
          unavailableFormatDetail = buildUnavailableFormatDetail();
          continue;
        }

        candidates.push(buildCandidate(snapshot, searchQuery, availableFormats));
      }

      if (candidates.length > 0) {
        return {
          outcome: "candidates" as const,
          candidates
        };
      }

      if (unauthorizedDetail) {
        return buildProviderMissResult({
          detail: unauthorizedDetail,
          providerId: BANDCAMP_PROVIDER_ID,
          providerName: BANDCAMP_PROVIDER_NAME,
          reason: "no-supported-candidate",
          trackMissReason: "no-supported-source-match"
        });
      }

      if (unavailableFormatDetail) {
        return buildProviderMissResult({
          detail: unavailableFormatDetail,
          providerId: BANDCAMP_PROVIDER_ID,
          providerName: BANDCAMP_PROVIDER_NAME,
          reason: "no-supported-candidate",
          trackMissReason: "no-supported-source-match"
        });
      }

      return buildProviderMissResult({
        detail:
          "Bandcamp search results did not contain an exact artist/title match for the requested track.",
        providerId: BANDCAMP_PROVIDER_ID,
        providerName: BANDCAMP_PROVIDER_NAME,
        reason: "no-search-results",
        trackMissReason: "no-supported-source-match"
      });
    });
  } catch (error) {
    return buildProviderRejectedResult({
      detail: buildProviderErrorDetail(
        "Bandcamp search failed while checking free-or-owned download entitlements.",
        error
      ),
      providerId: BANDCAMP_PROVIDER_ID,
      providerName: BANDCAMP_PROVIDER_NAME,
      reason: "provider-error"
    });
  } finally {
    await sessionResult.close();
  }
}

async function acquireBandcampDownload(input: {
  browserSessionService: BandcampProviderDependencies["browserSessionService"];
  input: ProviderAcquireInput;
  sessionName: string;
}) {
  const sessionResult = await openAuthenticatedSession(
    input.browserSessionService,
    input.sessionName
  );

  if ("outcome" in sessionResult) {
    return sessionResult;
  }

  const releaseUrl =
    input.input.candidate.provenance.providerUrl ??
    input.input.candidate.provenance.sourcePageUrl;

  if (!releaseUrl) {
    return buildProviderRejectedResult({
      candidate: input.input.candidate,
      detail: "Bandcamp candidate was missing the release URL required for download.",
      providerId: BANDCAMP_PROVIDER_ID,
      providerName: BANDCAMP_PROVIDER_NAME,
      reason: "download-artifact-missing"
    });
  }

  try {
    const snapshot = await sessionResult.withPage(async (page) => {
      await page.goto(releaseUrl, { waitUntil: "load" });
      return parseReleaseSnapshot(page);
    });

    if (!isAutoAcquirableEntitlement(snapshot.entitlement)) {
      return buildProviderRejectedResult({
        candidate: input.input.candidate,
        detail:
          "Bandcamp candidate is no longer entitled for automatic free-or-owned download acquisition.",
        providerId: BANDCAMP_PROVIDER_ID,
        providerName: BANDCAMP_PROVIDER_NAME,
        reason: "no-download-entitlement"
      });
    }

    const preferredDownload = selectPreferredDownloadOption(snapshot.downloadOptions);

    if (!preferredDownload) {
      return buildProviderRejectedResult({
        candidate: input.input.candidate,
        detail:
          "Bandcamp release exposed an entitled download, but none of the download formats mapped to the shared provider contract.",
        providerId: BANDCAMP_PROVIDER_ID,
        providerName: BANDCAMP_PROVIDER_NAME,
        reason: "candidate-format-unavailable"
      });
    }

    const download = await sessionResult.captureDownload({
      trigger: async (page) => {
        const locator =
          preferredDownload.option.reacquireSelector === null
            ? page.locator(DOWNLOAD_LINK_SELECTOR).first()
            : page.locator(preferredDownload.option.reacquireSelector).first();

        await locator.click();
      }
    });
    const artifact = await buildArtifactMetadata(
      download.path,
      download.suggestedFilename,
      preferredDownload.option.contentType
    );

    return {
      outcome: "acquired" as const,
      artifact,
      candidate: input.input.candidate
    };
  } catch (error) {
    return buildProviderRejectedResult({
      candidate: input.input.candidate,
      detail: buildProviderErrorDetail(
        "Bandcamp acquisition failed while downloading an entitled release.",
        error
      ),
      providerId: BANDCAMP_PROVIDER_ID,
      providerName: BANDCAMP_PROVIDER_NAME,
      reason: "provider-error"
    });
  } finally {
    await sessionResult.close();
  }
}

async function openAuthenticatedSession(
  browserSessionService: BandcampProviderDependencies["browserSessionService"],
  sessionName: string
) {
  return openAuthenticatedBackgroundProviderSession({
    authRequiredDetail:
      "An authenticated Bandcamp browser session is required before automatic downloads can run.",
    browserSessionService,
    expiredDetail:
      "The Bandcamp browser session expired and must be refreshed before automatic downloads can run.",
    providerId: BANDCAMP_PROVIDER_ID,
    providerName: BANDCAMP_PROVIDER_NAME,
    sessionName
  });
}

function buildSearchQuery(track: CanonicalTrack) {
  return [track.primaryArtist, track.title, track.mix.displayLabel]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function buildSearchUrl(baseUrl: string, query: string) {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  return url.toString();
}

async function readSearchResultUrls(page: Page) {
  return page.evaluate((selector) => {
    const urls = new Set<string>();

    for (const element of document.querySelectorAll(selector)) {
      if (!(element instanceof HTMLAnchorElement)) {
        continue;
      }

      const href = element.getAttribute("href");

      if (!href) {
        continue;
      }

      urls.add(new URL(href, window.location.href).toString());
    }

    return [...urls];
  }, SEARCH_RESULT_LINK_SELECTOR);
}

async function parseReleaseSnapshot(page: Page): Promise<ParsedReleaseSnapshot> {
  const releasePageSnapshot = await readBandcampPageSnapshot(page);

  if (
    releasePageSnapshot.downloadOptions.length > 0 ||
    releasePageSnapshot.downloadPageUrl === null
  ) {
    return toReleaseSnapshot(releasePageSnapshot);
  }

  await page.goto(releasePageSnapshot.downloadPageUrl, { waitUntil: "load" });
  const downloadPageSnapshot = await readBandcampPageSnapshot(page);

  return {
    ...toReleaseSnapshot(releasePageSnapshot),
    downloadOptions: downloadPageSnapshot.downloadOptions,
    entitlement: mergeEntitlement(
      releasePageSnapshot.entitlement,
      downloadPageSnapshot.entitlement
    )
  };
}

async function readBandcampPageSnapshot(page: Page): Promise<ParsedBandcampPageSnapshot> {
  return page.evaluate(
    ({ downloadLinkSelector, downloadPageLinkSelector }) => {
      const recording = readMusicRecordingStructuredData();
      const artistName =
        readMetaValue("bandcamp:artist_name") ??
        readTextContent('[data-testid="bandcamp-artist-name"]') ??
        readMusicRecordingArtistName(recording) ??
        null;
      const title =
        readMusicRecordingTextField(recording, "name") ??
        readMetaValue("og:title") ??
        readHeadingText() ??
        null;
      const providerTrackId =
        readMusicRecordingTextField(recording, "identifier") ??
        readMetaValue("bandcamp:track_id") ??
        null;
      const providerUrl =
        readMusicRecordingTextField(recording, "url") ??
        readMetaValue("og:url") ??
        window.location.href;
      const durationSeconds =
        parseNumber(readMetaValue("bandcamp:duration_seconds")) ??
        parseIsoDurationSeconds(readMusicRecordingTextField(recording, "duration"));
      const entitlement = normalizeEntitlement(
        readBandcampEntitlement() ?? readPaidOnlyMessage() ?? null
      );
      const downloadOptions = [...document.querySelectorAll(downloadLinkSelector)]
        .map((element) => {
          if (!(element instanceof HTMLAnchorElement)) {
            return null;
          }

          return {
            contentType: element.getAttribute("type"),
            fileName: readAuthorizedDownloadFileName(element),
            formatKey: element.getAttribute("data-format-key")?.trim() || null,
            label: element.textContent?.trim() || null,
            reacquireSelector: buildAuthorizedDownloadSelector(element)
          };
        })
        .filter((option): option is NonNullable<typeof option> => option !== null);
      const downloadPageUrl = readDownloadPageUrl();

      return {
        artistName,
        downloadOptions,
        downloadPageUrl,
        durationSeconds,
        entitlement,
        providerTrackId,
        providerUrl,
        title
      };

      function readBandcampEntitlement() {
        const releaseRoot = document.querySelector('[data-testid="bandcamp-release"]');
        const datasetValue =
          releaseRoot?.getAttribute("data-bandcamp-entitlement")?.trim() ?? null;

        if (datasetValue) {
          return datasetValue;
        }

        const explicitEntitlement = readTextContent('[data-testid="bandcamp-entitlement"]');

        if (explicitEntitlement) {
          return explicitEntitlement;
        }

        for (const element of document.querySelectorAll("[data-entitlement]")) {
          const value = element.getAttribute("data-entitlement")?.trim();

          if (value) {
            return value;
          }
        }

        return null;
      }

      function readPaidOnlyMessage() {
        return readTextContent('[data-testid="bandcamp-paid-message"]');
      }

      function readDownloadPageUrl() {
        const link = document.querySelector(downloadPageLinkSelector);

        if (!(link instanceof HTMLAnchorElement)) {
          return null;
        }

        const href = link.getAttribute("href");

        if (!href) {
          return null;
        }

        try {
          return new URL(href, window.location.href).toString();
        } catch {
          return null;
        }
      }

      function readMusicRecordingStructuredData() {
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
          const payload = parseJson(script.textContent);

          for (const candidate of flattenStructuredData(payload)) {
            if (
              candidate &&
              typeof candidate === "object" &&
              normalizeStructuredDataType((candidate as { "@type"?: unknown })["@type"]) ===
                "musicrecording"
            ) {
              return candidate as Record<string, unknown>;
            }
          }
        }

        return null;
      }

      function readMusicRecordingArtistName(recording: Record<string, unknown> | null) {
        if (!recording) {
          return null;
        }

        const byArtist = recording.byArtist;

        if (typeof byArtist === "string") {
          return byArtist.trim() || null;
        }

        if (byArtist && typeof byArtist === "object") {
          const name = (byArtist as { name?: unknown }).name;

          if (typeof name === "string") {
            return name.trim() || null;
          }
        }

        return null;
      }

      function readMusicRecordingTextField(
        recording: Record<string, unknown> | null,
        field: string
      ) {
        if (!recording) {
          return null;
        }

        const value = recording[field];

        if (typeof value === "string") {
          const trimmedValue = value.trim();
          return trimmedValue || null;
        }

        if (typeof value === "number") {
          return String(value);
        }

        return null;
      }

      function readAuthorizedDownloadFileName(anchor: HTMLAnchorElement) {
        const explicitFileName = anchor.getAttribute("download")?.trim();

        if (explicitFileName) {
          return explicitFileName;
        }

        try {
          const href = new URL(anchor.href, window.location.href);
          const fileName = href.pathname.split("/").pop()?.trim();
          return fileName || null;
        } catch {
          return null;
        }
      }

      function buildAuthorizedDownloadSelector(anchor: HTMLAnchorElement) {
        const selectorParts = ["a"];
        const explicitFileName = anchor.getAttribute("download");
        const formatKey = anchor.getAttribute("data-format-key")?.trim();
        const href = anchor.getAttribute("href")?.trim();

        if (explicitFileName !== null) {
          const trimmedFileName = explicitFileName.trim();
          selectorParts.push(
            trimmedFileName ? `[download="${CSS.escape(trimmedFileName)}"]` : "[download]"
          );
        }

        if (formatKey) {
          selectorParts.push(`[data-format-key="${CSS.escape(formatKey)}"]`);
        }

        if (href) {
          selectorParts.push(`[href="${CSS.escape(href)}"]`);
        }

        return selectorParts.length > 1 ? selectorParts.join("") : null;
      }

      function readMetaValue(name: string) {
        const meta =
          document.querySelector(`meta[name="${name}"]`) ??
          document.querySelector(`meta[property="${name}"]`);

        if (!(meta instanceof HTMLMetaElement)) {
          return null;
        }

        const content = meta.content.trim();
        return content || null;
      }

      function readTextContent(selector: string) {
        const element = document.querySelector(selector);
        const text = element?.textContent?.trim() ?? null;
        return text || null;
      }

      function readHeadingText() {
        const heading = document.querySelector("h1");
        const text = heading?.textContent?.trim() ?? null;
        return text || null;
      }

      function flattenStructuredData(payload: unknown): unknown[] {
        if (!payload) {
          return [];
        }

        if (Array.isArray(payload)) {
          return payload.flatMap((entry) => flattenStructuredData(entry));
        }

        if (typeof payload === "object") {
          const graph = (payload as { "@graph"?: unknown })["@graph"];

          if (Array.isArray(graph)) {
            return [payload, ...graph.flatMap((entry) => flattenStructuredData(entry))];
          }

          return [payload];
        }

        return [];
      }

      function normalizeStructuredDataType(value: unknown) {
        if (Array.isArray(value)) {
          return value.join(" ").toLowerCase();
        }

        if (typeof value === "string") {
          return value.toLowerCase();
        }

        return "";
      }

      function parseJson(value: string | null) {
        if (!value) {
          return null;
        }

        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }

      function parseNumber(value: string | null) {
        if (!value) {
          return null;
        }

        const nextValue = Number(value);
        return Number.isFinite(nextValue) ? Math.round(nextValue) : null;
      }

      function parseIsoDurationSeconds(value: string | null) {
        if (!value) {
          return null;
        }

        const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);

        if (!match) {
          return null;
        }

        const hours = Number(match[1] ?? 0);
        const minutes = Number(match[2] ?? 0);
        const seconds = Number(match[3] ?? 0);

        return hours * 3600 + minutes * 60 + seconds;
      }

      function normalizeEntitlement(value: string | null): BandcampEntitlement {
        if (!value) {
          return "unknown";
        }

        const normalizedValue = value.trim().toLowerCase();

        if (normalizedValue.includes("no-minimum")) {
          return "no-minimum";
        }

        if (normalizedValue.includes("redeem")) {
          return "redeemable";
        }

        if (normalizedValue.includes("owned")) {
          return "owned";
        }

        if (
          normalizedValue.includes("paid-only") ||
          normalizedValue.includes("paid checkout") ||
          normalizedValue.includes("purchase")
        ) {
          return "paid-only";
        }

        if (normalizedValue.includes("free")) {
          return "free";
        }

        return "unknown";
      }
    },
    {
      downloadLinkSelector: DOWNLOAD_LINK_SELECTOR,
      downloadPageLinkSelector: DOWNLOAD_PAGE_LINK_SELECTOR
    }
  );
}

function toReleaseSnapshot(snapshot: ParsedBandcampPageSnapshot): ParsedReleaseSnapshot {
  return {
    artistName: snapshot.artistName,
    downloadOptions: snapshot.downloadOptions,
    durationSeconds: snapshot.durationSeconds,
    entitlement: snapshot.entitlement,
    providerTrackId: snapshot.providerTrackId,
    providerUrl: snapshot.providerUrl,
    title: snapshot.title
  };
}

function mergeEntitlement(
  releasePageEntitlement: BandcampEntitlement,
  downloadPageEntitlement: BandcampEntitlement
): BandcampEntitlement {
  return releasePageEntitlement === "unknown"
    ? downloadPageEntitlement
    : releasePageEntitlement;
}

function isTrackMatch(track: CanonicalTrack, snapshot: ParsedReleaseSnapshot) {
  if (!snapshot.artistName || !snapshot.title) {
    return false;
  }

  const candidateTrack = canonicalizeTrack({
    artistName: snapshot.artistName,
    duration: snapshot.durationSeconds,
    source: BANDCAMP_PROVIDER_ID,
    sourceTrackId: snapshot.providerTrackId ?? undefined,
    sourceUrl: snapshot.providerUrl,
    title: snapshot.title
  });

  if (candidateTrack.normalizedTitle !== track.normalizedTitle) {
    return false;
  }

  if (
    track.primaryArtist &&
    candidateTrack.primaryArtist &&
    normalizeSearchText(candidateTrack.primaryArtist) !==
      normalizeSearchText(track.primaryArtist)
  ) {
    return false;
  }

  if (track.mix.normalizedLabel) {
    return candidateTrack.mix.normalizedLabel === track.mix.normalizedLabel;
  }

  return true;
}

function isAutoAcquirableEntitlement(entitlement: BandcampEntitlement) {
  return (
    entitlement === "free" ||
    entitlement === "no-minimum" ||
    entitlement === "redeemable" ||
    entitlement === "owned"
  );
}

function buildCandidate(
  snapshot: ParsedReleaseSnapshot,
  searchQuery: string,
  availableFormats: readonly ProviderArtifactFormat[]
): ProviderCandidate {
  const candidateTrack = canonicalizeTrack({
    artistName: snapshot.artistName ?? "",
    duration: snapshot.durationSeconds,
    source: BANDCAMP_PROVIDER_ID,
    sourceTrackId: snapshot.providerTrackId ?? undefined,
    sourceUrl: snapshot.providerUrl,
    title: snapshot.title ?? ""
  });

  return {
    artistName: candidateTrack.primaryArtist ?? snapshot.artistName ?? "Unknown Artist",
    sourceBasis: "rights-holder-storefront",
    availableFormats,
    candidateId: snapshot.providerTrackId ?? snapshot.providerUrl,
    durationSeconds: snapshot.durationSeconds,
    mixConfidence: candidateTrack.mix.confidence,
    mixLabel: candidateTrack.mix.displayLabel,
    priceTier: "free-or-owned",
    providerId: BANDCAMP_PROVIDER_ID,
    providerName: BANDCAMP_PROVIDER_NAME,
    provenance: {
      discoveredVia: "search",
      providerTrackId: snapshot.providerTrackId ?? undefined,
      providerUrl: snapshot.providerUrl,
      searchQuery,
      sourcePageUrl: snapshot.providerUrl
    },
    title: candidateTrack.title
  };
}

function resolveCandidateAvailableFormats(downloadOptions: readonly ParsedDownloadOption[]) {
  const availableFormats = new Set<ProviderArtifactFormat>();

  for (const option of downloadOptions) {
    const format = inferBandcampFormat(option);

    if (format !== "unknown") {
      availableFormats.add(format);
    }
  }

  return BANDCAMP_FORMAT_ORDER.filter((format) => availableFormats.has(format));
}

function selectPreferredDownloadOption(
  downloadOptions: readonly ParsedDownloadOption[]
): RankedDownloadOption | null {
  const rankedOptions = downloadOptions
    .map((option) => {
      const format = inferBandcampFormat(option);

      if (format === "unknown") {
        return null;
      }

      return {
        format,
        option
      };
    })
    .filter((option): option is RankedDownloadOption => option !== null)
    .sort(compareDownloadOptions);

  return rankedOptions[0] ?? null;
}

function compareDownloadOptions(left: RankedDownloadOption, right: RankedDownloadOption) {
  const formatDifference =
    DOWNLOAD_PREFERENCE_ORDER[left.format] - DOWNLOAD_PREFERENCE_ORDER[right.format];

  if (formatDifference !== 0) {
    return formatDifference;
  }

  const variantDifference =
    resolveMp3VariantRank(left.option.formatKey) - resolveMp3VariantRank(right.option.formatKey);

  if (variantDifference !== 0) {
    return variantDifference;
  }

  return (left.option.fileName ?? "").localeCompare(right.option.fileName ?? "");
}

function resolveMp3VariantRank(formatKey: string | null) {
  switch (normalizeSearchText(formatKey ?? "")) {
    case "mp3 320":
      return 0;
    case "mp3 v0":
      return 1;
    case "mp3":
      return 2;
    default:
      return 3;
  }
}

function inferBandcampFormat(option: ParsedDownloadOption): ProviderArtifactFormat {
  const normalizedKey = normalizeSearchText(option.formatKey ?? option.label ?? "");

  switch (normalizedKey) {
    case "mp3 v0":
    case "mp3 320":
    case "mp3":
      return "mp3";
    case "wav":
      return "wav";
    case "aif":
    case "aiff":
      return "aiff";
    case "flac":
      return "flac";
    case "aac":
      return "aac";
    case "ogg":
    case "oga":
    case "ogg vorbis":
    case "vorbis":
      return "ogg-vorbis";
    case "alac":
      return "alac";
    default:
      return inferArtifactFormat(
        normalizeFileExtension(option.fileName ?? ""),
        option.contentType
      );
  }
}

function buildUnauthorizedDetail(entitlement: BandcampEntitlement) {
  if (entitlement === "paid-only") {
    return (
      "Matched Bandcamp release still requires a paid checkout and is outside the current " +
      "free-or-owned acquisition scope."
    );
  }

  return (
    "Matched Bandcamp release did not expose a free, no-minimum, redeemable, or already-owned " +
    "download entitlement for automatic acquisition."
  );
}

function buildUnavailableFormatDetail() {
  return (
    "Matched Bandcamp release exposed an entitled download, but none of the advertised formats " +
    "mapped to the shared provider contract."
  );
}

async function buildArtifactMetadata(
  downloadPath: string,
  suggestedFilename: string,
  contentType: string | null
) {
  const normalizedContentType =
    normalizeContentType(contentType) ?? inferContentType(suggestedFilename);
  const fileBuffer = await readFile(downloadPath);
  const fileStats = await stat(downloadPath);
  const fileExtension = normalizeFileExtension(suggestedFilename);

  return {
    contentType: normalizedContentType,
    fileExtension,
    fileName: suggestedFilename,
    format: inferArtifactFormat(fileExtension, normalizedContentType),
    localFilePath: downloadPath,
    sha256: createHash("sha256").update(fileBuffer).digest("hex"),
    sizeBytes: fileStats.size
  };
}

function normalizeFileExtension(fileName: string) {
  const extension = path.extname(fileName).replace(/^\./, "").trim().toLowerCase();
  return extension || null;
}

function inferArtifactFormat(
  fileExtension: string | null,
  contentType: string | null
): ProviderArtifactFormat {
  switch (fileExtension) {
    case "mp3":
      return "mp3";
    case "wav":
      return "wav";
    case "aif":
    case "aiff":
      return "aiff";
    case "flac":
      return "flac";
    case "aac":
      return "aac";
    case "ogg":
    case "oga":
      return "ogg-vorbis";
    case "m4a":
      return normalizedContentTypeIs(contentType, "audio/alac") ? "alac" : "aac";
    default:
      return inferArtifactFormatFromContentType(contentType);
  }
}

function inferArtifactFormatFromContentType(
  contentType: string | null
): ProviderArtifactFormat {
  switch (normalizeContentType(contentType)) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "audio/aiff":
    case "audio/x-aiff":
      return "aiff";
    case "audio/flac":
    case "audio/x-flac":
      return "flac";
    case "audio/aac":
    case "audio/x-aac":
    case "audio/mp4":
      return "aac";
    case "audio/ogg":
    case "audio/vorbis":
    case "application/ogg":
      return "ogg-vorbis";
    case "audio/alac":
      return "alac";
    default:
      return "unknown";
  }
}

function normalizeContentType(contentType: string | null) {
  const normalizedContentType = contentType?.trim().toLowerCase();
  return normalizedContentType || null;
}

function inferContentType(fileName: string) {
  switch (normalizeFileExtension(fileName)) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "aif":
    case "aiff":
      return "audio/aiff";
    case "flac":
      return "audio/flac";
    case "aac":
      return "audio/aac";
    case "m4a":
      return "audio/mp4";
    case "ogg":
    case "oga":
      return "audio/ogg";
    default:
      return null;
  }
}

function normalizedContentTypeIs(contentType: string | null, expected: string) {
  return normalizeContentType(contentType) === expected;
}

function buildProviderErrorDetail(message: string, error: unknown) {
  if (error instanceof Error && error.message) {
    return `${message} ${error.message}`;
  }

  return message;
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const BANDCAMP_FORMAT_ORDER: readonly ProviderArtifactFormat[] = [
  "mp3",
  "wav",
  "aiff",
  "flac",
  "aac",
  "ogg-vorbis",
  "alac"
];

const DOWNLOAD_PREFERENCE_ORDER: Record<ProviderArtifactFormat, number> = {
  mp3: 0,
  wav: 1,
  aiff: 2,
  flac: 3,
  aac: 4,
  "ogg-vorbis": 5,
  alac: 6,
  "original-upload-format": 7,
  unknown: 8
};
