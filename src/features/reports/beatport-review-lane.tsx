"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { StatusBadge } from "@/components/ui/status-badge";

import type { RunReportReviewQueueEntry } from "./run-report";

type ReviewAction = "approve" | "purchased" | "reject";

export function BeatportReviewLane({
  reviewQueue,
  runId
}: {
  reviewQueue: RunReportReviewQueueEntry[];
  runId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isOpeningCart, setIsOpeningCart] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    action: ReviewAction;
    reviewId: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const eligibleCartReviews = reviewQueue.filter(
    (review) => review.status === "queued" || review.status === "approved"
  );
  const cartSummary = summarizeCartState(reviewQueue);

  async function handleOpenCart() {
    setError(null);
    setIsOpeningCart(true);

    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/review-queue/cart`,
        {
          method: "POST"
        }
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        throw new Error(payload?.error ?? "Unable to open the Beatport cart.");
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to open the Beatport cart."
      );
    } finally {
      setIsOpeningCart(false);
    }
  }

  async function handleReviewAction(reviewId: string, action: ReviewAction) {
    setError(null);
    setPendingAction({ action, reviewId });

    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/review-queue/${encodeURIComponent(reviewId)}`,
        {
          body: JSON.stringify({ action }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        throw new Error(payload?.error ?? "Unable to update the paid review queue.");
      }

      startTransition(() => {
        router.refresh();
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to update the paid review queue."
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="report-review-list">
      {eligibleCartReviews.length > 0 ? (
        <div className="report-review-actions">
          <button
            className="primary-button"
            type="button"
            disabled={isOpeningCart || isPending}
            onClick={() => void handleOpenCart()}
          >
            {isOpeningCart
              ? "Opening Beatport Cart..."
              : `Open Beatport Cart (${eligibleCartReviews.length})`}
          </button>
          {cartSummary ? (
            <p className="report-table-secondary">{cartSummary}</p>
          ) : null}
        </div>
      ) : null}

      {reviewQueue.map((review) => {
        const actionIsPending = pendingAction?.reviewId === review.id;

        return (
          <article className="report-review-card" key={review.id}>
            <div className="report-review-card-head">
              <div className="report-review-title-block">
                <p className="report-table-primary">
                  {padTrackPosition(review.track.sourcePosition)} {review.track.artist} -{" "}
                  {review.track.title}
                </p>
                <p className="report-table-secondary">
                  {review.mixLabel ?? review.track.version ?? "Version pending"} •{" "}
                  {formatAvailableFormats(review.availableFormats)}
                </p>
              </div>
              <StatusBadge tone={getReviewStatusTone(review.status)}>
                {review.status}
              </StatusBadge>
            </div>

            <div className="report-review-meta">
              <div className="report-table-stack">
                <p className="report-table-primary">
                  {review.providerUrl ? (
                    <a className="inline-link" href={review.providerUrl}>
                      {review.providerName}
                    </a>
                  ) : (
                    review.providerName
                  )}
                </p>
                <p className="report-table-secondary">{review.summary}</p>
              </div>
              <div className="report-table-stack">
                <p className="report-table-primary">{formatReviewPrimaryCopy(review)}</p>
                <p className="report-table-secondary">
                  Queue {review.queueName} • candidate {review.candidateId}
                </p>
                {review.cartDetail ? (
                  <p className="report-table-secondary">{review.cartDetail}</p>
                ) : null}
              </div>
            </div>

            {canMutateReview(review.status) ? (
              <div className="report-review-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={actionIsPending || isPending}
                  aria-label={`Mark Beatport candidate purchased for ${review.track.artist} - ${review.track.title}`}
                  onClick={() => void handleReviewAction(review.id, "purchased")}
                >
                  {isSpecificActionPending(pendingAction, review.id, "purchased")
                    ? "Saving..."
                    : "Mark Purchased"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={actionIsPending || isPending}
                  aria-label={`Reject Beatport candidate for ${review.track.artist} - ${review.track.title}`}
                  onClick={() => void handleReviewAction(review.id, "reject")}
                >
                  {isSpecificActionPending(pendingAction, review.id, "reject")
                    ? "Rejecting..."
                    : "Reject"}
                </button>
              </div>
            ) : null}
          </article>
        );
      })}

      {error ? (
        <p className="form-status" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function canMutateReview(status: RunReportReviewQueueEntry["status"]) {
  return status === "queued" || status === "approved";
}

function summarizeCartState(reviewQueue: RunReportReviewQueueEntry[]) {
  const counts = reviewQueue.reduce(
    (summary, review) => {
      if (review.cartStatus === "added") {
        summary.added += 1;
      } else if (review.cartStatus === "already-in-cart") {
        summary.alreadyInCart += 1;
      } else if (review.cartStatus === "not-found") {
        summary.notFound += 1;
      } else if (review.cartStatus === "provider-error") {
        summary.failed += 1;
      }

      return summary;
    },
    {
      added: 0,
      alreadyInCart: 0,
      failed: 0,
      notFound: 0
    }
  );
  const parts = [
    counts.added > 0 ? `${counts.added} added to cart` : null,
    counts.alreadyInCart > 0 ? `${counts.alreadyInCart} already in cart` : null,
    counts.notFound > 0 ? `${counts.notFound} not found` : null,
    counts.failed > 0 ? `${counts.failed} failed to add` : null
  ].filter((value): value is string => value !== null);

  return parts.length > 0 ? parts.join(", ") : null;
}

function formatAvailableFormats(formats: RunReportReviewQueueEntry["availableFormats"]) {
  return formats.map((format) => format.toUpperCase()).join(" / ");
}

function formatReviewPrimaryCopy(review: RunReportReviewQueueEntry) {
  switch (review.status) {
    case "approved":
      return "Approved for manual purchase";
    case "purchased":
      return "Purchased download acquired for packaging";
    case "rejected":
      return "Rejected during paid review";
    default:
      return "Awaiting operator review";
  }
}

function getReviewStatusTone(status: RunReportReviewQueueEntry["status"]) {
  if (status === "purchased") {
    return "success" as const;
  }

  if (status === "rejected" || status === "approved") {
    return "warning" as const;
  }

  return "muted" as const;
}

function isSpecificActionPending(
  pendingAction: {
    action: ReviewAction;
    reviewId: string;
  } | null,
  reviewId: string,
  action: ReviewAction
) {
  return pendingAction?.reviewId === reviewId && pendingAction.action === action;
}

function padTrackPosition(sourcePosition: number) {
  return String(sourcePosition).padStart(3, "0");
}
