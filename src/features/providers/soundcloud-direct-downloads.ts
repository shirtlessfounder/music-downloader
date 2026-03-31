import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Page } from "playwright";

import {
  BrowserSessionService,
  ExpiredBrowserSessionAuthStateError,
  MissingBrowserSessionAuthStateError,
  MissingBrowserSessionStateError
} from "@/features/browser/browser-session-service";
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

export const SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID = "soundcloud-direct-downloads";
export const SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME =
  "SoundCloud Direct Downloads";
export const SOUNDCLOUD_DIRECT_DOWNLOADS_SESSION_NAME =
  SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID;

const DEFAULT_SOUNDCLOUD_BASE_URL = "https://soundcloud.com";
const AUTHORIZED_DOWNLOAD_SELECTOR = [
  '[data-testid="authorized-download-link"]',
  'a[download]',
  'a[aria-label*="download" i][href]',
  'a[title*="download" i][href]'
].join(", ");
const EXTERNAL_DOWNLOAD_SELECTOR = [
  '[data-testid="external-download-link"]',
  'a[aria-label*="download" i][href]:not([download])',
  'a[title*="download" i][href]:not([download])',
  'a[aria-label*="buy" i][href]:not([download])',
  'a[title*="buy" i][href]:not([download])'
].join(", ");
const SEARCH_RESULT_LINK_SELECTOR = [
  '[data-testid="soundcloud-track-link"]',
  "a.soundTitle__title",
  "a[itemprop='url']"
].join(", ");

interface SoundCloudDirectDownloadsProviderDependencies {
  baseUrl?: string;
  browserSessionService: Pick<
    BrowserSessionService,
    "openSession" | "requireAuthenticatedSession"
  >;
  maxSearchResults?: number;
  sessionName?: string;
}

interface ParsedTrackSnapshot {
  artistName: string | null;
  download:
    | {
        contentType: string | null;
        kind: "authorized";
      }
    | {
        externalUrl: string | null;
        kind: "external";
      }
    | {
        kind: "disabled";
      };
  durationSeconds: number | null;
  providerTrackId: string | null;
  providerUrl: string;
  title: string | null;
}

export function createSoundCloudDirectDownloadsProvider(
  dependencies: SoundCloudDirectDownloadsProviderDependencies
) {
  const baseUrl = dependencies.baseUrl ?? DEFAULT_SOUNDCLOUD_BASE_URL;
  const maxSearchResults = dependencies.maxSearchResults ?? 5;
  const sessionName =
    dependencies.sessionName ?? SOUNDCLOUD_DIRECT_DOWNLOADS_SESSION_NAME;

  return defineAutomaticProvider({
    id: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
    displayName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
    authorizationBasis: "uploader-enabled-download",
    priceTier: "free",
    priorityRank: 10,
    supportedFormats: ["original-upload-format"],
    search: async (input) =>
      searchSoundCloudDirectDownloads({
        baseUrl,
        browserSessionService: dependencies.browserSessionService,
        input,
        maxSearchResults,
        sessionName
      }),
    acquire: async (input) =>
      acquireSoundCloudDirectDownload({
        baseUrl,
        browserSessionService: dependencies.browserSessionService,
        input,
        sessionName
      })
  });
}

