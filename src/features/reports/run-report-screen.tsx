import Link from "next/link";

import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";

import { BeatportReviewLane } from "./beatport-review-lane";
import type {
  RunReportDetail,
  RunReportTrack,
  RunReportTrackResolution
} from "./run-report";

const terminalTrackStatuses = new Set(["acquired", "missed", "failed"]);

export function RunReportScreen({ report }: { report: RunReportDetail }) {
  const trackCount = report.tracks.length || report.trackCount;
  const completedTrackCount = report.tracks.filter((track) =>
    track.status === "acquired" ||
    track.status === "missed" ||
    track.status === "failed"
  ).length;

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="hero-kicker">Run report</p>
          <Link className="inline-link" href="/">
            Back to intake
          </Link>
          <h1>{report.playlistTitle ?? report.playlistUrl}</h1>
          <p className="hero-copy">{report.playlistUrl}</p>
        </div>

        <div className="hero-sidecar">
          <StatusBadge tone={getStatusTone(report.status)}>
            {report.status}
          </StatusBadge>
          <p className="hero-note">
            {formatSourceLabel(report.sourceType)} run {report.id} tracks selected
            sources, misses, and packaged artifacts in one local view.
          </p>
          <dl className="status-list">
            <div>
              <dt>Tracks</dt>
              <dd>{formatCount(trackCount, "track", "tracks")}</dd>
            </div>
            <div>
              <dt>Selected</dt>
              <dd>
                {formatCount(
                  report.selectedSourceCount,
                  "selected source",
                  "selected sources"
                )}
              </dd>
            </div>
            <div>
              <dt>Misses</dt>
              <dd>{formatCount(report.missCount, "miss", "misses")}</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="report-grid">
        <Panel
          eyebrow="Summary"
          title="Run Summary"
          footer={
            <span className="panel-caption">
              {completedTrackCount === trackCount
                ? "All current track outcomes are resolved"
                : `${trackCount - completedTrackCount} tracks still moving`}
            </span>
          }
        >
          <dl className="status-list report-summary-list">
            <div>
              <dt>Source</dt>
              <dd>{formatSourceLabel(report.sourceType)}</dd>
            </div>
            <div>
              <dt>Artifacts</dt>
              <dd>
                {formatCount(report.artifactCount, "artifact", "artifacts")}
              </dd>
            </div>
            <div>
              <dt>Resume</dt>
              <dd>{report.resumeAfterStatus ?? "fresh run"}</dd>
            </div>
          </dl>
        </Panel>

        <Panel
          eyebrow="Artifacts"
          title="Downloads"
          footer={<span className="panel-caption">Generation-task URLs</span>}
        >
          {report.artifacts.length ? (
            <div className="report-artifact-list">
              {report.artifacts.map((artifact) => (
                <a
                  key={artifact.kind}
                  className="file-badge report-artifact-link"
                  href={artifact.downloadUrl}
                >
                  {artifact.label}
                </a>
              ))}
            </div>
          ) : (
            <p className="report-empty-copy">
              Artifacts will appear after packaging completes.
            </p>
          )}
        </Panel>

        <Panel
          eyebrow="Beatport"
          title="Review Lane"
          footer={
            <span className="panel-caption">Reserved for paid fallback approvals</span>
          }
        >
          {report.reviewQueue.length ? (
            <BeatportReviewLane reviewQueue={report.reviewQueue} runId={report.id} />
          ) : (
            <p className="report-empty-copy">
              No paid fallback approvals are queued for this run yet.
            </p>
          )}
        </Panel>

        <Panel
          className="report-track-panel"
          eyebrow="Per-track review"
          title="Track Outcomes"
          footer={<span className="panel-caption">DJ workflow review table</span>}
        >
          {report.tracks.length ? (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">Track</th>
                    <th scope="col">Status</th>
                    <th scope="col">Selected Source / Miss</th>
                    <th scope="col">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {report.tracks.map((track) => (
                    <tr key={track.id}>
                      <td>
                        <div className="report-track-cell">
                          <span className="report-track-position">
                            {String(track.sourcePosition).padStart(3, "0")}
                          </span>
                          <div>
                            <p className="report-table-primary">
                              {track.artist} - {track.title}
                            </p>
                            <p className="report-table-secondary">
                              {track.version ?? "Version pending"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <StatusBadge tone={getTrackStatusTone(track)}>
                          {track.status}
                        </StatusBadge>
                      </td>
                      <td>{renderTrackSource(track)}</td>
                      <td>{renderTrackDecision(track)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="report-empty-copy">
              Track outcomes will appear after playlist intake writes the run rows.
            </p>
          )}
        </Panel>
      </div>
    </main>
  );
}

function renderTrackSource(track: RunReportTrack) {
  if (track.resolution?.type === "selected") {
    const providerName = track.resolution.provider.url ? (
      <a className="inline-link" href={track.resolution.provider.url}>
        {track.resolution.provider.name}
      </a>
    ) : (
      track.resolution.provider.name
    );

    return (
      <div className="report-table-stack">
        <p className="report-table-primary">{providerName}</p>
        <p className="report-table-secondary">
          {formatAuthorizationBasis(track.resolution.provider.authorizationBasis)} •{" "}
          {track.resolution.selectedFormat?.toUpperCase() ?? "format pending"}
        </p>
      </div>
    );
  }

  if (track.resolution?.type === "miss") {
    return (
      <div className="report-table-stack">
        <p className="report-table-primary">
          {track.resolution.provider?.name ?? "Track matcher"}
        </p>
        <p className="report-table-secondary">Missed track</p>
      </div>
    );
  }

  if (track.reviewQueueEntry) {
    const providerName = track.reviewQueueEntry.providerUrl ? (
      <a className="inline-link" href={track.reviewQueueEntry.providerUrl}>
        {track.reviewQueueEntry.providerName}
      </a>
    ) : (
      track.reviewQueueEntry.providerName
    );

    return (
      <div className="report-table-stack">
        <p className="report-table-primary">{providerName}</p>
        <p className="report-table-secondary">
          {track.reviewQueueEntry.mixLabel ?? track.version ?? "Version pending"} •{" "}
          {track.reviewQueueEntry.availableFormats
            .map((format) => format.toUpperCase())
            .join(" / ")}
        </p>
      </div>
    );
  }

  if (track.latestAttempt) {
    return (
      <div className="report-table-stack">
        <p className="report-table-primary">{track.latestAttempt.providerKey}</p>
        <p className="report-table-secondary">
          {formatAttemptOutcome(track.latestAttempt.outcome)}
        </p>
      </div>
    );
  }

  return <p className="report-empty-copy">No provider decision recorded yet.</p>;
}

function renderTrackDecision(track: RunReportTrack) {
  if (track.resolution?.type === "selected") {
    return (
      <div className="report-table-stack">
        <p className="report-table-primary">
          {formatSelectionReason(track.resolution.selectionReason)}
        </p>
        <p className="report-table-secondary">{track.resolution.details}</p>
      </div>
    );
  }

  if (track.resolution?.type === "miss") {
    return (
      <div className="report-table-stack">
        <p className="report-table-primary">{track.resolution.reason}</p>
        <p className="report-table-secondary">{track.resolution.details}</p>
      </div>
    );
  }

  if (track.reviewQueueEntry) {
    return (
      <div className="report-table-stack">
        <p className="report-table-primary">
          {formatReviewDecision(track.reviewQueueEntry.status)}
        </p>
        <p className="report-table-secondary">{track.reviewQueueEntry.summary}</p>
      </div>
    );
  }

  if (terminalTrackStatuses.has(track.status)) {
    return (
      <p className="report-empty-copy">
        Final outcome recorded without a structured source note.
      </p>
    );
  }

  return <p className="report-empty-copy">Waiting on matching or packaging work.</p>;
}

function formatReviewDecision(
  status: NonNullable<RunReportTrack["reviewQueueEntry"]>["status"]
) {
  switch (status) {
    case "approved":
      return "Approved for manual purchase";
    case "purchased":
      return "Marked purchased / completed";
    case "rejected":
      return "Rejected during paid review";
    default:
      return "Awaiting operator review";
  }
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatSourceLabel(sourceType: RunReportDetail["sourceType"]) {
  return sourceType === "spotify" ? "Spotify" : "SoundCloud";
}

function formatSelectionReason(
  reason: Extract<RunReportTrackResolution, { type: "selected" }>["selectionReason"]
) {
  switch (reason) {
    case "accepted-extended-mix":
      return "Extended Mix";
    case "accepted-original-mix":
      return "Original Mix";
    case "accepted-base-version-fallback":
      return "High-confidence fallback";
    default:
      return reason;
  }
}

function formatAttemptOutcome(
  outcome: NonNullable<RunReportTrack["latestAttempt"]>["outcome"]
) {
  switch (outcome) {
    case "matched":
      return "Matched candidate selected";
    case "missed":
      return "Miss recorded";
    case "failed":
      return "Attempt failed";
    case "purchased":
      return "Queued for purchase";
    case "skipped":
      return "Attempt skipped";
    default:
      return outcome;
  }
}

function formatAuthorizationBasis(value: string) {
  switch (value) {
    case "uploader-enabled-download":
      return "Uploader-enabled download";
    case "rights-holder-storefront":
      return "Rights-holder storefront";
    case "purchase-entitlement":
      return "Purchase entitlement";
    default:
      return value;
  }
}

function getStatusTone(status: RunReportDetail["status"]) {
  if (status === "completed") {
    return "success" as const;
  }

  if (status === "failed" || status === "awaiting-approval") {
    return "warning" as const;
  }

  return "muted" as const;
}

function getTrackStatusTone(track: RunReportTrack) {
  if (track.status === "acquired") {
    return "success" as const;
  }

  if (track.status === "missed" || track.status === "failed") {
    return "warning" as const;
  }

  return "muted" as const;
}
