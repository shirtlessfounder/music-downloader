/* @vitest-environment node */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

async function withTempDatabase(
  callback: (databasePath: string) => Promise<void> | void
) {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), "music-downloader-api-"));
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

afterEach(() => {
  vi.doUnmock("@/features/e2e/e2e-fixtures");
  vi.doUnmock("@/features/runs/live-run-orchestrator");
  vi.doUnmock("@/features/runs/run-worker");
  vi.resetModules();
});

describe("/api/runs", () => {
  it("persists queued runs and schedules shared background execution without awaiting it", async () => {
    await withTempDatabase(async (databasePath) => {
      vi.resetModules();

      const playlistUrl = "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9";
      const scheduleRun = vi.fn().mockImplementation(
        () => new Promise<void>(() => undefined)
      );
      let createdRunId: string | null = null;

      vi.doMock("@/features/e2e/e2e-fixtures", () => {
        throw new Error("route should not import e2e fixture submission bypasses");
      });
      vi.doMock("@/features/runs/live-run-orchestrator", async () => {
        const runStoreModule = await import("@/features/runs/run-store");

        return {
          queueLiveRunFromPlaylistUrl: vi.fn(async (requestedPlaylistUrl: string) => {
            const createdRun = runStoreModule.getRunStore().createRun({
              playlistTitle: "Warehouse Starters",
              playlistUrl: requestedPlaylistUrl,
              sourceType: "spotify"
            });

            createdRunId = createdRun.id;

            return createdRun;
          })
        };
      });
      vi.doMock("@/features/runs/run-worker", () => ({
        getSharedRunWorker: () => ({
          scheduleRun
        })
      }));

      const { POST } = await import("./route");

      const createResponse = await POST(
        new Request("http://localhost/api/runs", {
          body: JSON.stringify({ playlistUrl }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        })
      );

      expect(createResponse.status).toBe(201);
      expect(existsSync(databasePath)).toBe(true);
      expect(createdRunId).not.toBeNull();
      expect(scheduleRun).toHaveBeenCalledWith(createdRunId);

      await expect(createResponse.json()).resolves.toEqual(
        expect.objectContaining({
          id: createdRunId,
          playlistTitle: "Warehouse Starters",
          playlistUrl,
          sourceType: "spotify",
          status: "queued"
        })
      );

      const { getRunStore } = await import("@/features/runs/run-store");

      expect(getRunStore().getRun(createdRunId ?? "")).toEqual(
        expect.objectContaining({
          id: createdRunId,
          status: "queued"
        })
      );
    });
  });

  it("returns explicit validation errors for unsupported Spotify URLs", async () => {
    await withTempDatabase(async () => {
      vi.resetModules();

      const { POST } = await import("./route");

      const response = await POST(
        new Request("http://localhost/api/runs", {
          body: JSON.stringify({
            playlistUrl: "https://open.spotify.com/album/37i9dQZF1DWVRSukIED0e9"
          }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error:
          "Spotify URL must point to a playlist (for example /playlist/<playlist-id>)."
      });
    });
  });

  it("returns explicit setup errors when Spotify credentials are missing", async () => {
    await withTempDatabase(async () => {
      vi.resetModules();

      const originalClientId = process.env.SPOTIFY_CLIENT_ID;
      const originalClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
      const originalMarket = process.env.SPOTIFY_MARKET;

      delete process.env.SPOTIFY_CLIENT_ID;
      delete process.env.SPOTIFY_CLIENT_SECRET;
      delete process.env.SPOTIFY_MARKET;

      try {
        const { POST } = await import("./route");

        const response = await POST(
          new Request("http://localhost/api/runs", {
            body: JSON.stringify({
              playlistUrl:
                "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9"
            }),
            headers: {
              "content-type": "application/json"
            },
            method: "POST"
          })
        );

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
          error: "Spotify ingestion requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET."
        });
      } finally {
        if (originalClientId === undefined) {
          delete process.env.SPOTIFY_CLIENT_ID;
        } else {
          process.env.SPOTIFY_CLIENT_ID = originalClientId;
        }

        if (originalClientSecret === undefined) {
          delete process.env.SPOTIFY_CLIENT_SECRET;
        } else {
          process.env.SPOTIFY_CLIENT_SECRET = originalClientSecret;
        }

        if (originalMarket === undefined) {
          delete process.env.SPOTIFY_MARKET;
        } else {
          process.env.SPOTIFY_MARKET = originalMarket;
        }
      }
    });
  });

  it("returns explicit validation errors for unsupported SoundCloud URLs", async () => {
    await withTempDatabase(async () => {
      vi.resetModules();

      const { POST } = await import("./route");

      const response = await POST(
        new Request("http://localhost/api/runs", {
          body: JSON.stringify({
            playlistUrl: "https://soundcloud.com/dj-nova/warehouse-tool"
          }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error:
          "SoundCloud URL must point to a playlist set (for example /artist/sets/playlist-name)."
      });
    });
  });

  it("returns explicit setup errors when SoundCloud credentials are missing", async () => {
    await withTempDatabase(async () => {
      vi.resetModules();

      const originalClientId = process.env.SOUNDCLOUD_CLIENT_ID;
      const originalClientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;

      delete process.env.SOUNDCLOUD_CLIENT_ID;
      delete process.env.SOUNDCLOUD_CLIENT_SECRET;

      try {
        const { POST } = await import("./route");

        const response = await POST(
          new Request("http://localhost/api/runs", {
            body: JSON.stringify({
              playlistUrl: "https://soundcloud.com/dj-nova/sets/warehouse-finds"
            }),
            headers: {
              "content-type": "application/json"
            },
            method: "POST"
          })
        );

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
          error:
            "SoundCloud ingestion requires SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET."
        });
      } finally {
        if (originalClientId === undefined) {
          delete process.env.SOUNDCLOUD_CLIENT_ID;
        } else {
          process.env.SOUNDCLOUD_CLIENT_ID = originalClientId;
        }

        if (originalClientSecret === undefined) {
          delete process.env.SOUNDCLOUD_CLIENT_SECRET;
        } else {
          process.env.SOUNDCLOUD_CLIENT_SECRET = originalClientSecret;
        }
      }
    });
  });

  it("delegates non-fixture submissions to queued intake and the shared worker", async () => {
    await withTempDatabase(async () => {
      vi.resetModules();

      const playlistUrl = "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9";
      const createdRun = {
        artifactCount: 0,
        artifacts: [],
        createdAt: "2026-03-31T21:00:00.000Z",
        id: "run-live-queue",
        playlistTitle: "Warehouse Starters",
        playlistUrl,
        resumeAfterStatus: null,
        reviewQueue: [],
        sourceType: "spotify",
        status: "queued",
        trackCount: 2,
        tracks: [],
        updatedAt: "2026-03-31T21:00:00.000Z"
      };
      const queueLiveRunFromPlaylistUrl = vi.fn().mockResolvedValue(createdRun);
      const scheduleRun = vi.fn().mockResolvedValue(undefined);

      vi.doMock("@/features/runs/live-run-orchestrator", () => ({
        queueLiveRunFromPlaylistUrl
      }));
      vi.doMock("@/features/runs/run-worker", () => ({
        getSharedRunWorker: () => ({
          scheduleRun
        })
      }));

      const { POST } = await import("./route");

      const response = await POST(
        new Request("http://localhost/api/runs", {
          body: JSON.stringify({ playlistUrl }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        })
      );

      expect(response.status).toBe(201);
      expect(queueLiveRunFromPlaylistUrl).toHaveBeenCalledWith(playlistUrl);
      expect(scheduleRun).toHaveBeenCalledWith(createdRun.id);
      await expect(response.json()).resolves.toEqual(createdRun);
    });
  });
});