async function searchSoundCloudDirectDownloads(input: {
  baseUrl: string;
  browserSessionService: SoundCloudDirectDownloadsProviderDependencies["browserSessionService"];
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

      const trackUrls = (await readSearchResultUrls(page)).slice(0, input.maxSearchResults);

      if (trackUrls.length === 0) {
        return buildProviderMissResult({
          detail:
            "No SoundCloud tracks matched the requested artist/title search query.",
          providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
          providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
          reason: "no-search-results",
          trackMissReason: "no-authorized-source-match"
        });
      }

      const candidates: ProviderCandidate[] = [];
      let unauthorizedDetail: string | null = null;

      for (const trackUrl of trackUrls) {
        await page.goto(trackUrl, { waitUntil: "load" });
        const snapshot = await parseTrackSnapshot(page);

        if (!isTrackMatch(input.input.track, snapshot)) {
          continue;
        }

        if (snapshot.download.kind === "authorized") {
          candidates.push(buildCandidate(snapshot, searchQuery));
          continue;
        }

        unauthorizedDetail = buildUnauthorizedDownloadDetail(snapshot.download);
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
          providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
          providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
          reason: "no-authorized-candidate",
          trackMissReason: "no-authorized-source-match"
        });
      }

      return buildProviderMissResult({
        detail:
          "SoundCloud search results did not contain an exact artist/title match for the requested track.",
        providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
        providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
        reason: "no-search-results",
        trackMissReason: "no-authorized-source-match"
      });
    });
  } catch (error) {
    return buildProviderRejectedResult({
      detail: buildProviderErrorDetail(
        "SoundCloud search failed while checking uploader-enabled downloads.",
        error
      ),
      providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
      providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
      reason: "provider-error"
    });
  } finally {
    await sessionResult.close();
  }
}

async function acquireSoundCloudDirectDownload(input: {
  baseUrl: string;
  browserSessionService: SoundCloudDirectDownloadsProviderDependencies["browserSessionService"];
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

  const trackUrl =
    input.input.candidate.provenance.providerUrl ??
    input.input.candidate.provenance.sourcePageUrl;

  if (!trackUrl) {
    return buildProviderRejectedResult({
      candidate: input.input.candidate,
      detail: "SoundCloud candidate was missing the track page URL required for download.",
      providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
      providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
      reason: "download-artifact-missing"
    });
  }

  try {
    await sessionResult.withPage(async (page) => {
      await page.goto(trackUrl, { waitUntil: "load" });
    });

    const snapshot = await sessionResult.withPage(parseTrackSnapshot);

    if (snapshot.download.kind !== "authorized") {
      return buildProviderRejectedResult({
        candidate: input.input.candidate,
        detail: buildUnauthorizedDownloadDetail(snapshot.download),
        providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
        providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
        reason: "no-download-entitlement"
      });
    }

    const download = await sessionResult.captureDownload({
      trigger: async (page) => {
        await page.locator(AUTHORIZED_DOWNLOAD_SELECTOR).first().click();
      }
    });
    const artifact = await buildArtifactMetadata(
      download.path,
      download.suggestedFilename,
      snapshot.download.contentType
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
        "SoundCloud acquisition failed while downloading the original uploaded file.",
        error
      ),
      providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
      providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
      reason: "provider-error"
    });
  } finally {
    await sessionResult.close();
  }
}

async function openAuthenticatedSession(
  browserSessionService: SoundCloudDirectDownloadsProviderDependencies["browserSessionService"],
  sessionName: string
) {
  try {
    await browserSessionService.requireAuthenticatedSession(sessionName);
  } catch (error) {
    if (
      error instanceof MissingBrowserSessionStateError ||
      error instanceof MissingBrowserSessionAuthStateError
    ) {
      return buildProviderRejectedResult({
        detail:
          "An authenticated SoundCloud browser session is required before automatic downloads can run.",
        providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
        providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
        reason: "auth-required"
      });
    }

    if (error instanceof ExpiredBrowserSessionAuthStateError) {
      return buildProviderRejectedResult({
        detail:
          "The SoundCloud browser session expired and must be refreshed before automatic downloads can run.",
        providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
        providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
        reason: "provider-session-expired"
      });
    }

    throw error;
  }

  return browserSessionService.openSession({ sessionName });
}

