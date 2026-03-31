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
  it("uses the documented Spotify client-credentials contract and paginates playlist items", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
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

    const snapshot = await fetchSpotifyPlaylistSnapshot(
      "https://open.spotify.com/playlist/37i9dQZF1DX4dyzvuaRJ0n",
      {
        clientId: "spotify-client-id",
        clientSecret: "spotify-client-secret",
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
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    const [tokenUrl, tokenRequest] = fetchImpl.mock.calls[0] ?? [];
    const tokenHeaders = new Headers(tokenRequest?.headers);
    const tokenBody = new URLSearchParams(String(tokenRequest?.body ?? ""));

    expect(String(tokenUrl)).toBe("https://accounts.spotify.com/api/token");
    expect(tokenRequest?.method).toBe("POST");
    expect(tokenHeaders.get("accept")).toBe("application/json; charset=utf-8");
    expect(tokenHeaders.get("content-type")).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(tokenHeaders.get("authorization")).toBe(
      `Basic ${Buffer.from("spotify-client-id:spotify-client-secret").toString("base64")}`
    );
    expect(tokenBody.get("grant_type")).toBe("client_credentials");

    const [metadataUrl, metadataRequest] = fetchImpl.mock.calls[1] ?? [];
    const [itemsUrl, itemsRequest] = fetchImpl.mock.calls[2] ?? [];

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
});
