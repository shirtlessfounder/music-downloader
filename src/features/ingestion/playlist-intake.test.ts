/* @vitest-environment node */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

async function withTempDatabase(
  callback: (databasePath: string) => Promise<void> | void
) {
  const tempDirectory = mkdtempSync(
    path.join(tmpdir(), "music-downloader-playlist-intake-")
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

describe("createRunFromPlaylistUrl", () => {
  it("ingests a Spotify playlist into persisted queued run data", async () => {
    await withTempDatabase(async (databasePath) => {
      vi.resetModules();

      const originalClientId = process.env.SPOTIFY_CLIENT_ID;
      const originalClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
      const originalMarket = process.env.SPOTIFY_MARKET;

      process.env.SPOTIFY_CLIENT_ID = "spotify-client-id";
      process.env.SPOTIFY_CLIENT_SECRET = "spotify-client-secret";
      process.env.SPOTIFY_MARKET = "US";

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "spotify-access-token" }), {
            headers: {
              "content-type": "application/json"
            },
            status: 200
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              external_urls: {
                spotify:
                  "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9"
              },
              name: "Warehouse Starters"
            }),
            {
              headers: {
                "content-type": "application/json"
              },
              status: 200
            }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              items: [
                {
                  track: {
                    artists: [{ name: "Anyma" }, { name: "Chris Avantgarde" }],
                    duration_ms: 391578,
                    id: "0abc123",
                    name: "Consciousness (Extended Mix)",
                    type: "track"
                  }
                },
                {
                  track: {
                    artists: [{ name: "Kx5" }],
                    duration_ms: 265000,
                    id: "0def456",
                    name: "Escape",
                    type: "track"
                  }
                }
              ],
              next: null
            }),
            {
              headers: {
                "content-type": "application/json"
              },
              status: 200
            }
          )
        );

      const [{ createRunFromPlaylistUrl }, runStoreModule] = await Promise.all([
        import("./playlist-intake"),
        import("@/features/runs/run-store")
      ]);

      try {
        const createdRun = await createRunFromPlaylistUrl(
          "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9"
        );

        expect(existsSync(databasePath)).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(3);
        expect(createdRun).toEqual(
          expect.objectContaining({
            playlistTitle: "Warehouse Starters",
            sourceType: "spotify",
            status: "queued",
            trackCount: 2
          })
        );
        expect(createdRun.tracks).toEqual([
          expect.objectContaining({
            artist: "Anyma",
            title: "Consciousness",
            version: "Extended Mix"
          }),
          expect.objectContaining({
            artist: "Kx5",
            title: "Escape",
            version: null
          })
        ]);
        expect(runStoreModule.getRunStore().listRuns()).toHaveLength(1);
      } finally {
        fetchSpy.mockRestore();

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

  it("ingests a SoundCloud playlist into persisted queued run data", async () => {
    await withTempDatabase(async () => {
      vi.resetModules();

      const originalClientId = process.env.SOUNDCLOUD_CLIENT_ID;
      const originalClientSecret = process.env.SOUNDCLOUD_CLIENT_SECRET;

      process.env.SOUNDCLOUD_CLIENT_ID = "soundcloud-client-id";
      process.env.SOUNDCLOUD_CLIENT_SECRET = "soundcloud-client-secret";

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "soundcloud-access-token" }), {
            headers: {
              "content-type": "application/json"
            },
            status: 200
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              kind: "playlist",
              permalink_url:
                "https://soundcloud.com/dj-nova/sets/warehouse-finds",
              title: "Warehouse Finds",
              tracks: [
                {
                  id: 111,
                  metadata_artist: "DJ Sealer",
                  title: "DJ Sealer - Warehouse Tool (Extended Mix) [Free DL]",
                  urn: "soundcloud:tracks:111",
                  user: {
                    username: "dj-sealer"
                  }
                },
                {
                  id: 222,
                  title: "Selector Two - Loft Shaker",
                  user: {
                    username: "selector-two"
                  }
                }
              ]
            }),
            {
              headers: {
                "content-type": "application/json"
              },
              status: 200
            }
          )
        );

      try {
        const [{ createRunFromPlaylistUrl }, runStoreModule] = await Promise.all([
          import("./playlist-intake"),
          import("@/features/runs/run-store")
        ]);

        const createdRun = await createRunFromPlaylistUrl(
          "https://soundcloud.com/dj-nova/sets/warehouse-finds"
        );

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(createdRun).toEqual(
          expect.objectContaining({
            playlistTitle: "Warehouse Finds",
            sourceType: "soundcloud",
            status: "queued",
            trackCount: 2
          })
        );
        expect(createdRun.tracks).toEqual([
          expect.objectContaining({
            artist: "DJ Sealer",
            title: "Warehouse Tool",
            version: "Extended Mix"
          }),
          expect.objectContaining({
            artist: "Selector Two",
            title: "Loft Shaker",
            version: null
          })
        ]);
        expect(runStoreModule.getRunStore().getRun(createdRun.id)?.tracks).toEqual([
          expect.objectContaining({
            artist: "DJ Sealer",
            title: "Warehouse Tool",
            version: "Extended Mix"
          }),
          expect.objectContaining({
            artist: "Selector Two",
            title: "Loft Shaker",
            version: null
          })
        ]);
      } finally {
        fetchSpy.mockRestore();

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
});