function buildSearchQuery(track: CanonicalTrack) {
  return [
    track.primaryArtist,
    track.title,
    track.mix.displayLabel
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function buildSearchUrl(baseUrl: string, query: string) {
  const url = new URL("/search/sounds", baseUrl);
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

async function parseTrackSnapshot(page: Page): Promise<ParsedTrackSnapshot> {
  return page.evaluate(
    ({ authorizedDownloadSelector, externalDownloadSelector }) => {
      const recording = readMusicRecordingStructuredData();
      const artistName =
        readMetaValue("soundcloud:artist_name") ??
        readMusicRecordingArtistName(recording) ??
        null;
      const title =
        readMusicRecordingTextField(recording, "name") ??
        readMetaValue("og:title") ??
        readHeadingText() ??
        null;
      const providerTrackId =
        readMusicRecordingTextField(recording, "identifier") ??
        readMetaValue("soundcloud:track_id") ??
        null;
      const providerUrl =
        readMusicRecordingTextField(recording, "url") ??
        readMetaValue("og:url") ??
        window.location.href;
      const durationSeconds =
        parseNumber(readMetaValue("soundcloud:duration_seconds")) ??
        parseIsoDurationSeconds(readMusicRecordingTextField(recording, "duration"));
      const authorizedDownload = document.querySelector(authorizedDownloadSelector);

      if (authorizedDownload instanceof HTMLAnchorElement) {
        return {
          artistName,
          download: {
            contentType: authorizedDownload.getAttribute("type"),
            kind: "authorized" as const
          },
          durationSeconds,
          providerTrackId,
          providerUrl,
          title
        };
      }

      const externalDownload = document.querySelector(externalDownloadSelector);

      if (externalDownload instanceof HTMLAnchorElement) {
        return {
          artistName,
          download: {
            externalUrl: externalDownload.href,
            kind: "external" as const
          },
          durationSeconds,
          providerTrackId,
          providerUrl,
          title
        };
      }

      return {
        artistName,
        download: {
          kind: "disabled" as const
        },
        durationSeconds,
        providerTrackId,
        providerUrl,
        title
      };

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

      function readHeadingText() {
        const heading = document.querySelector("h1");

        if (!heading) {
          return null;
        }

        const text = heading.textContent?.trim();
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
    },
    {
      authorizedDownloadSelector: AUTHORIZED_DOWNLOAD_SELECTOR,
      externalDownloadSelector: EXTERNAL_DOWNLOAD_SELECTOR
    }
  );
}

function isTrackMatch(track: CanonicalTrack, snapshot: ParsedTrackSnapshot) {
  if (!snapshot.artistName || !snapshot.title) {
    return false;
  }

  const candidateTrack = canonicalizeTrack({
    artistName: snapshot.artistName,
    duration: snapshot.durationSeconds,
    source: "soundcloud",
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

function buildCandidate(snapshot: ParsedTrackSnapshot, searchQuery: string): ProviderCandidate {
  const candidateTrack = canonicalizeTrack({
    artistName: snapshot.artistName ?? "",
    duration: snapshot.durationSeconds,
    source: "soundcloud",
    sourceTrackId: snapshot.providerTrackId ?? undefined,
    sourceUrl: snapshot.providerUrl,
    title: snapshot.title ?? ""
  });

  return {
    artistName: candidateTrack.primaryArtist ?? snapshot.artistName ?? "Unknown Artist",
    authorizationBasis: "uploader-enabled-download",
    availableFormats: ["original-upload-format"],
    candidateId: snapshot.providerTrackId ?? snapshot.providerUrl,
    durationSeconds: snapshot.durationSeconds,
    mixConfidence: candidateTrack.mix.confidence,
    mixLabel: candidateTrack.mix.displayLabel,
    priceTier: "free",
    providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
    providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
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

function buildUnauthorizedDownloadDetail(
  download: ParsedTrackSnapshot["download"]
) {
  if (download.kind === "external") {
    return (
      "Matched SoundCloud track exposed an external download link instead of an uploader-enabled direct download." +
      (download.externalUrl ? ` (${download.externalUrl})` : "")
    );
  }

  return "Matched SoundCloud track did not have uploader-enabled downloads enabled.";
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
      return normalizedContentTypeIs(contentType, "audio/alac") ? "alac" : "original-upload-format";
    default:
      return "original-upload-format";
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
