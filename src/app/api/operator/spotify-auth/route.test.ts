/* @vitest-environment node */

afterEach(() => {
  vi.doUnmock("@/features/spotify-auth/spotify-auth-store");
  vi.resetModules();
});

describe("/api/operator/spotify-auth", () => {
  it("returns missing status when no Spotify operator session is stored", async () => {
    const readSession = vi.fn().mockResolvedValue(null);

    vi.doMock("@/features/spotify-auth/spotify-auth-store", () => ({
      createSpotifyAuthStore: () => ({
        readSession
      })
    }));

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(readSession).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      spotifyAuth: {
        detail:
          "Spotify playlist intake requires a connected Spotify account before queueing Spotify playlists.",
        status: "missing",
        subjectHint: null
      }
    });
  });

  it("returns connected status when a Spotify operator session is stored", async () => {
    const readSession = vi.fn().mockResolvedValue({
      connectedAt: "2026-04-01T00:00:00.000Z",
      provider: "spotify",
      refreshToken: "spotify-refresh-token",
      scope: "playlist-read-private playlist-read-collaborative",
      subjectHint: "operator"
    });

    vi.doMock("@/features/spotify-auth/spotify-auth-store", () => ({
      createSpotifyAuthStore: () => ({
        readSession
      })
    }));

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      spotifyAuth: {
        detail: "Spotify operator account connected for playlist intake.",
        status: "connected",
        subjectHint: "operator"
      }
    });
  });
});
