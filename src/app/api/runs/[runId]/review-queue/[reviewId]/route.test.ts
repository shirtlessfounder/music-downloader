/* @vitest-environment node */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

async function withTempWorkspace(
  callback: (workspaceRoot: string) => Promise<void> | void
) {
  const tempDirectory = mkdtempSync(
    path.join(tmpdir(), "music-downloader-review-route-")
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

describe("/api/runs/[runId]/review-queue/[reviewId]", () => {
  it("acquires a purchased Beatport review and completes the run through existing artifacts", async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      vi.resetModules();
      vi.doMock("@/features/providers/live-provider-registry", () => ({
        createLiveProviderRegistry: () => ({
          get(providerId: string) {
            if (providerId !== "beatport") {
              return null;
            }

            return {
              acquirePurchased: async ({ candidate }: { candidate: { candidateId: string } }) => {
                const artifactDirectory = path.join(workspaceRoot, "downloads");
                const artifactBody = Buffer.from(
                  `owned artifact for ${candidate.candidateId}\n`,
                  "utf8"
                );
                const artifactPath = path.join(artifactDirectory, "track-one.mp3");

                mkdirSync(artifactDirectory, { recursive: true });
                writeFileSync(artifactPath, artifactBody);

                return {
                  outcome: "acquired" as const,
                  artifact: {
                    contentType: "audio/mpeg",
                    fileExtension: "mp3",
                    fileName: "track-one.mp3",
                    format: "mp3" as const,
                    localFilePath: artifactPath,
                    sha256: "abc123",
                    sizeBytes: artifactBody.byteLength
                  },
                  candidate
                };
              }
            };
          }
        })
      }));

      const [{ POST }, runStoreModule, artifactsModule] = await Promise.all([
        import("./route"),
        import("@/features/runs/run-store"),
        import("@/features/artifacts/run-artifacts")
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
          status: "completed"
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
        [1, "acquired"],
        [2, "missed"]
      ]);
      expect([...((store.getRun(run.id)?.artifacts ?? []).map((artifact) => artifact.kind))].sort()).toEqual([
        "downloads-zip",
        "manifest-json",
        "misses-txt"
      ]);
      expect(
        artifactsModule
          .listRunArtifactDownloads({
            runId: run.id,
            runStore: store
          })
          .map((artifact) => artifact.kind)
      ).toEqual(["downloads-zip", "misses-txt", "manifest-json"]);

      const manifestArtifact = store
        .getRun(run.id)
        ?.artifacts.find((artifact) => artifact.kind === "manifest-json");

      expect(manifestArtifact).toBeDefined();

      const manifest = JSON.parse(
        readFileSync(
          path.join(workspaceRoot, manifestArtifact?.relativePath ?? ""),
          "utf8"
        )
      ) as {
        summary: {
          acquiredCount: number;
          missCount: number;
          trackCount: number;
        };
      };

      expect(manifest.summary).toEqual({
        acquiredCount: 1,
        missCount: 1,
        trackCount: 2
      });
    });
  });

  it("returns 409 when purchased acquisition fails and leaves the review queued", async () => {
    await withTempWorkspace(async () => {
      vi.resetModules();
      vi.doMock("@/features/providers/live-provider-registry", () => ({
        createLiveProviderRegistry: () => ({
          get(providerId: string) {
            if (providerId !== "beatport") {
              return null;
            }

            return {
              acquirePurchased: async ({ candidate }: { candidate: { candidateId: string } }) => ({
                outcome: "rejected" as const,
                candidate,
                rejection: {
                  detail:
                    "The Beatport browser session expired and must be refreshed before owned downloads can be acquired.",
                  providerId: "beatport",
                  providerName: "Beatport",
                  reason: "provider-session-expired" as const,
                  retryable: true
                }
              })
            };
          }
        })
      }));

      const [{ POST }, runStoreModule] = await Promise.all([
        import("./route"),
        import("@/features/runs/run-store")
      ]);
      const store = runStoreModule.getRunStore();
      const run = store.createRun({
        playlistTitle: "Beatport Purchased Failure",
        playlistUrl: "https://soundcloud.com/sets/beatport-purchased-failure",
        sourceType: "soundcloud"
      });
      const [track] = store.replaceRunTracks(run.id, [
        {
          artist: "Artist One",
          sourcePosition: 1,
          title: "Track One"
        }
      ]);

      store.transitionRunStatus(run.id, "ingesting");
      store.transitionRunStatus(run.id, "matching");

      const review = store.queueRunTrackReview({
        authorizationBasis: "purchase-entitlement",
        availableFormats: ["mp3"],
        candidateId: "beatport-purchased-failure-1",
        mixLabel: null,
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/track-one/failure-1",
        queueName: "beatport-review",
        runTrackId: track.id,
        summary: "Queued after all automatic free-source providers missed."
      });

      const purchasedResponse = await POST(
        new Request(`http://localhost/api/runs/${run.id}/review-queue/${review.id}`, {
          body: JSON.stringify({ action: "purchased" }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }),
        {
          params: Promise.resolve({
            reviewId: review.id,
            runId: run.id
          })
        }
      );

      expect(purchasedResponse.status).toBe(409);
      await expect(purchasedResponse.json()).resolves.toEqual({
        error:
          "The Beatport browser session expired and must be refreshed before owned downloads can be acquired."
      });
      expect(store.getRun(run.id)).toEqual(
        expect.objectContaining({
          id: run.id,
          status: "awaiting-approval"
        })
      );
      expect(
        store.getRun(run.id)?.reviewQueue.map((candidate) => [candidate.candidateId, candidate.status])
      ).toEqual([["beatport-purchased-failure-1", "queued"]]);
      expect(
        store.getRun(run.id)?.tracks.map((candidate) => [candidate.sourcePosition, candidate.status])
      ).toEqual([[1, "awaiting-approval"]]);
    });
  });

  it("finalizes the run when the last remaining review candidate is rejected", async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      vi.resetModules();
      vi.doUnmock("@/features/providers/live-provider-registry");

      const [{ POST }, runStoreModule, artifactsModule] = await Promise.all([
        import("./route"),
        import("@/features/runs/run-store"),
        import("@/features/artifacts/run-artifacts")
      ]);
      const store = runStoreModule.getRunStore();
      const run = store.createRun({
        playlistTitle: "Beatport Final Reject",
        playlistUrl: "https://soundcloud.com/sets/beatport-final-reject",
        sourceType: "soundcloud"
      });
      const [track] = store.replaceRunTracks(run.id, [
        {
          artist: "Artist One",
          sourcePosition: 1,
          title: "Track One"
        }
      ]);

      store.transitionRunStatus(run.id, "ingesting");
      store.transitionRunStatus(run.id, "matching");

      const review = store.queueRunTrackReview({
        authorizationBasis: "purchase-entitlement",
        availableFormats: ["mp3", "wav"],
        candidateId: "beatport-final-reject-1",
        mixLabel: "Original Mix",
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/track-one/final-reject-1",
        queueName: "beatport-review",
        runTrackId: track.id,
        summary: "Queued after all automatic free-source providers missed."
      });

      const rejectResponse = await POST(
        new Request(`http://localhost/api/runs/${run.id}/review-queue/${review.id}`, {
          body: JSON.stringify({ action: "reject" }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        }),
        {
          params: Promise.resolve({
            reviewId: review.id,
            runId: run.id
          })
        }
      );

      expect(rejectResponse.status).toBe(200);
      await expect(rejectResponse.json()).resolves.toEqual(
        expect.objectContaining({
          id: review.id,
          status: "rejected"
        })
      );

      const persistedRun = store.getRun(run.id);

      expect(persistedRun).toEqual(
        expect.objectContaining({
          id: run.id,
          status: "completed"
        })
      );
      expect(
        persistedRun?.reviewQueue.map((candidate) => [candidate.candidateId, candidate.status])
      ).toEqual([["beatport-final-reject-1", "rejected"]]);
      expect(
        persistedRun?.tracks.map((candidate) => [candidate.sourcePosition, candidate.status])
      ).toEqual([[1, "missed"]]);
      expect([...((persistedRun?.artifacts ?? []).map((artifact) => artifact.kind))].sort()).toEqual([
        "downloads-zip",
        "manifest-json",
        "misses-txt"
      ]);
      expect(
        artifactsModule
          .listRunArtifactDownloads({
            runId: run.id,
            runStore: store
          })
          .map((artifact) => artifact.kind)
      ).toEqual(["downloads-zip", "misses-txt", "manifest-json"]);

      const manifestArtifact = persistedRun?.artifacts.find(
        (artifact) => artifact.kind === "manifest-json"
      );

      expect(manifestArtifact).toBeDefined();

      const manifest = JSON.parse(
        readFileSync(
          path.join(workspaceRoot, manifestArtifact?.relativePath ?? ""),
          "utf8"
        )
      ) as {
        summary: {
          acquiredCount: number;
          missCount: number;
          trackCount: number;
        };
      };

      expect(manifest.summary).toEqual({
        acquiredCount: 0,
        missCount: 1,
        trackCount: 1
      });
    });
  });
});
