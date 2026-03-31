"use client";

import Link from "next/link";
import { startTransition, useEffect, useEffectEvent, useState } from "react";

import { FileBadge } from "@/components/ui/file-badge";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";
import type { RunDetail, RunStatus, RunSummary } from "@/features/runs/run-store";

const artifacts = ["downloads.zip", "manifest.json", "misses.txt"];
const terminalStatuses: RunStatus[] = ["completed", "failed"];

type HomeScreenProps = {
  initialRuns?: RunSummary[];
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

export function HomeScreen({ initialRuns = [] }: HomeScreenProps) {
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [recentRuns, setRecentRuns] = useState(initialRuns);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="hero-kicker">Local operator shell</p>
          <h1>Authorized-source acquisition</h1>
          <p className="hero-copy">
            Intake one Spotify or SoundCloud playlist URL, then hand the
            background job, matching, and artifact work off to later tasks.
          </p>
        </div>
        <div className="hero-sidecar">
          <StatusBadge tone={recentRuns.length ? "success" : "muted"}>
            {recentRuns.length
              ? `${recentRuns.length} recent ${recentRuns.length === 1 ? "run" : "runs"}`
              : "No runs yet"}
          </StatusBadge>
          <p className="hero-note">
            Queue authorized playlist runs into the local SQLite job store.
            Acquisition, matching, and packaging workers land in later tasks.
          </p>
        </div>
      </header>

      <div className="dashboard-grid">
        <Panel
          eyebrow="Intake"
          title="Playlist Intake"
          footer={<span className="panel-caption">Creates queued run records</span>}
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
                Creates a queued local run record and exposes status polling for
                later background work.
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
