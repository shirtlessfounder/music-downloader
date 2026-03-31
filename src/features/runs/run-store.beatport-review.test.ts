/* @vitest-environment node */

import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { parseRunTrackArtifactSourceNote } from "@/features/artifacts/run-artifacts";

import { createRunStore, type RunTrackStatus } from "./run-store";

function createTempDatabasePath() {
  const tempDirectory = mkdtempSync(
    path.join(tmpdir(), "music-downloader-run-store-beatport-")
  );

  return {
    databasePath: path.join(tempDirectory, "music-downloader.sqlite"),
    cleanup() {
      rmSync(tempDirectory, { force: true, recursive: true });
    }
  };
}

describe("createRunStore Beatport review queue", () => {
  it("groups paid fallback candidates into one persisted per-run review queue", () => {
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
        persistedRun?.tracks.map(
          (track) =>
            [track.sourcePosition, track.status] satisfies [number, RunTrackStatus]
        )
      ).toEqual([
        [1, "awaiting-approval"],
        [2, "awaiting-approval"]
      ]);
    } finally {
      tempDatabase.cleanup();
    }
  });

  it("keeps purchased reviews awaiting import and persists rejected reviews as misses", () => {
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
      const attempts = store.listRunTrackAttempts(run.id);

      expect(approvedResult.status).toBe("approved");
      expect(rejectedResult.status).toBe("rejected");
      expect(purchasedResult.status).toBe("purchased");
      expect(persistedRun).toEqual(
        expect.objectContaining({
          id: run.id,
          status: "awaiting-approval"
        })
      );
      expect(
        persistedRun?.reviewQueue.map((review) => [review.candidateId, review.status])
      ).toEqual([
        ["beatport-2001", "purchased"],
        ["beatport-2002", "rejected"]
      ]);
      expect(attempts).toEqual([
        expect.objectContaining({
          outcome: "missed",
          providerKey: "beatport",
          runTrackId: tracks[1].id
        })
      ]);
      expect(parseRunTrackArtifactSourceNote(attempts[0]?.note ?? null)).toEqual(
        expect.objectContaining({
          miss: expect.objectContaining({
            detail: "Rejected during Beatport paid review.",
            providerId: "beatport",
            providerName: "Beatport",
            reason: "paid-review-rejected"
          }),
          outcome: "missed"
        })
      );
      expect(
        persistedRun?.tracks.map(
          (track) =>
            [track.sourcePosition, track.status] satisfies [number, RunTrackStatus]
        )
      ).toEqual([
        [1, "awaiting-approval"],
        [2, "missed"]
      ]);
    } finally {
      tempDatabase.cleanup();
    }
  });
});
