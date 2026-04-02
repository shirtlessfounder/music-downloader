/* @vitest-environment node */

import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

async function withTempWorkspace(
  callback: (workspaceRoot: string) => Promise<void> | void
) {
  const tempDirectory = mkdtempSync(
    path.join(tmpdir(), "music-downloader-review-cart-route-")
  );
  const databasePath = path.join(tempDirectory, "data", "music-downloader.sqlite");

  process.env.MUSIC_DOWNLOADER_DB_PATH = databasePath;
  process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT = tempDirectory;

  try {
    await callback(tempDirectory);
  } finally {
    const runStoreModule = await import("@/features/runs/run-store");

    runStoreModule.resetRunStoreForTests();
    delete process.env.MUSIC_DOWNLOADER_DB_PATH;
    delete process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT;
    rmSync(tempDirectory, { force: true, recursive: true });
  }
}

describe("/api/runs/[runId]/review-queue/cart", () => {
  it("builds the run-level Beatport cart and persists per-row cart results", async () => {
    await withTempWorkspace(async () => {
      vi.resetModules();
      const runStoreModule = await import("@/features/runs/run-store");
      const store = runStoreModule.getRunStore();
      const run = store.createRun({
        playlistTitle: "Beatport Cart Route",
        playlistUrl: "https://open.spotify.com/playlist/6AA6AOvw9WM7qnVFrcp74i",
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

      const firstReview = store.queueRunTrackReview({
        sourceBasis: "purchase-entitlement",
        availableFormats: ["mp3", "wav"],
        candidateId: "beatport-1001",
        mixLabel: "Extended Mix",
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/consciousness/1001",
        queueName: "beatport-review",
        runTrackId: tracks[0].id,
        summary: "Queued after all automatic free-source providers missed."
      });
      const secondReview = store.queueRunTrackReview({
        sourceBasis: "purchase-entitlement",
        availableFormats: ["mp3"],
        candidateId: "beatport-1002",
        mixLabel: null,
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/drugs-from-amsterdam/1002",
        queueName: "beatport-review",
        runTrackId: tracks[1].id,
        summary: "Queued after all automatic free-source providers missed."
      });

      store.transitionRunTrackReviewStatus(secondReview.id, "approved");

      vi.doMock("@/features/providers/beatport-cart", () => ({
        openBeatportCartForReviews: async () => ({
          cartUrl: "https://www.beatport.com/cart",
          outcome: "opened-cart" as const,
          results: [
            {
              cartDetail: "Added track to the Beatport cart.",
              cartStatus: "added" as const,
              providerUrl: "https://www.beatport.com/track/consciousness/1001",
              reviewId: firstReview.id
            },
            {
              cartDetail: "Track already existed in the Beatport cart.",
              cartStatus: "already-in-cart" as const,
              providerUrl: "https://www.beatport.com/track/drugs-from-amsterdam/1002",
              reviewId: secondReview.id
            }
          ],
          summary: {
            added: 1,
            alreadyInCart: 1,
            failed: 0,
            notFound: 0,
            total: 2
          }
        })
      }));

      const { POST } = await import("./route");

      const response = await POST(
        new Request(`http://localhost/api/runs/${run.id}/review-queue/cart`, {
          method: "POST"
        }),
        {
          params: Promise.resolve({
            runId: run.id
          })
        }
      );
      const payload = (await response.json()) as {
        results: Array<{ reviewId: string }>;
        summary: {
          added: number;
          alreadyInCart: number;
          failed: number;
          notFound: number;
          total: number;
        };
      };

      expect(response.status).toBe(200);
      expect(payload.summary).toEqual({
        added: 1,
        alreadyInCart: 1,
        failed: 0,
        notFound: 0,
        total: 2
      });
      expect(payload.results.map((result) => result.reviewId)).toEqual([
        firstReview.id,
        secondReview.id
      ]);
      expect(store.getRun(run.id)?.reviewQueue).toEqual([
        expect.objectContaining({
          cartDetail: "Added track to the Beatport cart.",
          cartStatus: "added",
          id: firstReview.id
        }),
        expect.objectContaining({
          cartDetail: "Track already existed in the Beatport cart.",
          cartStatus: "already-in-cart",
          id: secondReview.id
        })
      ]);
    });
  });

  it("returns 409 when the Beatport cart cannot be opened", async () => {
    await withTempWorkspace(async () => {
      vi.resetModules();
      vi.doMock("@/features/providers/beatport-cart", () => ({
        openBeatportCartForReviews: async () => ({
          detail:
            "An authenticated Beatport browser session is required before the cart can be opened.",
          outcome: "failed" as const,
          reason: "auth-expired" as const
        })
      }));

      const [{ POST }, runStoreModule] = await Promise.all([
        import("./route"),
        import("@/features/runs/run-store")
      ]);
      const store = runStoreModule.getRunStore();
      const run = store.createRun({
        playlistTitle: "Beatport Cart Route Failure",
        playlistUrl: "https://soundcloud.com/sets/beatport-cart-route-failure",
        sourceType: "soundcloud"
      });
      const tracks = store.replaceRunTracks(run.id, [
        {
          artist: "Anyma",
          sourcePosition: 1,
          title: "Consciousness",
          version: "Extended Mix"
        }
      ]);

      store.transitionRunStatus(run.id, "ingesting");
      store.transitionRunStatus(run.id, "matching");
      const review = store.queueRunTrackReview({
        sourceBasis: "purchase-entitlement",
        availableFormats: ["mp3", "wav"],
        candidateId: "beatport-1001",
        mixLabel: "Extended Mix",
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/consciousness/1001",
        queueName: "beatport-review",
        runTrackId: tracks[0].id,
        summary: "Queued after all automatic free-source providers missed."
      });

      const response = await POST(
        new Request(`http://localhost/api/runs/${run.id}/review-queue/cart`, {
          method: "POST"
        }),
        {
          params: Promise.resolve({
            runId: run.id
          })
        }
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error:
          "An authenticated Beatport browser session is required before the cart can be opened."
      });
      expect(store.getRun(run.id)?.reviewQueue).toEqual([
        expect.objectContaining({
          cartDetail: null,
          cartStatus: null,
          id: review.id
        })
      ]);
    });
  });

  it("returns zero counts when the run has no eligible Beatport review rows", async () => {
    await withTempWorkspace(async () => {
      const [{ POST }, runStoreModule] = await Promise.all([
        import("./route"),
        import("@/features/runs/run-store")
      ]);
      const store = runStoreModule.getRunStore();
      const run = store.createRun({
        playlistTitle: "Empty Cart Route",
        playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9",
        sourceType: "spotify"
      });

      const response = await POST(
        new Request(`http://localhost/api/runs/${run.id}/review-queue/cart`, {
          method: "POST"
        }),
        {
          params: Promise.resolve({
            runId: run.id
          })
        }
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        cartUrl: null,
        results: [],
        summary: {
          added: 0,
          alreadyInCart: 0,
          failed: 0,
          notFound: 0,
          total: 0
        }
      });
    });
  });
});
