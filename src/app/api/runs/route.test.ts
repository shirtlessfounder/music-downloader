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
  it("creates a queued run and exposes its pollable status", async () => {
    await withTempDatabase(async (databasePath) => {
      vi.resetModules();

      const [{ POST }, { GET }, runStoreModule] = await Promise.all([
        import("./route"),
        import("../runs/[runId]/route"),
        import("@/features/runs/run-store")
      ]);

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

      const createdRun = (await createResponse.json()) as { id: string };
      const pollResponse = await GET(
        new Request(`http://localhost/api/runs/${createdRun.id}`),
        {
          params: Promise.resolve({ runId: createdRun.id })
        }
      );
      const polledRun = (await pollResponse.json()) as {
        id: string;
        sourceType: string;
        status: string;
      };

      expect(polledRun).toEqual(
        expect.objectContaining({
          id: createdRun.id,
          sourceType: "spotify",
          status: "queued"
        })
      );
      expect(runStoreModule.getRunStore().listRuns()).toHaveLength(1);
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
