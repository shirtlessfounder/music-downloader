import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { render, screen } from "@testing-library/react";

import {
  buildAcquiredArtifactSourceNote,
  buildMissedArtifactSourceNote
} from "@/features/artifacts/run-artifacts";

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
              authorizationBasis: "uploader-enabled-download",
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
              detail: "No authorized source matched the requested track.",
              reason: "no-authorized-source-match"
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
      expect(screen.getByText(/no-authorized-source-match/i)).toBeVisible();
      expect(
        screen.getByRole("link", { name: /downloads\.zip/i })
      ).toHaveAttribute("href", `/api/runs/${run.id}/artifacts/downloads-zip`);
      expect(
        screen.getByText(/no paid fallback approvals are queued for this run yet/i)
      ).toBeVisible();
    });
  });
});
