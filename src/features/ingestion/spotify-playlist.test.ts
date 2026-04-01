/* @vitest-environment node */

import {
  fetchSpotifyPlaylistSnapshot,
  mapSpotifyPlaylistSnapshot,
  parseSpotifyPlaylistUrl
} from "./spotify-playlist";

describe("parseSpotifyPlaylistUrl", () => {
  it("normalizes supported Spotify playlist URLs", () => {
    const playlistUrl = parseSpotifyPlaylistUrl(
      "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n?si=abc123#queue"
    );

    expect(playlistUrl.toString()).toBe(
      "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n"
    );
  });

  it("rejects non-playlist Spotify URLs with an explicit error", () => {
    expect(() =>
      parseSpotifyPlaylistUrl("https://open.spotify.com/album/37i9dQZF1DX4dyzvuaRJ0n")
    ).toThrowError(
      "Spotify URL must point to a playlist (for example /playlist/<playlist-id>)."
    );
  });
});

describe("mapSpotifyPlaylistSnapshot", () => {
  it("maps Spotify playlist metadata and track items into run-track inputs", () => {
    const snapshot = mapSpotifyPlaylistSnapshot(
      {
        external_urls: {
          spotify: "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n"
        },
        name: "Peak-Time Cuts"
      },
      [
        {
          items: [
            {
              track: {
                artists: [{ name: "Anyma" }, { name: "Chris Avantgarde" }],
                duration_ms: 391578,
                external_urls: {
                  spotify: "https://open.spotify.com/track/0abc123"
                },
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
        }
      ],
      "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n"
    );

    expect(snapshot).toEqual({
      playlistTitle: "Peak-Time Cuts",
      playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n",
      tracks: [
        {
          artist: "Anyma",
          sourcePosition: 1,
          sourceTrackId: "0abc123",
          title: "Consciousness",
          version: "Extended Mix"
        },
        {
          artist: "Kx5",
          sourcePosition: 2,
          sourceTrackId: "0def456",
          title: "Escape",
          version: null
        }
      ]
    });
  });

  it("rejects playlist items that do not resolve to Spotify tracks", () => {
    expect(() =>
      mapSpotifyPlaylistSnapshot(
        {
          name: "Broken Playlist"
        },
        [
          {
            items: [
              {
                track: {
                  id: "episode-1",
                  name: "DJ interview",
                  type: "episode"
                }
              }
            ],
            next: null
          }
        ],
        "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n"
      )
    ).toThrowError("Spotify playlist item 1 is not a playable track.");
  });
});

describe("fetchSpotifyPlaylistSnapshot", () => {
  it("refreshes a persisted Spotify session and paginates playlist items", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            external_urls: {
              spotify: "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n"
            },
            name: "Peak-Time Cuts"
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
                  artists: [{ name: "Anyma" }],
                  duration_ms: 391578,
                  id: "0abc123",
                  name: "Consciousness (Extended Mix)",
                  type: "track"
                }
              }
            ],
            next: "https://api.spotify.com/v1/playlists/37i9dQZF1DX4dyzvuaRJ0n/items?offset=1&limit=50&market=US"
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
                  artists: [{ name: "Cassian" }],
                  duration_ms: 303000,
                  id: "0def456",
                  name: "Aran",
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
    const authStore = {
      clearSession: vi.fn(),
      readSession: vi.fn().mockResolvedValue({
        connectedAt: "2026-04-01T00:00:00.000Z",
        provider: "spotify" as const,
        refreshToken: "spotify-refresh-token",
        scope: "playlist-read-private playlist-read-collaborative",
        subjectHint: null
      }),
      writeSession: vi.fn()
    };
    const authService = {
      refreshAccessToken: vi.fn().mockResolvedValue({
        accessToken: "spotify-access-token",
        refreshToken: null,
        scope: "playlist-read-private playlist-read-collaborative",
        tokenType: "Bearer"
      })
    };

    const snapshot = await fetchSpotifyPlaylistSnapshot(
      "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n",
      {
        authService,
        authStore,
        fetchImpl,
        market: "US"
      }
    );

    expect(snapshot).toEqual({
      playlistTitle: "Peak-Time Cuts",
      playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n",
      tracks: [
        {
          artist: "Anyma",
          sourcePosition: 1,
          sourceTrackId: "0abc123",
          title: "Consciousness",
          version: "Extended Mix"
        },
        {
          artist: "Cassian",
          sourcePosition: 2,
          sourceTrackId: "0def456",
          title: "Aran",
          version: null
        }
      ]
    });
    expect(authStore.readSession).toHaveBeenCalledTimes(1);
    expect(authService.refreshAccessToken).toHaveBeenCalledWith({
      refreshToken: "spotify-refresh-token"
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const [metadataUrl, metadataRequest] = fetchImpl.mock.calls[0] ?? [];
    const [itemsUrl, itemsRequest] = fetchImpl.mock.calls[1] ?? [];

    expect(String(metadataUrl)).toBe(
      "https://api.spotify.com/v1/playlists/37i9dQZF1DX4dyzvuaRJ0n"
    );
    expect(new Headers(metadataRequest?.headers).get("authorization")).toBe(
      "Bearer spotify-access-token"
    );
    expect(String(itemsUrl)).toContain(
      "/v1/playlists/37i9dQZF1DX4dyzvuaRJ0n/items"
    );
    expect(String(itemsUrl)).toContain("limit=50");
    expect(String(itemsUrl)).toContain("market=US");
    expect(new Headers(itemsRequest?.headers).get("authorization")).toBe(
      "Bearer spotify-access-token"
    );
  });

  it("returns an explicit setup error when no Spotify account is connected", async () => {
    await expect(
      fetchSpotifyPlaylistSnapshot(
        "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n",
        {
          authService: {
            refreshAccessToken: vi.fn()
          },
          authStore: {
            clearSession: vi.fn(),
            readSession: vi.fn().mockResolvedValue(null),
            writeSession: vi.fn()
          }
        }
      )
    ).rejects.toThrowError(
      "Spotify playlist intake requires a connected Spotify account. Use Connect Spotify first."
    );
  });
});
