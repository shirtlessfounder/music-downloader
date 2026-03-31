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

describe("/api/runs", () => {
  it("ingests a Spotify playlist into persisted run data and exposes its pollable status", async () => {
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

      const [{ POST }, { GET }, runStoreModule] = await Promise.all([
        import("./route"),
        import("../runs/[runId]/route"),
        import("@/features/runs/run-store")
      ]);

      try {
        const createResponse = await POST(
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

        expect(createResponse.status).toBe(201);
        expect(existsSync(databasePath)).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(3);

        const createdRun = (await createResponse.json()) as {
          id: string;
          playlistTitle: string | null;
          sourceType: string;
          status: string;
          trackCount: number;
          tracks: Array<{
            artist: string;
            title: string;
            version: string | null;
          }>;
        };
        const pollResponse = await GET(
          new Request(`http://localhost/api/runs/${createdRun.id}`),
          {
            params: Promise.resolve({ runId: createdRun.id })
          }
        );
        const polledRun = (await pollResponse.json()) as {
          id: string;
          playlistTitle: string | null;
          sourceType: string;
          status: string;
          trackCount: number;
          tracks: Array<{
            artist: string;
            title: string;
            version: string | null;
          }>;
        };

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
        expect(polledRun).toEqual(
          expect.objectContaining({
            id: createdRun.id,
            playlistTitle: "Warehouse Starters",
            sourceType: "spotify",
            status: "queued",
            trackCount: 2
          })
        );
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

  it("ingests a SoundCloud playlist into persisted run data", async () => {
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
        const [{ POST }, runStoreModule] = await Promise.all([
          import("./route"),
          import("@/features/runs/run-store")
        ]);

        const createResponse = await POST(
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

        expect(createResponse.status).toBe(201);
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        const [tokenUrl, tokenRequest] = fetchSpy.mock.calls[0] ?? [];
        const tokenHeaders = tokenRequest?.headers as Record<string, string>;
        const tokenBody = new URLSearchParams(String(tokenRequest?.body ?? ""));

        expect(String(tokenUrl)).toBe("https://api.soundcloud.com/oauth2/token");
        expect(tokenRequest?.method).toBe("POST");
        expect(tokenHeaders).toEqual(
          expect.objectContaining({
            Accept: "application/json; charset=utf-8",
            "Content-Type": "application/x-www-form-urlencoded"
          })
        );
        expect(tokenHeaders.Authorization).toBeUndefined();
        expect(tokenBody.get("client_id")).toBe("soundcloud-client-id");
        expect(tokenBody.get("client_secret")).toBe("soundcloud-client-secret");
        expect(tokenBody.get("grant_type")).toBe("client_credentials");

        const createdRun = (await createResponse.json()) as {
          id: string;
          playlistTitle: string | null;
          sourceType: string;
          trackCount: number;
          tracks: Array<{
            artist: string;
            title: string;
            version: string | null;
          }>;
        };

        expect(createdRun).toEqual(
          expect.objectContaining({
            playlistTitle: "Warehouse Finds",
            sourceType: "soundcloud",
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
});
