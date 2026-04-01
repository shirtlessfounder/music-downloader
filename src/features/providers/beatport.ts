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
import { type CanonicalTrack } from "@/features/tracks/canonical-track";

import {
  buildProviderRejectedResult,
  defineReviewQueueProvider,
  type ProviderAcquireInput,
  type ProviderArtifactFormat,
  type ProviderCandidate
} from "./provider-registry";

export const BEATPORT_PROVIDER_ID = "beatport";
export const BEATPORT_PROVIDER_NAME = "Beatport";
export const BEATPORT_REVIEW_QUEUE_NAME = "beatport-review";
export const BEATPORT_REVIEW_SUMMARY =
  "Queued after all automatic free-source providers missed.";
export const BEATPORT_SESSION_NAME = BEATPORT_PROVIDER_ID;

const DEFAULT_BEATPORT_BASE_URL = "https://www.beatport.com";
const OWNED_DOWNLOAD_SELECTOR = [
  '[data-testid="beatport-owned-download"]',
  'a[data-format-key][href]',
  'a[data-format][href]',
  'a[href*="/download"][download]',
  'a[href*="/download"]'
].join(", ");

interface BeatportProviderDependencies {
  baseUrl?: string;
  browserSessionService: Pick<
    BrowserSessionService,
    "openSession" | "requireAuthenticatedSession"
  >;
  sessionName?: string;
}

type ParsedOwnedDownload = {
  contentType: string | null;
  format: ProviderArtifactFormat;
  href: string;
  label: string | null;
};

export function createBeatportProvider(
  dependencies: BeatportProviderDependencies
) {
  const baseUrl = dependencies.baseUrl ?? DEFAULT_BEATPORT_BASE_URL;
  const sessionName = dependencies.sessionName ?? BEATPORT_SESSION_NAME;

  return defineReviewQueueProvider({
    id: BEATPORT_PROVIDER_ID,
    displayName: BEATPORT_PROVIDER_NAME,
    authorizationBasis: "purchase-entitlement",
    priorityRank: 90,
    supportedFormats: ["mp3", "wav", "aiff"],
    search: async ({ track }) => ({
      outcome: "candidates" as const,
      candidates: [buildBeatportCandidate(track, baseUrl)]
    }),
    acquirePurchased: async (input) =>
      acquirePurchasedBeatportDownload({
        browserSessionService: dependencies.browserSessionService,
        input,
        sessionName
      }),
    queueForReview: async ({ candidate }) => ({
      outcome: "queued-for-review" as const,
      candidate,
      review: {
        queueName: BEATPORT_REVIEW_QUEUE_NAME,
        summary: BEATPORT_REVIEW_SUMMARY
      }
    })
  });
}

