import { render, screen } from "@testing-library/react";

import { RunReportScreen } from "./run-report-screen";

describe("RunReportScreen", () => {
  it("renders an in-progress run with artifact and review placeholders", () => {
    render(<RunReportScreen report={buildRunningReport() as never} />);

    expect(
      screen.getByRole("heading", { name: /warehouse warmup/i })
    ).toBeVisible();
    expect(screen.getByText(/^matching$/i)).toBeVisible();
    expect(
      screen.getByText(/artifacts will appear after packaging completes/i)
    ).toBeVisible();
    expect(
      screen.getByText(/no paid fallback approvals are queued for this run yet/i)
    ).toBeVisible();
  });

  it("renders completed track outcomes and artifact download links", () => {
    render(<RunReportScreen report={buildCompletedReport() as never} />);

    expect(
      screen.getByRole("link", { name: /downloads\.zip/i })
    ).toHaveAttribute("href", "/api/runs/run-complete/artifacts/downloads-zip");
    expect(
      screen.getByRole("link", { name: /manifest\.json/i })
    ).toHaveAttribute("href", "/api/runs/run-complete/artifacts/manifest-json");
    expect(screen.getByText(/soundcloud direct downloads/i)).toBeVisible();
    expect(
      screen.getByText(/extended mix matched the highest-priority mix preference/i)
    ).toBeVisible();
  });

  it("renders miss-heavy review details with explicit rejection reasons", () => {
    render(<RunReportScreen report={buildMissHeavyReport() as never} />);

    expect(screen.getAllByText(/missed/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/no-authorized-source-match/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/no authorized source matched the requested track/i).length
    ).toBeGreaterThan(0);
    expect(screen.getByText(/3 misses/i)).toBeVisible();
  });
});

function buildRunningReport() {
  return {
    artifactCount: 0,
    artifacts: [],
    completedTrackCount: 0,
    createdAt: "2026-03-31T14:00:00.000Z",
    id: "run-running",
    missCount: 0,
    playlistTitle: "Warehouse Warmup",
    playlistUrl: "https://soundcloud.com/sets/warehouse-warmup",
    reviewQueue: [],
    resumeAfterStatus: null,
    selectedSourceCount: 0,
    sourceType: "soundcloud",
    status: "matching",
    trackCount: 2,
    tracks: [
      {
        artist: "Anyma",
        id: "track-1",
        latestAttempt: null,
        resolution: null,
        sourcePosition: 1,
        sourceTrackId: "sc-101",
        status: "matched",
        title: "Consciousness",
        version: "Extended Mix"
      },
      {
        artist: "Fred again..",
        id: "track-2",
        latestAttempt: null,
        resolution: null,
        sourcePosition: 2,
        sourceTrackId: "sc-102",
        status: "queued",
        title: "Delilah",
        version: null
      }
    ],
    updatedAt: "2026-03-31T14:05:00.000Z"
  };
}

function buildCompletedReport() {
  return {
    ...buildRunningReport(),
    artifactCount: 3,
    artifacts: [
      {
        downloadUrl: "/api/runs/run-complete/artifacts/downloads-zip",
        kind: "downloads-zip",
        label: "downloads.zip"
      },
      {
        downloadUrl: "/api/runs/run-complete/artifacts/misses-txt",
        kind: "misses-txt",
        label: "misses.txt"
      },
      {
        downloadUrl: "/api/runs/run-complete/artifacts/manifest-json",
        kind: "manifest-json",
        label: "manifest.json"
      }
    ],
    completedTrackCount: 2,
    id: "run-complete",
    playlistTitle: "Warehouse Drivers",
    reviewQueue: [],
    selectedSourceCount: 1,
    status: "completed",
    tracks: [
      {
        artist: "Anyma",
        id: "track-1",
        latestAttempt: {
          outcome: "matched",
          providerKey: "soundcloud-direct-downloads"
        },
        resolution: {
          details: "Extended Mix matched the highest-priority mix preference.",
          provider: {
            authorizationBasis: "uploader-enabled-download",
            name: "SoundCloud Direct Downloads",
            priceTier: "free",
            url: "https://soundcloud.com/anyma/consciousness"
          },
          selectedFormat: "mp3",
          type: "selected",
          selectionReason: "accepted-extended-mix"
        },
        sourcePosition: 1,
        sourceTrackId: "sc-101",
        status: "acquired",
        title: "Consciousness",
        version: "Extended Mix"
      },
      {
        artist: "Fred again..",
        id: "track-2",
        latestAttempt: {
          outcome: "missed",
          providerKey: "track-matcher"
        },
        resolution: {
          details: "No authorized source matched the requested track.",
          reason: "no-authorized-source-match",
          type: "miss"
        },
        sourcePosition: 2,
        sourceTrackId: "sc-102",
        status: "missed",
        title: "Delilah",
        version: null
      }
    ],
    updatedAt: "2026-03-31T14:25:00.000Z"
  };
}

function buildMissHeavyReport() {
  return {
    ...buildCompletedReport(),
    completedTrackCount: 3,
    missCount: 3,
    selectedSourceCount: 0,
    trackCount: 3,
    tracks: [
      {
        artist: "Artist One",
        id: "track-1",
        latestAttempt: {
          outcome: "missed",
          providerKey: "track-matcher"
        },
        resolution: {
          details: "No authorized source matched the requested track.",
          reason: "no-authorized-source-match",
          type: "miss"
        },
        sourcePosition: 1,
        sourceTrackId: "sc-101",
        status: "missed",
        title: "Track One",
        version: "Extended Mix"
      },
      {
        artist: "Artist Two",
        id: "track-2",
        latestAttempt: {
          outcome: "missed",
          providerKey: "track-matcher"
        },
        resolution: {
          details: "No authorized source matched the requested track.",
          reason: "no-authorized-source-match",
          type: "miss"
        },
        sourcePosition: 2,
        sourceTrackId: "sc-102",
        status: "missed",
        title: "Track Two",
        version: null
      },
      {
        artist: "Artist Three",
        id: "track-3",
        latestAttempt: {
          outcome: "missed",
          providerKey: "track-matcher"
        },
        resolution: {
          details: "No authorized source matched the requested track.",
          reason: "no-authorized-source-match",
          type: "miss"
        },
        sourcePosition: 3,
        sourceTrackId: "sc-103",
        status: "missed",
        title: "Track Three",
        version: "Original Mix"
      }
    ]
  };
}
