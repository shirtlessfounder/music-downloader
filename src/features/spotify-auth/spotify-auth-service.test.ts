/* @vitest-environment node */

import {
  SPOTIFY_PLAYLIST_READ_SCOPES,
  createSpotifyAuthService
} from "./spotify-auth-service";

describe("createSpotifyAuthService", () => {
  it("builds the Spotify authorization URL with the required playlist scopes", () => {
    const service = createSpotifyAuthService({
      clientId: "spotify-client-id",
      clientSecret: "spotify-client-secret"
    });

    const authorizationUrl = service.buildAuthorizationUrl({
      redirectUri: "http://127.0.0.1:3000/api/operator/spotify-auth/callback"
    });

    expect(authorizationUrl.toString()).toBe(
      "https://accounts.spotify.com/authorize?client_id=spotify-client-id&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2Fapi%2Foperator%2Fspotify-auth%2Fcallback&scope=playlist-read-private+playlist-read-collaborative"
    );
    expect(SPOTIFY_PLAYLIST_READ_SCOPES).toEqual([
      "playlist-read-private",
      "playlist-read-collaborative"
    ]);
  });

  it("exchanges auth codes and refresh tokens through the documented Spotify token endpoint", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "spotify-access-token",
            refresh_token: "spotify-refresh-token",
            scope: "playlist-read-private playlist-read-collaborative",
            token_type: "Bearer"
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
            access_token: "refreshed-access-token",
            scope: "playlist-read-private playlist-read-collaborative",
            token_type: "Bearer"
          }),
          {
            headers: {
              "content-type": "application/json"
            },
            status: 200
          }
        )
      );
    const service = createSpotifyAuthService({
      clientId: "spotify-client-id",
      clientSecret: "spotify-client-secret",
      fetchImpl
    });

    const exchangedTokens = await service.exchangeCodeForTokens({
      code: "spotify-auth-code",
      redirectUri: "http://127.0.0.1:3000/api/operator/spotify-auth/callback"
    });

    expect(exchangedTokens).toEqual({
      accessToken: "spotify-access-token",
      refreshToken: "spotify-refresh-token",
      scope: "playlist-read-private playlist-read-collaborative",
      tokenType: "Bearer"
    });

    const refreshedTokens = await service.refreshAccessToken({
      refreshToken: "spotify-refresh-token"
    });

    expect(refreshedTokens).toEqual({
      accessToken: "refreshed-access-token",
      refreshToken: null,
      scope: "playlist-read-private playlist-read-collaborative",
      tokenType: "Bearer"
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const [exchangeUrl, exchangeRequest] = fetchImpl.mock.calls[0] ?? [];
    const exchangeHeaders = new Headers(exchangeRequest?.headers);
    const exchangeBody = new URLSearchParams(String(exchangeRequest?.body ?? ""));

    expect(String(exchangeUrl)).toBe("https://accounts.spotify.com/api/token");
    expect(exchangeRequest?.method).toBe("POST");
    expect(exchangeHeaders.get("authorization")).toBe(
      `Basic ${Buffer.from("spotify-client-id:spotify-client-secret").toString("base64")}`
    );
    expect(exchangeBody.get("grant_type")).toBe("authorization_code");
    expect(exchangeBody.get("code")).toBe("spotify-auth-code");
    expect(exchangeBody.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/api/operator/spotify-auth/callback"
    );

    const [refreshUrl, refreshRequest] = fetchImpl.mock.calls[1] ?? [];
    const refreshHeaders = new Headers(refreshRequest?.headers);
    const refreshBody = new URLSearchParams(String(refreshRequest?.body ?? ""));

    expect(String(refreshUrl)).toBe("https://accounts.spotify.com/api/token");
    expect(refreshRequest?.method).toBe("POST");
    expect(refreshHeaders.get("authorization")).toBe(
      `Basic ${Buffer.from("spotify-client-id:spotify-client-secret").toString("base64")}`
    );
    expect(refreshBody.get("grant_type")).toBe("refresh_token");
    expect(refreshBody.get("refresh_token")).toBe("spotify-refresh-token");
  });
});
