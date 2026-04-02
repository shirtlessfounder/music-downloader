import type { Page } from "playwright";

import {
  BrowserSessionOwnershipConflictError,
  ExpiredBrowserSessionAuthStateError,
  MissingBrowserSessionAuthStateError,
  MissingBrowserSessionStateError,
  type BrowserSessionService
} from "@/features/browser/browser-session-service";
import type { RunTrackReviewCartStatus } from "@/features/runs/run-store";

import {
  BEATPORT_PROVIDER_NAME,
  BEATPORT_SESSION_NAME
} from "./beatport";

const DEFAULT_BEATPORT_BASE_URL = "https://www.beatport.com";

type BeatportCartBrowserSessionService = Pick<
  BrowserSessionService,
  "openSession" | "requireAuthenticatedSession"
>;

export type BeatportCartReviewInput = {
  artist: string;
  candidateId: string;
  mixLabel: string | null;
  providerUrl: string | null;
  reviewId: string;
  title: string;
};

export type BeatportCartReviewResult = {
  cartDetail: string;
  cartStatus: RunTrackReviewCartStatus;
  providerUrl: string | null;
  reviewId: string;
};

export type BeatportCartBuildResult =
  | {
      cartUrl: string;
      outcome: "opened-cart";
      results: BeatportCartReviewResult[];
      summary: {
        added: number;
        alreadyInCart: number;
        failed: number;
        notFound: number;
        total: number;
      };
    }
  | {
      detail: string;
      outcome: "failed";
      reason: "auth-expired" | "session-conflict";
    };

export async function openBeatportCartForReviews(input: {
  baseUrl?: string;
  browserSessionService: BeatportCartBrowserSessionService;
  headless?: boolean;
  reviews: readonly BeatportCartReviewInput[];
}): Promise<BeatportCartBuildResult> {
  const baseUrl = input.baseUrl ?? DEFAULT_BEATPORT_BASE_URL;

  try {
    await input.browserSessionService.requireAuthenticatedSession(BEATPORT_SESSION_NAME);
  } catch (error) {
    if (
      error instanceof MissingBrowserSessionStateError ||
      error instanceof MissingBrowserSessionAuthStateError ||
      error instanceof ExpiredBrowserSessionAuthStateError
    ) {
      return {
        detail:
          "An authenticated Beatport browser session is required before the cart can be opened.",
        outcome: "failed",
        reason: "auth-expired"
      };
    }

    throw error;
  }

  let session;

  try {
    session = await input.browserSessionService.openSession({
      headless: input.headless ?? false,
      owner: "operator",
      sessionName: BEATPORT_SESSION_NAME
    });
  } catch (error) {
    if (error instanceof BrowserSessionOwnershipConflictError) {
      return {
        detail:
          "Another background browser session is already active for Beatport. Wait for it to finish before opening the cart.",
        outcome: "failed",
        reason: "session-conflict"
      };
    }

    throw error;
  }

  const cartUrl = new URL("/cart", baseUrl).toString();
  const results = await session.withPage(async (page) => {
    const reviewResults: BeatportCartReviewResult[] = [];

    for (const review of input.reviews) {
      const resolvedProviderUrl = await resolveReviewTrackUrl({
        baseUrl,
        page,
        review
      });

      if (!resolvedProviderUrl) {
        reviewResults.push({
          cartDetail: "Beatport search did not return a cartable track target.",
          cartStatus: "not-found",
          providerUrl: null,
          reviewId: review.reviewId
        });
        continue;
      }

      await page.goto(resolvedProviderUrl, { waitUntil: "load" });
      await page.bringToFront?.();

      if (await isAlreadyInCart(page)) {
        reviewResults.push({
          cartDetail: "Track already existed in the Beatport cart.",
          cartStatus: "already-in-cart",
          providerUrl: resolvedProviderUrl,
          reviewId: review.reviewId
        });
        continue;
      }

      const addToCartLink = page.locator('[data-testid="beatport-add-to-cart"]').first();

      if ((await addToCartLink.count()) === 0) {
        reviewResults.push({
          cartDetail: "Beatport track page did not expose an add-to-cart control.",
          cartStatus: "provider-error",
          providerUrl: resolvedProviderUrl,
          reviewId: review.reviewId
        });
        continue;
      }

      await Promise.all([
        page.waitForURL((url) => url.pathname === "/cart", {
          timeout: 5_000
        }),
        addToCartLink.click()
      ]);

      reviewResults.push({
        cartDetail: "Added track to the Beatport cart.",
        cartStatus: "added",
        providerUrl: resolvedProviderUrl,
        reviewId: review.reviewId
      });
    }

    await page.goto(cartUrl, { waitUntil: "load" });
    await page.bringToFront?.();

    return reviewResults;
  });

  return {
    cartUrl,
    outcome: "opened-cart",
    results,
    summary: summarizeCartResults(results)
  };
}

async function resolveReviewTrackUrl(input: {
  baseUrl: string;
  page: Page;
  review: BeatportCartReviewInput;
}) {
  if (input.review.providerUrl) {
    return input.review.providerUrl;
  }

  const searchUrl = new URL(
    `/search/tracks?q=${encodeURIComponent(buildBeatportSearchQuery(input.review))}`,
    input.baseUrl
  ).toString();

  await input.page.goto(searchUrl, { waitUntil: "load" });

  return input.page.evaluate(
    ({ artist, title }) => {
      const targetArtist = normalize(artist);
      const targetTitle = normalize(title);
      const results = [
        ...document.querySelectorAll('[data-testid="beatport-search-result"]')
      ];

      for (const result of results) {
        const link = result.querySelector('a[href*="/track/"]');
        const artistName =
          result.querySelector('[data-testid="beatport-search-result-artist"]')
            ?.textContent ?? "";
        const titleText = link?.textContent ?? "";

        if (normalize(artistName) !== targetArtist) {
          continue;
        }

        if (normalize(titleText) !== targetTitle) {
          continue;
        }

        return new URL(link?.getAttribute("href") ?? "", window.location.href).toString();
      }

      return null;

      function normalize(value: string) {
        return value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ");
      }
    },
    {
      artist: input.review.artist,
      title: input.review.title
    }
  );
}

async function isAlreadyInCart(page: Page) {
  return (
    await page
      .locator('[data-testid="beatport-cart-status"][data-status="already-in-cart"]')
      .count()
  ) > 0;
}

function buildBeatportSearchQuery(review: BeatportCartReviewInput) {
  return [review.artist, review.title, review.mixLabel]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function summarizeCartResults(results: BeatportCartReviewResult[]) {
  return results.reduce(
    (summary, result) => {
      if (result.cartStatus === "added") {
        summary.added += 1;
      } else if (result.cartStatus === "already-in-cart") {
        summary.alreadyInCart += 1;
      } else if (result.cartStatus === "not-found") {
        summary.notFound += 1;
      } else {
        summary.failed += 1;
      }

      return summary;
    },
    {
      added: 0,
      alreadyInCart: 0,
      failed: 0,
      notFound: 0,
      total: results.length
    }
  );
}

export function buildBeatportSessionConflictDetail() {
  return `Another background browser session is already active for ${BEATPORT_PROVIDER_NAME}. Wait for it to finish before opening the cart.`;
}
