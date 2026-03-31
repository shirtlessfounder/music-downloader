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
});
