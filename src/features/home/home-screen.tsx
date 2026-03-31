import { FileBadge } from "@/components/ui/file-badge";
import { Panel } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/status-badge";

const artifacts = ["downloads.zip", "manifest.json", "misses.txt"];

export function HomeScreen() {
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
          <StatusBadge>No runs yet</StatusBadge>
          <p className="hero-note">
            This bootstrap only defines the shared shell. It does not start
            jobs, rip streams, or simulate provider behavior.
          </p>
        </div>
      </header>

      <div className="dashboard-grid">
        <Panel
          eyebrow="Intake"
          title="Playlist Intake"
          footer={<span className="panel-caption">Shared form baseline</span>}
        >
          <form className="panel-form">
            <label className="field" htmlFor="playlist-url">
              <span className="field-label">Playlist URL</span>
              <input
                id="playlist-url"
                className="field-input"
                name="playlistUrl"
                type="url"
                placeholder="https://open.spotify.com/playlist/..."
              />
            </label>

            <div className="form-actions">
              <button className="primary-button" type="submit" disabled>
                Queue Playlist
              </button>
              <p className="field-hint">
                Submission wiring lands in a later issue. This screen stays
                honest about the current bootstrap scope.
              </p>
            </div>
          </form>
        </Panel>

        <Panel
          eyebrow="Run Report"
          title="Recent Runs"
          footer={<span className="panel-caption">Empty state placeholder</span>}
        >
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
                <dd>No review queue entries yet.</dd>
              </div>
              <div>
                <dt>Runs</dt>
                <dd>The background job model is not wired in this issue.</dd>
              </div>
              <div>
                <dt>Artifacts</dt>
                <dd>Output packaging will populate once jobs exist.</dd>
              </div>
            </dl>
          </div>
        </Panel>
      </div>
    </main>
  );
}
