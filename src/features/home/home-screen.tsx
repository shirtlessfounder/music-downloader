"use client";

import Link from "next/link";
import { startTransition, useEffect, useEffectEvent, useState } from "react";

import type { OperatorBrowserSessionReadiness } from "@/features/browser/operator-browser-session-manager";
import { FileBadge } from "@/components/ui/file-badge";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import type { RunDetail, RunStatus, RunSummary } from "@/features/runs/run-store";

const artifacts = ["downloads.zip", "manifest.json", "misses.txt"];
const terminalStatuses: RunStatus[] = ["completed", "failed"];

type HomeScreenProps = {
  initialBrowserSessions?: OperatorBrowserSessionReadiness[];
  initialRuns?: RunSummary[];
  initialSpotifyAuth?: {
    detail: string;
    status: "connected" | "missing";
    subjectHint: string | null;
  };
};

function getStatusTone(status: RunStatus) {
  if (status === "completed") {
    return "success" as const;
  }

  if (status === "awaiting-approval" || status === "failed") {
    return "warning" as const;
  }

  return "muted" as const;
}

function formatSourceLabel(sourceType: RunSummary["sourceType"]) {
  return sourceType === "spotify" ? "Spotify" : "SoundCloud";
}

function formatTrackCount(trackCount: number) {
  return `${trackCount} ${trackCount === 1 ? "track" : "tracks"}`;
}

function getBrowserSessionTone(
  status: OperatorBrowserSessionReadiness["status"]
) {
  if (status === "ready") {
    return "success" as const;
  }

  if (status === "setup-in-progress") {
    return "muted" as const;
  }

  return "warning" as const;
}

function formatBrowserSessionStatus(
  status: OperatorBrowserSessionReadiness["status"]
) {
  if (status === "ready") {
    return "Ready";
  }

  if (status === "setup-in-progress") {
    return "Setup Open";
  }

  if (status === "expired") {
    return "Expired";
  }

  return "Missing";
}

function getBrowserSessionAction(
  session: OperatorBrowserSessionReadiness
): "launch" | "mark-authenticated" {
  return session.status === "setup-in-progress"
    ? "mark-authenticated"
    : "launch";
}

function formatBrowserSessionActionLabel(
  session: OperatorBrowserSessionReadiness
) {
  if (session.status === "setup-in-progress") {
    return "Mark ready";
  }

  if (session.status === "ready" || session.status === "expired") {
    return "Refresh";
  }

  return "Launch";
}

function getApiUrl(pathname: string) {
  const baseUrl =
    typeof window === "undefined" || window.location.origin === "null"
      ? "http://localhost"
      : window.location.origin;

  return new URL(pathname, baseUrl).toString();
}

function toRunSummary(run: RunSummary | RunDetail): RunSummary {
  return {
    artifactCount: run.artifactCount,
    createdAt: run.createdAt,
    id: run.id,
    playlistTitle: run.playlistTitle,
    playlistUrl: run.playlistUrl,
    resumeAfterStatus: run.resumeAfterStatus,
    sourceType: run.sourceType,
    status: run.status,
    trackCount: run.trackCount,
    updatedAt: run.updatedAt
  };
}

function upsertRun(runs: RunSummary[], incomingRun: RunSummary) {
  return [incomingRun, ...runs.filter((run) => run.id !== incomingRun.id)].sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt)
  );
}

function updateBrowserSession(
  sessions: OperatorBrowserSessionReadiness[],
  incomingSession: OperatorBrowserSessionReadiness
) {
  return sessions.map((session) =>
    session.providerId === incomingSession.providerId ? incomingSession : session
  );
}