function buildBeatportCandidate(track: CanonicalTrack, baseUrl: string) {
  const artistName = track.primaryArtist ?? "Unknown Artist";
  const searchQuery = [artistName, track.title, track.mix.displayLabel]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const slug = [artistName, track.title]
    .map((segment) =>
      segment
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .join("-")
    .replace(/-+/g, "-");
  const providerTrackId = `${BEATPORT_PROVIDER_ID}-${slug}`;

  return {
    artistName,
    authorizationBasis: "purchase-entitlement" as const,
    availableFormats: ["mp3", "wav"] as const,
    candidateId: providerTrackId,
    durationSeconds:
      track.durationSeconds ?? (track.mix.displayLabel ? 392 : 301),
    mixConfidence: track.mix.confidence,
    mixLabel: track.mix.displayLabel,
    priceTier: "paid" as const,
    providerId: BEATPORT_PROVIDER_ID,
    providerName: BEATPORT_PROVIDER_NAME,
    provenance: {
      discoveredVia: "search" as const,
      providerTrackId,
      providerUrl: new URL(`/track/${slug}/${slug}`, baseUrl).toString(),
      searchQuery
    },
    title: track.title
  };
}

async function acquirePurchasedBeatportDownload(input: {
  browserSessionService: BeatportProviderDependencies["browserSessionService"];
  input: ProviderAcquireInput;
  sessionName: string;
}) {
  const sessionResult = await openAuthenticatedSession({
    browserSessionService: input.browserSessionService,
    candidate: input.input.candidate,
    sessionName: input.sessionName
  });

  if ("outcome" in sessionResult) {
    return sessionResult;
  }

  const trackUrl =
    input.input.candidate.provenance.providerUrl ??
    input.input.candidate.provenance.sourcePageUrl;

  if (!trackUrl) {
    return buildProviderRejectedResult({
      candidate: input.input.candidate,
      detail: "Beatport candidate was missing the track page URL required for download.",
      providerId: BEATPORT_PROVIDER_ID,
      providerName: BEATPORT_PROVIDER_NAME,
      reason: "download-artifact-missing"
    });
  }

  try {
    const ownedDownloads = await sessionResult.withPage(async (page) => {
      await page.goto(trackUrl, { waitUntil: "load" });
      return parseOwnedDownloadOptions(page);
    });

    if (ownedDownloads.length === 0) {
      return buildProviderRejectedResult({
        candidate: input.input.candidate,
        detail:
          "Beatport track is not currently owned or does not expose owned-download links.",
        providerId: BEATPORT_PROVIDER_ID,
        providerName: BEATPORT_PROVIDER_NAME,
        reason: "no-download-entitlement"
      });
    }

    const preferredDownload = selectPreferredOwnedDownload(ownedDownloads);

    if (!preferredDownload) {
      return buildProviderRejectedResult({
        candidate: input.input.candidate,
        detail:
          "Beatport owned download is available, but none of the exposed formats match the MP3/WAV fallback policy.",
        providerId: BEATPORT_PROVIDER_ID,
        providerName: BEATPORT_PROVIDER_NAME,
        reason: "candidate-format-unavailable"
      });
    }

    const download = await sessionResult.captureDownload({
      trigger: async (page) => {
        await clickOwnedDownload(page, preferredDownload);
      }
    });
    const artifact = await buildArtifactMetadata(
      download.path,
      download.suggestedFilename,
      preferredDownload.contentType
    );

    if (artifact.format !== "mp3" && artifact.format !== "wav") {
      return buildProviderRejectedResult({
        candidate: input.input.candidate,
        detail:
          "Beatport download completed, but the artifact format fell outside the MP3/WAV fallback policy.",
        providerId: BEATPORT_PROVIDER_ID,
        providerName: BEATPORT_PROVIDER_NAME,
        reason: "candidate-format-unavailable"
      });
    }

    return {
      outcome: "acquired" as const,
      artifact,
      candidate: input.input.candidate
    };
  } catch (error) {
    return buildProviderRejectedResult({
      candidate: input.input.candidate,
      detail: buildProviderErrorDetail(
        "Beatport acquisition failed while capturing an owned download.",
        error
      ),
      providerId: BEATPORT_PROVIDER_ID,
      providerName: BEATPORT_PROVIDER_NAME,
      reason: "provider-error"
    });
  } finally {
    await sessionResult.close();
  }
}

async function openAuthenticatedSession(input: {
  browserSessionService: BeatportProviderDependencies["browserSessionService"];
  candidate: ProviderCandidate;
  sessionName: string;
}) {
  try {
    await input.browserSessionService.requireAuthenticatedSession(input.sessionName);
  } catch (error) {
    if (
      error instanceof MissingBrowserSessionStateError ||
      error instanceof MissingBrowserSessionAuthStateError
    ) {
      return buildProviderRejectedResult({
        candidate: input.candidate,
        detail:
          "An authenticated Beatport browser session is required before owned downloads can be acquired.",
        providerId: BEATPORT_PROVIDER_ID,
        providerName: BEATPORT_PROVIDER_NAME,
        reason: "auth-required"
      });
    }

    if (error instanceof ExpiredBrowserSessionAuthStateError) {
      return buildProviderRejectedResult({
        candidate: input.candidate,
        detail:
          "The Beatport browser session expired and must be refreshed before owned downloads can be acquired.",
        providerId: BEATPORT_PROVIDER_ID,
        providerName: BEATPORT_PROVIDER_NAME,
        reason: "provider-session-expired"
      });
    }

    throw error;
  }

  return input.browserSessionService.openSession({
    sessionName: input.sessionName
  });
}

async function parseOwnedDownloadOptions(page: Page): Promise<ParsedOwnedDownload[]> {
  return page.evaluate((selector) => {
    const downloads: ParsedOwnedDownload[] = [];

    for (const element of document.querySelectorAll(selector)) {
      if (!(element instanceof HTMLAnchorElement)) {
        continue;
      }

      const href = element.getAttribute("href");

      if (!href) {
        continue;
      }

      const formatLabel =
        element.getAttribute("data-format-key") ??
        element.getAttribute("data-format") ??
        element.textContent ??
        "";

      downloads.push({
        contentType: element.getAttribute("type"),
        format: classifyOwnedDownloadFormat(formatLabel),
        href: new URL(href, window.location.href).toString(),
        label: element.textContent?.trim() ?? null
      });
    }

    return downloads;

    function classifyOwnedDownloadFormat(value: string): ProviderArtifactFormat {
      const normalizedValue = value.trim().toLowerCase();

      if (normalizedValue.includes("mp3")) {
        return "mp3";
      }

      if (normalizedValue.includes("wav")) {
        return "wav";
      }

      if (normalizedValue.includes("aiff") || normalizedValue.includes("aif")) {
        return "aiff";
      }

      return "unknown";
    }
  }, OWNED_DOWNLOAD_SELECTOR);
}

function selectPreferredOwnedDownload(downloads: ParsedOwnedDownload[]) {
  return (
    downloads.find((download) => download.format === "mp3") ??
    downloads.find((download) => download.format === "wav") ??
    null
  );
}

async function clickOwnedDownload(page: Page, selectedDownload: ParsedOwnedDownload) {
  const clicked = await page.evaluate(
    ({ format, href }) => {
      const links = [...document.querySelectorAll("a[href]")].filter(
        (element): element is HTMLAnchorElement =>
          element instanceof HTMLAnchorElement
      );

      const hrefMatch = links.find(
        (element) =>
          new URL(element.getAttribute("href") ?? "", window.location.href).toString() ===
          href
      );

      if (hrefMatch) {
        hrefMatch.click();
        return true;
      }

      const formatMatch = links.find((element) => {
        const formatLabel =
          element.getAttribute("data-format-key") ??
          element.getAttribute("data-format") ??
          element.textContent ??
          "";

        return formatLabel.trim().toLowerCase().includes(format);
      });

      if (formatMatch) {
        formatMatch.click();
        return true;
      }

      return false;
    },
    {
      format: selectedDownload.format,
      href: selectedDownload.href
    }
  );

  if (!clicked) {
    throw new Error(
      `Beatport owned download link not found for format "${selectedDownload.format}".`
    );
  }
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
    default:
      return null;
  }
}

function buildProviderErrorDetail(message: string, error: unknown) {
  if (error instanceof Error && error.message) {
    return `${message} ${error.message}`;
  }

  return message;
}
