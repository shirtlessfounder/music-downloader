/* @vitest-environment node */

afterEach(() => {
  vi.doUnmock("@/features/spotify-auth/spotify-auth-service");
  vi.resetModules();
});

describe("/api/operator/spotify-auth/start", () => {
  it("redirects the operator into Spotify auth using a 127.0.0.1 callback URI", async () => {
    const buildAuthorizationUrl = vi
      .fn()
      .mockReturnValue(
        new URL(
          "https://accounts.spotify.com/authorize?client_id=spotify-client-id&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Foperator%2Fspotify-auth%2Fcallback&scope=playlist-read-private+playlist-read-collaborative"
        )
      );

    vi.doMock("@/features/spotify-auth/spotify-auth-service", () => ({
      createSpotifyAuthService: () => ({
        buildAuthorizationUrl
      })
    }));

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost:3000/api/operator/spotify-auth/start")
    );

    expect(buildAuthorizationUrl).toHaveBeenCalledWith({
      redirectUri: "http://127.0.0.1:3000/api/operator/spotify-auth/callback"
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://accounts.spotify.com/authorize?client_id=spotify-client-id&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Foperator%2Fspotify-auth%2Fcallback&scope=playlist-read-private+playlist-read-collaborative"
    );
  });
});
