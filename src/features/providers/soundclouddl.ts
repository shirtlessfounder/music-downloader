import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import type { Page } from "playwright";

import { BrowserSessionService } from "@/features/browser/browser-session-service";
import { canonicalizeTrack, type CanonicalTrack } from "@/features/tracks/canonical-track";

import {
  buildProviderMissResult,
  buildProviderRejectedResult,
  defineAutomaticProvider,
  type ProviderAcquireInput,
  type ProviderCandidate,
  type ProviderSearchInput
} from "./provider-registry";
import { openBackgroundProviderSession } from "./provider-browser-session";

export const SOUNDCLOUDDL_PROVIDER_ID = "soundclouddl";
export const SOUNDCLOUDDL_PROVIDER_NAME = "SoundCloudDL";
export const SOUNDCLOUDDL_SESSION_NAME = SOUNDCLOUDDL_PROVIDER_ID;

const DEFAULT_SOUNDCLOUD_BASE_URL = "https://soundcloud.com";
const DEFAULT_SOUNDCLOUDDL_BASE_URL = "https://soundclouddl.cc/";
const SEARCH_RESULT_LINK_SELECTOR = [
  '[data-testid="soundcloud-track-link"]',
  "a.soundTitle__title",
  "a[itemprop='url']"
].join(", ");
const CONVERTER_URL_INPUT_SELECTOR = 'input[name="url"]';
const CONVERTER_FORMAT_SELECT_SELECTOR = 'select[name="format"]';
const CONVERTER_SUBMIT_SELECTOR = 'button[type="submit"], input[type="submit"]';
const CONVERTER_DOWNLOAD_LINK_SELECTOR = [
  'a[download][href]',
  'a[href$=".mp3"]',
  'a[href*="/converted/"]',
  'a[href*="/download"]'
].join(", ");

interface SoundCloudDLProviderDependencies {
  browserSessionService: Pick<BrowserSessionService, "openSession">;
  converterBaseUrl?: string;
  maxSearchResults?: number;
  sessionName?: string;
  soundCloudBaseUrl?: string;
}

interface ParsedSoundCloudTrackSnapshot {
  artistName: string | null;
  durationSeconds: number | null;
  providerTrackId: string | null;
  providerUrl: string;
  title: string | null;
}

export function createSoundCloudDLProvider(
  dependencies: SoundCloudDLProviderDependencies
) {
  const sessionName = dependencies.sessionName ?? SOUNDCLOUDDL_SESSION_NAME;
  const soundCloudBaseUrl =
    dependencies.soundCloudBaseUrl ?? DEFAULT_SOUNDCLOUD_BASE_URL;
  const converterBaseUrl =
    dependencies.converterBaseUrl ?? DEFAULT_SOUNDCLOUDDL_BASE_URL;
  const maxSearchResults = dependencies.maxSearchResults ?? 5;

  return defineAutomaticProvider({
    id: SOUNDCLOUDDL_PROVIDER_ID,
    displayName: SOUNDCLOUDDL_PROVIDER_NAME,
    sourceBasis: "uploader-enabled-download",
    priceTier: "free",
    priorityRank: 15,
    supportedFormats: ["mp3"],
    search: async (input) =>
      searchSoundCloudDL({
        browserSessionService: dependencies.browserSessionService,
        input,
        maxSearchResults,
        sessionName,
        soundCloudBaseUrl
      }),
    acquire: async (input) =>
      acquireSoundCloudDL({
        browserSessionService: dependencies.browserSessionService,
        converterBaseUrl,
        input,
        sessionName
      })
  });
}

async function searchSoundCloudDL(input: {
  browserSessionService: SoundCloudDLProviderDependencies["browserSessionService"];
  input: ProviderSearchInput;
  maxSearchResults: number;
  sessionName: string;
  soundCloudBaseUrl: string;
}) {
  const session = await openBackgroundProviderSession({
    browserSessionService: input.browserSessionService,
    providerId: SOUNDCLOUDDL_PROVIDER_ID,
    providerName: SOUNDCLOUDDL_PROVIDER_NAME,
    sessionName: input.sessionName
  });

  if ("outcome" in session) {
    return session;
  }

  try {
    for (const searchQuery of buildSoundCloudSearchQueries(input.input.track)) {
      const candidates = await session.withPage(async (page) => {
        await page.goto(buildSoundCloudSearchUrl(input.soundCloudBaseUrl, searchQuery), {
          waitUntil: "load"
        });

        const trackUrls = (await readSearchResultUrls(page)).slice(0, input.maxSearchResults);
        const nextCandidates: ProviderCandidate[] = [];
        const seenCandidateIds = new Set<string>();

        for (const trackUrl of trackUrls) {
          await page.goto(trackUrl, { waitUntil: "load" });
          const snapshot = await parseSoundCloudTrackSnapshot(page);

          if (!isTrackMatch(input.input.track, snapshot)) {
            continue;
          }

          const candidate = buildCandidate(snapshot, searchQuery);

          if (seenCandidateIds.has(candidate.candidateId)) {
            continue;
          }

          seenCandidateIds.add(candidate.candidateId);
          nextCandidates.push(candidate);
        }

        return nextCandidates;
      });

      if (candidates.length > 0) {
        return {
          outcome: "candidates" as const,
          candidates
        };
      }
    }

    return buildProviderMissResult({
      detail:
        "SoundCloudDL could not find an exact SoundCloud track candidate for the requested artist/title search variants.",
      providerId: SOUNDCLOUDDL_PROVIDER_ID,
      providerName: SOUNDCLOUDDL_PROVIDER_NAME,
      reason: "no-search-results",
      trackMissReason: "no-supported-source-match"
    });
  } catch (error) {
    return buildProviderRejectedResult({
      detail: buildProviderErrorDetail(
        "SoundCloudDL search failed while locating a matching SoundCloud track.",
        error
      ),
      providerId: SOUNDCLOUDDL_PROVIDER_ID,
      providerName: SOUNDCLOUDDL_PROVIDER_NAME,
      reason: "provider-error"
    });
  } finally {
    await session.close();
  }
}

