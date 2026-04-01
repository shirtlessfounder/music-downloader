/* @vitest-environment node */

afterEach(() => {
  vi.doUnmock("@/features/spotify-auth/spotify-auth-service");
  vi.doUnmock("@/features/spotify-auth/spotify-auth-store");
  vi.resetModules();
});

describe("/api/operator/spotify-auth/callback", () => {
  it("exchanges the auth code, persists the Spotify session, and redirects home", async () => {
    const exchangeCodeForTokens = vi.fn().mockResolvedValue({
      accessToken: "spotify-access-token",
      refreshToken: "spotify-refresh-token",
      scope: "playlist-read-private playlist-read-collaborative",
      tokenType: "Bearer"
    });
    const writeSession = vi.fn().mockResolvedValue(undefined);

    vi.doMock("@/features/spotify-auth/spotify-auth-service", () => ({
      createSpotifyAuthService: () => ({
        exchangeCodeForTokens
      })
    }));
    vi.doMock("@/features/spotify-auth/spotify-auth-store", () => ({
      createSpotifyAuthStore: () => ({
        writeSession
      })
    }));

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost:3000/api/operator/spotify-auth/callback?code=spotify-auth-code"
      )
    );

    expect(exchangeCodeForTokens).toHaveBeenCalledWith({
      code: "spotify-auth-code",
      redirectUri: "http://127.0.0.1:3000/api/operator/spotify-auth/callback"
    });
    expect(writeSession).toHaveBeenCalledWith({
      connectedAt: expect.any(String),
      provider: "spotify",
      refreshToken: "spotify-refresh-token",
      scope: "playlist-read-private playlist-read-collaborative",
      subjectHint: null
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/?spotify=connected"
    );
  });

  it("redirects home with an error marker when the callback exchange fails", async () => {
    const exchangeCodeForTokens = vi
      .fn()
      .mockRejectedValue(new Error("invalid_grant"));

    vi.doMock("@/features/spotify-auth/spotify-auth-service", () => ({
      createSpotifyAuthService: () => ({
        exchangeCodeForTokens
      })
    }));
    vi.doMock("@/features/spotify-auth/spotify-auth-store", () => ({
      createSpotifyAuthStore: () => ({
        writeSession: vi.fn()
      })
    }));

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost:3000/api/operator/spotify-auth/callback?code=spotify-auth-code"
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:3000/?spotify=error"
    );
  });
});