export function HomeScreen({
  initialBrowserSessions = [],
  initialRuns = [],
  initialSpotifyAuth = {
    detail:
      "Spotify playlist intake requires a connected Spotify account before queueing Spotify playlists.",
    status: "missing",
    subjectHint: null
  }
}: HomeScreenProps) {
  const [browserSessions, setBrowserSessions] = useState(initialBrowserSessions);
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [recentRuns, setRecentRuns] = useState(initialRuns);
  const [sessionActionError, setSessionActionError] = useState<string | null>(
    null
  );
  const [sessionActionProviderId, setSessionActionProviderId] = useState<
    string | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const providerSessionsNeedingAttention = browserSessions.filter(
    (session) => session.status !== "ready"
  ).length;

  const pollRuns = useEffectEvent(async () => {
    const activeRuns = recentRuns.filter(
      (run) => !terminalStatuses.includes(run.status)
    );

    if (!activeRuns.length) {
      return;
    }

    const refreshedRuns = await Promise.all(
      activeRuns.map(async (run) => {
        const response = await fetch(getApiUrl(`/api/runs/${run.id}`), {
          cache: "no-store"
        });

        if (!response.ok) {
          return run;
        }

        const payload = (await response.json()) as RunDetail;

        return toRunSummary(payload);
      })
    );

    startTransition(() => {
      setRecentRuns((currentRuns) => {
        let nextRuns = currentRuns;

        for (const run of refreshedRuns) {
          nextRuns = upsertRun(nextRuns, run);
        }

        return nextRuns;
      });
    });
  });

  useEffect(() => {
    const activeRuns = recentRuns.filter(
      (run) => !terminalStatuses.includes(run.status)
    );

    if (!activeRuns.length) {
      return;
    }

    void pollRuns();

    const intervalId = window.setInterval(() => {
      void pollRuns();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [recentRuns]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const createRunUrl = getApiUrl("/api/runs");
      const response = await fetch(createRunUrl, {
        body: JSON.stringify({ playlistUrl }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };

        throw new Error(payload.error ?? "Unable to queue playlist.");
      }

      const createdRun = (await response.json()) as RunDetail;

      startTransition(() => {
        setRecentRuns((currentRuns) => upsertRun(currentRuns, createdRun));
        setPlaylistUrl("");
      });
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Unable to queue playlist."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleBrowserSessionAction(
    session: OperatorBrowserSessionReadiness
  ) {
    setSessionActionError(null);
    setSessionActionProviderId(session.providerId);

    try {
      const response = await fetch(getApiUrl("/api/operator/browser-sessions"), {
        body: JSON.stringify({
          action: getBrowserSessionAction(session),
          providerId: session.providerId
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };

        throw new Error(
          payload.error ?? "Unable to update the browser-session setup state."
        );
      }

      const payload = (await response.json()) as {
        provider: OperatorBrowserSessionReadiness;
      };

      startTransition(() => {
        setBrowserSessions((currentSessions) =>
          updateBrowserSession(currentSessions, payload.provider)
        );
      });
    } catch (error) {
      setSessionActionError(
        error instanceof Error
          ? error.message
          : "Unable to update the browser-session setup state."
      );
    } finally {
      setSessionActionProviderId(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="hero-kicker">Local operator shell</p>
          <h1>Playlist acquisition</h1>
          <p className="hero-copy">
            Queue one Spotify or SoundCloud playlist and let the local
            orchestrator ingest tracks, match providers, package artifacts, and
            open Beatport review when paid fallback is required.
          </p>
        </div>
        <div className="hero-sidecar">
          <StatusBadge tone={recentRuns.length ? "success" : "muted"}>
            {recentRuns.length
              ? `${recentRuns.length} recent ${recentRuns.length === 1 ? "run" : "runs"}`
              : "No runs yet"}
          </StatusBadge>
          <p className="hero-note">
            Playwright fixture mode keeps end-to-end verification deterministic.
            Live operator runs need Spotify and SoundCloud API credentials plus
            refreshed provider browser sessions before queueing real
            acquisition.
          </p>
        </div>
      </header>

      <div className="dashboard-grid">
        <Panel
          eyebrow="Spotify"
          title="Spotify Connection"
          footer={
            <span className="panel-caption">
              {initialSpotifyAuth.status === "connected"
                ? "Spotify playlist intake is ready"
                : "Connect Spotify before queueing Spotify playlists"}
            </span>
          }
        >
          <div className="prerequisites-copy">
            <p>{initialSpotifyAuth.detail}</p>
            <p>
              This connection is used only for Spotify playlist metadata intake.
              Provider downloads still rely on the separate browser-session
              setup below.
            </p>
          </div>

          {initialSpotifyAuth.subjectHint ? (
            <p className="session-card-meta">{initialSpotifyAuth.subjectHint}</p>
          ) : null}

          <div className="session-card-actions">
            <Link
              className="secondary-button"
              href="/api/operator/spotify-auth/start"
              aria-label={
                initialSpotifyAuth.status === "connected"
                  ? "Reconnect Spotify account"
                  : "Connect Spotify account"
              }
            >
              {initialSpotifyAuth.status === "connected"
                ? "Reconnect Spotify"
                : "Connect Spotify"}
            </Link>
          </div>
        </Panel>

        <Panel
          className="prerequisites-panel"
          eyebrow="Live Setup"
          title="Live Prerequisites"
          footer={
            <span className="panel-caption">
              {providerSessionsNeedingAttention
                ? `${providerSessionsNeedingAttention} provider ${providerSessionsNeedingAttention === 1 ? "session needs" : "sessions need"} attention`
                : "All required provider sessions are ready"}
            </span>
          }
        >
          <div className="prerequisites-copy">
            <p>
              Live playlist queueing depends on Spotify and SoundCloud API
              credentials plus persisted browser sessions for SoundCloud direct
              downloads, Bandcamp, and Beatport refresh.
            </p>
            <p>
              Launch setup to open a headed Playwright profile, finish the
              provider login manually, then return here and mark the session
              ready.
            </p>
          </div>

          {sessionActionError ? (
            <p className="form-status" role="alert">
              {sessionActionError}
            </p>
          ) : null}

          <div className="session-grid" aria-label="Live provider session readiness">
            {browserSessions.map((session) => {
              const actionLabel = formatBrowserSessionActionLabel(session);
              const isPending = sessionActionProviderId === session.providerId;

              return (
                <article className="session-card" key={session.providerId}>
                  <div className="session-card-head">
                    <div className="session-card-title-block">
                      <p className="session-card-label">Persistent session</p>
                      <h3 className="session-card-name">{session.providerName}</h3>
                      <p className="session-card-meta">{session.sessionName}</p>
                    </div>
                    <StatusBadge tone={getBrowserSessionTone(session.status)}>
                      {formatBrowserSessionStatus(session.status)}
                    </StatusBadge>
                  </div>

                  <p className="session-card-detail">{session.detail}</p>

                  {session.subjectHint ? (
                    <p className="session-card-meta">{session.subjectHint}</p>
                  ) : null}

                  <div className="session-card-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={isPending}
                      aria-label={`${actionLabel} ${session.providerName} session setup`}
                      onClick={() => void handleBrowserSessionAction(session)}
                    >
                      {isPending
                        ? session.status === "setup-in-progress"
                          ? "Saving..."
                          : "Launching..."
                        : `${actionLabel} setup`}
                    </button>
                    <p className="session-card-link">{session.setupUrl}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </Panel>

        <Panel
          eyebrow="Intake"
          title="Playlist Intake"
          footer={
            <span className="panel-caption">Starts the live orchestration path</span>
          }
        >
          <form className="panel-form" onSubmit={handleSubmit}>
            <label className="field" htmlFor="playlist-url">
              <span className="field-label">Playlist URL</span>
              <input
                id="playlist-url"
                className="field-input"
                name="playlistUrl"
                type="url"
                placeholder="https://open.spotify.com/playlist/..."
                value={playlistUrl}
                onChange={(event) => setPlaylistUrl(event.target.value)}
              />
            </label>

            <div className="form-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={isSubmitting || playlistUrl.trim().length === 0}
              >
                {isSubmitting ? "Queueing..." : "Queue Playlist"}
              </button>
              <p className="field-hint">
                Submits the playlist into intake, matching, acquisition,
                packaging, and Beatport review queueing.
              </p>
            </div>

            {submitError ? (
              <p className="form-status" role="alert">
                {submitError}
              </p>
            ) : null}
          </form>
        </Panel>

        <Panel
          eyebrow="Run Report"
          title="Recent Runs"
          footer={
            <span className="panel-caption">
              {recentRuns.length
                ? `SQLite-backed ${recentRuns.length === 1 ? "record" : "records"}`
                : "Waiting for the first queued run"}
            </span>
          }
        >
          {recentRuns.length ? (
            <div className="run-list" aria-label="Recent runs list">
              {recentRuns.map((run) => (
                <article className="run-card" key={run.id}>
                  <div className="run-card-head">
                    <div>
                      <p className="run-card-source">
                        {formatSourceLabel(run.sourceType)}
                      </p>
                      {run.playlistTitle ? (
                        <p className="run-card-title">{run.playlistTitle}</p>
                      ) : null}
                      <p className="run-card-url">{run.playlistUrl}</p>
                    </div>
                    <StatusBadge tone={getStatusTone(run.status)}>
                      {run.status}
                    </StatusBadge>
                  </div>

                  <dl className="run-card-stats">
                    <div>
                      <dt>Tracks</dt>
                      <dd>{formatTrackCount(run.trackCount)}</dd>
                    </div>
                    <div>
                      <dt>Artifacts</dt>
                      <dd>{run.artifactCount}</dd>
                    </div>
                    <div>
                      <dt>Resume</dt>
                      <dd>{run.resumeAfterStatus ?? "fresh run"}</dd>
                    </div>
                  </dl>

                  <div className="run-card-actions">
                    <Link
                      className="inline-link"
                      href={`/runs/${run.id}`}
                      aria-label={`Open report for ${run.playlistTitle ?? run.playlistUrl}`}
                    >
                      Open report
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-head">
                <StatusBadge tone="warning">No runs yet</StatusBadge>
                <p>
                  Completed acquisitions will publish their report, misses, and
                  packaged download artifacts here.
                </p>
              </div>

              <div className="badge-row" aria-label="Expected output artifacts">
                {artifacts.map((artifact) => (
                  <FileBadge key={artifact} label={artifact} />
                ))}
              </div>

              <dl className="status-list">
                <div>
                  <dt>Queue</dt>
                  <dd>Queued runs will appear as soon as intake succeeds.</dd>
                </div>
                <div>
                  <dt>Runs</dt>
                  <dd>SQLite persistence is active for new acquisition jobs.</dd>
                </div>
                <div>
                  <dt>Artifacts</dt>
                  <dd>Output packaging will populate once jobs exist.</dd>
                </div>
              </dl>
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
}
