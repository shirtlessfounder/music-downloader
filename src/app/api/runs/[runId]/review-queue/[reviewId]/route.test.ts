/* @vitest-environment node */

import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

async function withTempDatabase(
  callback: (databasePath: string) => Promise<void> | void
) {
  const tempDirectory = mkdtempSync(
    path.join(tmpdir(), "music-downloader-review-route-")
  );
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

describe("/api/runs/[runId]/review-queue/[reviewId]", () => {
  it("persists approve reject and purchased review actions", async () => {
    await withTempDatabase(async () => {
      vi.resetModules();

      const [{ POST }, runStoreModule] = await Promise.all([
        import("./route"),
        import("@/features/runs/run-store")
      ]);
      const store = runStoreModule.getRunStore();
      const run = store.createRun({
        playlistTitle: "Beatport Route Flow",
        playlistUrl: "https://soundcloud.com/sets/beatport-route-flow",
        sourceType: "soundcloud"
      });
      const tracks = store.replaceRunTracks(run.id, [
        {
          artist: "Artist One",
          sourcePosition: 1,
          title: "Track One"
        },
        {
          artist: "Artist Two",
          sourcePosition: 2,
          title: "Track Two"
        }
      ]);

      store.transitionRunStatus(run.id, "ingesting");
      store.transitionRunStatus(run.id, "matching");

      const reviewOne = store.queueRunTrackReview({
        authorizationBasis: "purchase-entitlement",
        availableFormats: ["mp3", "wav"],
        candidateId: "beatport-route-1",
        mixLabel: "Original Mix",
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/track-one/route-1",
        queueName: "beatport-review",
        runTrackId: tracks[0].id,
        summary: "Queued after all automatic free-source providers missed."
      });
      const reviewTwo = store.queueRunTrackReview({
        authorizationBasis: "purchase-entitlement",
        availableFormats: ["mp3"],
        candidateId: "beatport-route-2",
        mixLabel: null,
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/track-two/route-2",
        queueName: "beatport-review",
        runTrackId: tracks[1].id,
        summary: "Queued after all automatic free-source providers missed."
      });

      const approveResponse = await POST(
        new Request(`http://localhost/api/runs/${run.id}/review-queue/${reviewOne.id}`, {
          body: JSON.stringify({ action: "approve" }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }),
        {
          params: Promise.resolve({
            reviewId: reviewOne.id,
            runId: run.id
          })
        }
      );
      const purchasedResponse = await POST(
        new Request(`http://localhost/api/runs/${run.id}/review-queue/${reviewOne.id}`, {
          body: JSON.stringify({ action: "purchased" }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }),
        {
          params: Promise.resolve({
            reviewId: reviewOne.id,
            runId: run.id
          })
        }
      );
      const rejectResponse = await POST(
        new Request(`http://localhost/api/runs/${run.id}/review-queue/${reviewTwo.id}`, {
          body: JSON.stringify({ action: "reject" }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }),
        {
          params: Promise.resolve({
            reviewId: reviewTwo.id,
            runId: run.id
          })
        }
      );

      expect(approveResponse.status).toBe(200);
      await expect(approveResponse.json()).resolves.toEqual(
        expect.objectContaining({
          id: reviewOne.id,
          status: "approved"
        })
      );
      expect(purchasedResponse.status).toBe(200);
      await expect(purchasedResponse.json()).resolves.toEqual(
        expect.objectContaining({
          id: reviewOne.id,
          status: "purchased"
        })
      );
      expect(rejectResponse.status).toBe(200);
      await expect(rejectResponse.json()).resolves.toEqual(
        expect.objectContaining({
          id: reviewTwo.id,
          status: "rejected"
        })
      );

      expect(store.getRun(run.id)).toEqual(
        expect.objectContaining({
          id: run.id,
          status: "awaiting-approval"
        })
      );
      expect(
        store
          .getRun(run.id)
          ?.reviewQueue.map((review) => [review.candidateId, review.status])
      ).toEqual([
        ["beatport-route-1", "purchased"],
        ["beatport-route-2", "rejected"]
      ]);
      expect(
        store
          .getRun(run.id)
          ?.tracks.map((track) => [track.sourcePosition, track.status])
      ).toEqual([
        [1, "awaiting-approval"],
        [2, "missed"]
      ]);
    });
  });
});
