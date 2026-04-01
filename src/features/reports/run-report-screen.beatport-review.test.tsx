vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>(
    "next/navigation"
  );

  return {
    ...actual,
    useRouter: () => ({
      refresh: vi.fn()
    })
  };
});

import { render, screen } from "@testing-library/react";

import { RunReportScreen } from "./run-report-screen";

describe("RunReportScreen Beatport review lane", () => {
  it("renders persisted Beatport queue entries and operator actions", () => {
    render(<RunReportScreen report={buildBeatportReviewReport() as never} />);

    expect(
      screen.getAllByText(/queued after all automatic free-source providers missed/i)
        .length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/approved for manual purchase/i).length).toBeGreaterThan(
      0
    );
    expect(
      screen.getAllByText(/purchased download acquired for packaging/i).length
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", {
        name: /approve beatport candidate for anyma - consciousness/i
      })
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: /reject beatport candidate for anyma - consciousness/i
      })
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: /mark beatport candidate purchased for anyma - consciousness/i
      })
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: /approve beatport candidate for mau p - drugs from amsterdam/i
      })
    ).not.toBeInTheDocument();
  });
});

function buildBeatportReviewReport() {
  return {
    artifactCount: 0,
    artifacts: [],
    completedTrackCount: 1,
    createdAt: "2026-03-31T14:00:00.000Z",
    id: "run-review",
    missCount: 0,
    playlistTitle: "Paid Queue Showcase",
    playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9",
    reviewQueue: [
      {
        sourceBasis: "purchase-entitlement",
        availableFormats: ["mp3", "wav"],
        candidateId: "beatport-queue-1",
        createdAt: "2026-03-31T14:05:00.000Z",
        id: "review-1",
        mixLabel: "Extended Mix",
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/consciousness/queue-1",
        queueName: "beatport-review",
        runTrackId: "track-1",
        status: "approved",
        summary: "Queued after all automatic free-source providers missed.",
        track: {
          artist: "Anyma",
          id: "track-1",
          sourcePosition: 1,
          title: "Consciousness",
          version: "Extended Mix"
        },
        updatedAt: "2026-03-31T14:06:00.000Z"
      },
      {
        sourceBasis: "purchase-entitlement",
        availableFormats: ["mp3"],
        candidateId: "beatport-queue-2",
        createdAt: "2026-03-31T14:06:00.000Z",
        id: "review-2",
        mixLabel: null,
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/drugs-from-amsterdam/queue-2",
        queueName: "beatport-review",
        runTrackId: "track-2",
        status: "purchased",
        summary: "Queued after all automatic free-source providers missed.",
        track: {
          artist: "Mau P",
          id: "track-2",
          sourcePosition: 2,
          title: "Drugs From Amsterdam",
          version: null
        },
        updatedAt: "2026-03-31T14:08:00.000Z"
      }
    ],
    resumeAfterStatus: null,
    selectedSourceCount: 1,
    sourceType: "spotify",
    status: "awaiting-approval",
    trackCount: 2,
    tracks: [
      {
        artist: "Anyma",
        id: "track-1",
        latestAttempt: null,
        resolution: null,
        reviewQueueEntry: {
          sourceBasis: "purchase-entitlement",
          availableFormats: ["mp3", "wav"],
          candidateId: "beatport-queue-1",
          createdAt: "2026-03-31T14:05:00.000Z",
          id: "review-1",
          mixLabel: "Extended Mix",
          priceTier: "paid",
          providerKey: "beatport",
          providerName: "Beatport",
          providerUrl: "https://www.beatport.com/track/consciousness/queue-1",
          queueName: "beatport-review",
          runTrackId: "track-1",
          status: "approved",
          summary: "Queued after all automatic free-source providers missed.",
          track: {
            artist: "Anyma",
            id: "track-1",
            sourcePosition: 1,
            title: "Consciousness",
            version: "Extended Mix"
          },
          updatedAt: "2026-03-31T14:06:00.000Z"
        },
        sourcePosition: 1,
        sourceTrackId: "sp-101",
        status: "awaiting-approval",
        title: "Consciousness",
        version: "Extended Mix"
      },
      {
        artist: "Mau P",
        id: "track-2",
        latestAttempt: null,
        resolution: null,
        reviewQueueEntry: {
          sourceBasis: "purchase-entitlement",
          availableFormats: ["mp3"],
          candidateId: "beatport-queue-2",
          createdAt: "2026-03-31T14:06:00.000Z",
          id: "review-2",
          mixLabel: null,
          priceTier: "paid",
          providerKey: "beatport",
          providerName: "Beatport",
          providerUrl: "https://www.beatport.com/track/drugs-from-amsterdam/queue-2",
          queueName: "beatport-review",
          runTrackId: "track-2",
          status: "purchased",
          summary: "Queued after all automatic free-source providers missed.",
          track: {
            artist: "Mau P",
            id: "track-2",
            sourcePosition: 2,
            title: "Drugs From Amsterdam",
            version: null
          },
          updatedAt: "2026-03-31T14:08:00.000Z"
        },
        sourcePosition: 2,
        sourceTrackId: "sp-102",
        status: "acquired",
        title: "Drugs From Amsterdam",
        version: null
      }
    ],
    updatedAt: "2026-03-31T14:08:00.000Z"
  };
}
