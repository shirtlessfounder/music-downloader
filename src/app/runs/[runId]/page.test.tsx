import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { render, screen } from "@testing-library/react";

import {
  buildAcquiredArtifactSourceNote,
  buildMissedArtifactSourceNote
} from "@/features/artifacts/run-artifacts";
import { resetSharedRunWorkerForTests } from "@/features/runs/run-worker";

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

async function withTempDatabase(callback: (databasePath: string) => Promise<void>) {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), "music-downloader-report-"));
  const databasePath = path.join(tempDirectory, "music-downloader.sqlite");

  process.env.MUSIC_DOWNLOADER_DB_PATH = databasePath;

  try {
    await callback(databasePath);
  } finally {
    const runStoreModule = await import("@/features/runs/run-store");

    runStoreModule.resetRunStoreForTests();
    delete process.env.MUSIC_DOWNLOADER_DB_PATH;
    rmSync(tempDirectory, { force: true, recursive: true });
  }
}

describe("RunReportPage", () => {
  beforeEach(() => {
    resetSharedRunWorkerForTests();
  });

  afterEach(() => {
    resetSharedRunWorkerForTests();
  });

  it("renders persisted run details, source selections, misses, and artifact links", async () => {
    await withTempDatabase(async () => {
      vi.resetModules();

      const runStoreModule = await import("@/features/runs/run-store");
      const store = runStoreModule.getRunStore();
      const run = store.createRun({
        playlistTitle: "Night Drive",
        playlistUrl: "https://soundcloud.com/sets/night-drive",
        sourceType: "soundcloud"
      });
      const tracks = store.replaceRunTracks(run.id, [
        {
          artist: "Nora En Pure",
          sourcePosition: 1,
          title: "Lake Arrowhead",
          version: "Original Mix"
        },
        {
          artist: "Artist Two",
          sourcePosition: 2,
          title: "Unknown Track"
        }
      ]);

      store.transitionRunStatus(run.id, "ingesting");
      store.transitionRunStatus(run.id, "matching");
      store.transitionRunStatus(run.id, "packaging");
      store.updateRunTrackStatus(tracks[0].id, "acquired");
      store.updateRunTrackStatus(tracks[1].id, "missed");
      store.recordAcquisitionAttempt({
        note: JSON.stringify(
          buildAcquiredArtifactSourceNote({
            artifact: {
              fileExtension: "mp3",
              fileName: "lake-arrowhead.mp3",
              format: "mp3",
              localFilePath: "/tmp/lake-arrowhead.mp3",
              sizeBytes: 1024
            },
            provider: {
              sourceBasis: "uploader-enabled-download",
              priceTier: "free",
              providerId: "soundcloud-direct-downloads",
              providerName: "SoundCloud Direct Downloads",
              providerUrl: "https://soundcloud.com/noraenpure/lake-arrowhead"
            },
            selection: {
              details: "Original Mix matched the approved fallback preference order.",
              reason: "accepted-original-mix",
              selectedFormat: "mp3"
            }
          })
        ),
        outcome: "matched",
        providerKey: "soundcloud-direct-downloads",
        runTrackId: tracks[0].id
      });
      store.recordAcquisitionAttempt({
        note: JSON.stringify(
          buildMissedArtifactSourceNote({
            miss: {
              detail: "No supported source matched the requested track.",
              reason: "no-supported-source-match"
            }
          })
        ),
        outcome: "missed",
        providerKey: "track-matcher",
        runTrackId: tracks[1].id
      });
      store.replaceRunArtifacts(run.id, [
        {
          kind: "downloads-zip",
          relativePath: `data/runs/${run.id}/artifacts/downloads.zip`,
          runId: run.id
        },
        {
          kind: "misses-txt",
          relativePath: `data/runs/${run.id}/artifacts/misses.txt`,
          runId: run.id
        },
        {
          kind: "manifest-json",
          relativePath: `data/runs/${run.id}/artifacts/manifest.json`,
          runId: run.id
        }
      ]);
      store.transitionRunStatus(run.id, "completed");

      const pageModule = await import("./page");

      render(
        await pageModule.default({
          params: Promise.resolve({ runId: run.id })
        })
      );

      expect(
        screen.getByRole("heading", { name: /night drive/i })
      ).toBeVisible();
      expect(screen.getByText(/^completed$/i)).toBeVisible();
      expect(screen.getByText(/soundcloud direct downloads/i)).toBeVisible();
      expect(
        screen.getByText(/original mix matched the approved fallback preference order/i)
      ).toBeVisible();
      expect(screen.getByText(/no-supported-source-match/i)).toBeVisible();
      expect(
        screen.getByRole("link", { name: /downloads\.zip/i })
      ).toHaveAttribute("href", `/api/runs/${run.id}/artifacts/downloads-zip`);
      expect(
        screen.getByText(/no paid fallback approvals are queued for this run yet/i)
      ).toBeVisible();
    });
  });

  it("renders the persisted Beatport approval queue and review controls", async () => {
    await withTempDatabase(async () => {
      vi.resetModules();

      const runStoreModule = await import("@/features/runs/run-store");
      const store = runStoreModule.getRunStore();
      const run = store.createRun({
        playlistTitle: "Paid Queue Showcase",
        playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9",
        sourceType: "spotify"
      });
      const tracks = store.replaceRunTracks(run.id, [
        {
          artist: "Anyma",
          sourcePosition: 1,
          title: "Consciousness",
          version: "Extended Mix"
        },
        {
          artist: "Mau P",
          sourcePosition: 2,
          title: "Drugs From Amsterdam"
        }
      ]);

      store.transitionRunStatus(run.id, "ingesting");
      store.transitionRunStatus(run.id, "matching");

      const queuedReview = store.queueRunTrackReview({
        sourceBasis: "purchase-entitlement",
        availableFormats: ["mp3", "wav"],
        candidateId: "beatport-queue-1",
        mixLabel: "Extended Mix",
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/consciousness/queue-1",
        queueName: "beatport-review",
        runTrackId: tracks[0].id,
        summary: "Queued after all automatic free-source providers missed."
      });
      const purchasedReview = store.queueRunTrackReview({
        sourceBasis: "purchase-entitlement",
        availableFormats: ["mp3"],
        candidateId: "beatport-queue-2",
        mixLabel: null,
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/drugs-from-amsterdam/queue-2",
        queueName: "beatport-review",
        runTrackId: tracks[1].id,
        summary: "Queued after all automatic free-source providers missed."
      });

      store.transitionRunTrackReviewStatus(queuedReview.id, "approved");
      store.transitionRunTrackReviewStatus(purchasedReview.id, "approved");
      store.completePurchasedRunTrackReview({
        artifact: {
          contentType: "audio/mpeg",
          fileExtension: "mp3",
          fileName: "drugs-from-amsterdam.mp3",
          format: "mp3",
          localFilePath: "/tmp/drugs-from-amsterdam.mp3",
          sha256: "abc123",
          sizeBytes: 1234
        },
        reviewId: purchasedReview.id
      });

      const pageModule = await import("./page");

      render(
        await pageModule.default({
          params: Promise.resolve({ runId: run.id })
        })
      );

      expect(screen.getByRole("heading", { name: /review lane/i })).toBeVisible();
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
          name: /open beatport cart \(1\)/i
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
          name: /approve beatport candidate for anyma - consciousness/i
        })
      ).not.toBeInTheDocument();
      expect(queuedReview.candidateId).toBe("beatport-queue-1");
    });
  });
});