async function acquireSoundCloudDL(input: {
  browserSessionService: SoundCloudDLProviderDependencies["browserSessionService"];
  converterBaseUrl: string;
  input: ProviderAcquireInput;
  sessionName: string;
}) {
  const session = await openBackgroundProviderSession({
    browserSessionService: input.browserSessionService,
    candidate: input.input.candidate,
    providerId: SOUNDCLOUDDL_PROVIDER_ID,
    providerName: SOUNDCLOUDDL_PROVIDER_NAME,
    sessionName: input.sessionName
  });

  if ("outcome" in session) {
    return session;
  }

  const sourceUrl =
    input.input.candidate.provenance.providerUrl ??
    input.input.candidate.provenance.sourcePageUrl;

  if (!sourceUrl) {
    return buildProviderRejectedResult({
      candidate: input.input.candidate,
      detail: "SoundCloudDL candidate was missing the SoundCloud track URL required for conversion.",
      providerId: SOUNDCLOUDDL_PROVIDER_ID,
      providerName: SOUNDCLOUDDL_PROVIDER_NAME,
      reason: "download-artifact-missing"
    });
  }

  try {
    const download = await session.captureDownload({
      trigger: async (page) => {
        await page.goto(input.converterBaseUrl, { waitUntil: "load" });
        await fillConverterForm(page, sourceUrl);
        await page.locator(CONVERTER_SUBMIT_SELECTOR).first().click();
        const downloadLink = page.locator(CONVERTER_DOWNLOAD_LINK_SELECTOR).first();
        await downloadLink.waitFor({ state: "visible", timeout: 15_000 });
        await downloadLink.click();
      }
    });
    const artifact = await buildArtifactMetadata(
      download.path,
      download.suggestedFilename,
      "audio/mpeg"
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
        "SoundCloudDL acquisition failed while converting the matched SoundCloud track.",
        error
      ),
      providerId: SOUNDCLOUDDL_PROVIDER_ID,
      providerName: SOUNDCLOUDDL_PROVIDER_NAME,
      reason: "provider-error"
    });
  } finally {
    await session.close();
  }
}

function buildSoundCloudSearchQueries(track: CanonicalTrack) {
  const baseQuery = [track.primaryArtist, track.title]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (!baseQuery) {
    return [];
  }

  if (track.mix.kind === "extended" || track.mix.kind === "original") {
    return [
      [baseQuery, track.mix.displayLabel].filter(Boolean).join(" "),
      baseQuery
    ];
  }

  return [
    `${baseQuery} Extended Mix`,
    `${baseQuery} Original Mix`,
    baseQuery
  ];
}

function buildSoundCloudSearchUrl(baseUrl: string, query: string) {
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

async function parseSoundCloudTrackSnapshot(
  page: Page
): Promise<ParsedSoundCloudTrackSnapshot> {
  return page.evaluate(() => {
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

    return {
      artistName,
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
  });
}

function isTrackMatch(track: CanonicalTrack, snapshot: ParsedSoundCloudTrackSnapshot) {
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

  if (candidateTrack.mix.selectionClass === "reject") {
    return false;
  }

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

function buildCandidate(
  snapshot: ParsedSoundCloudTrackSnapshot,
  searchQuery: string
): ProviderCandidate {
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
    sourceBasis: "uploader-enabled-download",
    availableFormats: ["mp3"],
    candidateId: snapshot.providerTrackId ?? snapshot.providerUrl,
    durationSeconds: snapshot.durationSeconds,
    mixConfidence: candidateTrack.mix.confidence,
    mixLabel: candidateTrack.mix.displayLabel,
    priceTier: "free",
    providerId: SOUNDCLOUDDL_PROVIDER_ID,
    providerName: SOUNDCLOUDDL_PROVIDER_NAME,
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

async function fillConverterForm(page: Page, sourceUrl: string) {
  const urlInput = page.locator(CONVERTER_URL_INPUT_SELECTOR).first();
  await urlInput.fill(sourceUrl);

  const formatSelect = page.locator(CONVERTER_FORMAT_SELECT_SELECTOR).first();

  if ((await formatSelect.count()) > 0) {
    await formatSelect.selectOption("MP3");
  }
}

async function buildArtifactMetadata(
  downloadPath: string,
  suggestedFilename: string,
  contentType: string | null
) {
  const fileBuffer = await readFile(downloadPath);
  const fileStats = await stat(downloadPath);
  const fileExtension = normalizeFileExtension(suggestedFilename);
  const format = fileExtension === "mp3" ? ("mp3" as const) : ("unknown" as const);

  return {
    contentType,
    fileExtension,
    fileName: suggestedFilename,
    format,
    localFilePath: downloadPath,
    sha256: createHash("sha256").update(fileBuffer).digest("hex"),
    sizeBytes: fileStats.size
  };
}

function buildProviderErrorDetail(message: string, error: unknown) {
  if (error instanceof Error) {
    return `${message} ${error.message}`;
  }

  return message;
}

function normalizeFileExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? null;
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
