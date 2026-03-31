/* @vitest-environment node */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  createRunStore,
  type RunStatus,
  type RunTrackStatus
} from "./run-store";

function createTempDatabasePath() {
  const tempDirectory = mkdtempSync(
    path.join(tmpdir(), "music-downloader-run-store-")
  );

  return {
    databasePath: path.join(tempDirectory, "music-downloader.sqlite"),
    cleanup() {
      rmSync(tempDirectory, { force: true, recursive: true });
    }
  };
}

describe("createRunStore", () => {
  it("creates the local SQLite file and persists queued runs", () => {
    const tempDatabase = createTempDatabasePath();

    try {
      const store = createRunStore({ databasePath: tempDatabase.databasePath });

      const run = store.createRun({
        playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n",
        sourceType: "spotify"
      });

      expect(existsSync(tempDatabase.databasePath)).toBe(true);
      expect(run.status).toBe("queued");
      expect(store.listRuns()).toEqual([
        expect.objectContaining({
          id: run.id,
          sourceType: "spotify",
          status: "queued",
          trackCount: 0
        })
      ]);
      expect(store.getRun(run.id)).toEqual(
        expect.objectContaining({
          id: run.id,
          status: "queued",
          tracks: [],
          artifacts: []
        })
      );
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("allows only explicit lifecycle transitions", () => {
    const tempDatabase = createTempDatabasePath();

    try {
      const store = createRunStore({ databasePath: tempDatabase.databasePath });
      const run = store.createRun({
        playlistUrl: "https://soundcloud.com/sets/late-night-test-set",
        sourceType: "soundcloud"
      });

      const transitions: RunStatus[] = [
        "ingesting",
        "matching",
        "awaiting-approval",
        "packaging",
        "completed"
      ];

      let currentRunId = run.id;

      for (const nextStatus of transitions) {
        const nextRun = store.transitionRunStatus(currentRunId, nextStatus);

        expect(nextRun.status).toBe(nextStatus);
        currentRunId = nextRun.id;
      }

      expect(() =>
        store.transitionRunStatus(run.id, "queued")
      ).toThrowErrorMatchingInlineSnapshot(
        `[Error: Invalid run status transition: completed -> queued]`
      );
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("requeues interrupted runs on store boot without losing per-track progress", () => {
    const tempDatabase = createTempDatabasePath();
    let initialStore:
      | ReturnType<typeof createRunStore>
      | undefined;
    let resumedStore:
      | ReturnType<typeof createRunStore>
      | undefined;

    try {
      initialStore = createRunStore({
        databasePath: tempDatabase.databasePath
      });
      const run = initialStore.createRun({
        playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DWZxZ8T6qM2Yj",
        sourceType: "spotify"
      });

      const tracks = initialStore.replaceRunTracks(run.id, [
        {
          artist: "Artist One",
          sourcePosition: 1,
          title: "Track One",
          status: "queued"
        },
        {
          artist: "Artist Two",
          sourcePosition: 2,
          title: "Track Two",
          status: "queued"
        }
      ]);

      initialStore.transitionRunStatus(run.id, "ingesting");
      initialStore.transitionRunStatus(run.id, "matching");
      initialStore.updateRunTrackStatus(tracks[0].id, "matched");
      initialStore.updateRunTrackStatus(tracks[1].id, "failed");
      initialStore.close();
      initialStore = undefined;

      resumedStore = createRunStore({
        databasePath: tempDatabase.databasePath
      });

      expect(resumedStore.getRunStatusSnapshot(run.id)).toEqual(
        expect.objectContaining({
          id: run.id,
          resumeAfterStatus: "matching",
          status: "queued"
        })
      );
      expect(
        resumedStore
          .getRun(run.id)
          ?.tracks.map((track) => [track.sourcePosition, track.status] satisfies [
            number,
            RunTrackStatus
          ])
      ).toEqual([
        [1, "matched"],
        [2, "failed"]
      ]);
    } finally {
      initialStore?.close();
      resumedStore?.close();
      tempDatabase.cleanup();
    }
  });

  it("persists paid review candidates as one per-run approval queue", () => {
    const tempDatabase = createTempDatabasePath();

    try {
      const store = createRunStore({ databasePath: tempDatabase.databasePath });
      const run = store.createRun({
        playlistTitle: "Beatport Review Batch",
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

      const firstReview = store.queueRunTrackReview({
        authorizationBasis: "purchase-entitlement",
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
        authorizationBasis: "purchase-entitlement",
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

      const persistedRun = store.getRun(run.id);

      expect(persistedRun).toEqual(
        expect.objectContaining({
          id: run.id,
          reviewQueue: [
            expect.objectContaining({
              candidateId: "beatport-1001",
              id: firstReview.id,
              providerKey: "beatport",
              queueName: "beatport-review",
              runTrackId: tracks[0].id,
              status: "queued"
            }),
            expect.objectContaining({
              candidateId: "beatport-1002",
              id: secondReview.id,
              providerKey: "beatport",
              queueName: "beatport-review",
              runTrackId: tracks[1].id,
              status: "queued"
            })
          ],
          status: "awaiting-approval"
        })
      );
      expect(
        persistedRun?.tracks.map((track) => [track.sourcePosition, track.status])
      ).toEqual([
        [1, "awaiting-approval"],
        [2, "awaiting-approval"]
      ]);
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("updates review queue, track outcomes, and run lifecycle for approve reject and purchased actions", () => {
    const tempDatabase = createTempDatabasePath();

    try {
      const store = createRunStore({ databasePath: tempDatabase.databasePath });
      const run = store.createRun({
        playlistTitle: "Paid Fallback Review",
        playlistUrl: "https://soundcloud.com/sets/paid-fallback-review",
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

      const approvedReview = store.queueRunTrackReview({
        authorizationBasis: "purchase-entitlement",
        availableFormats: ["mp3", "wav"],
        candidateId: "beatport-2001",
        mixLabel: "Original Mix",
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/track-one/2001",
        queueName: "beatport-review",
        runTrackId: tracks[0].id,
        summary: "Queued after all automatic free-source providers missed."
      });
      const rejectedReview = store.queueRunTrackReview({
        authorizationBasis: "purchase-entitlement",
        availableFormats: ["mp3"],
        candidateId: "beatport-2002",
        mixLabel: null,
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/track-two/2002",
        queueName: "beatport-review",
        runTrackId: tracks[1].id,
        summary: "Queued after all automatic free-source providers missed."
      });

      const approvedResult = store.transitionRunTrackReviewStatus(
        approvedReview.id,
        "approved"
      );
      const rejectedResult = store.transitionRunTrackReviewStatus(
        rejectedReview.id,
        "rejected"
      );
      const purchasedResult = store.transitionRunTrackReviewStatus(
        approvedReview.id,
        "purchased"
      );
      const persistedRun = store.getRun(run.id);

      expect(approvedResult.status).toBe("approved");
      expect(rejectedResult.status).toBe("rejected");
      expect(purchasedResult.status).toBe("purchased");
      expect(persistedRun).toEqual(
        expect.objectContaining({
          id: run.id,
          status: "packaging"
        })
      );
      expect(
        persistedRun?.reviewQueue.map((review) => [review.candidateId, review.status])
      ).toEqual([
        ["beatport-2001", "purchased"],
        ["beatport-2002", "rejected"]
      ]);
      expect(
        persistedRun?.tracks.map(
          (track) =>
            [track.sourcePosition, track.status] satisfies [number, RunTrackStatus]
        )
      ).toEqual([
        [1, "acquired"],
        [2, "missed"]
      ]);
    } finally {
      tempDatabase.cleanup();
    }
  });
});
