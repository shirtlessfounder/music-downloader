const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

export const SPOTIFY_PLAYLIST_READ_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative"
] as const;

type FetchLike = typeof fetch;

type SpotifyTokenPayload = {
  access_token?: string;
  error?: string | { message?: string };
  error_description?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export type SpotifyAccessTokenResult = {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  tokenType: string | null;
};

export class SpotifyAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpotifyAuthConfigurationError";
  }
}

export function createSpotifyAuthService(
  options: {
    clientId?: string;
    clientSecret?: string;
    fetchImpl?: FetchLike;
  } = {}
) {
  const clientId = options.clientId ?? process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = options.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET;
  const fetchImpl = options.fetchImpl ?? fetch;

  function requireClientId() {
    if (!clientId) {
      throw new SpotifyAuthConfigurationError(
        "Spotify auth requires SPOTIFY_CLIENT_ID."
      );
    }

    return clientId;
  }

  function requireClientSecret() {
    if (!clientSecret) {
      throw new SpotifyAuthConfigurationError(
        "Spotify auth requires SPOTIFY_CLIENT_SECRET."
      );
    }

    return clientSecret;
  }

  return {
    buildAuthorizationUrl(input: { redirectUri: string }) {
      const authorizationUrl = new URL(SPOTIFY_AUTHORIZE_URL);

      authorizationUrl.searchParams.set("client_id", requireClientId());
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("redirect_uri", input.redirectUri);
      authorizationUrl.searchParams.set(
        "scope",
        SPOTIFY_PLAYLIST_READ_SCOPES.join(" ")
      );

      return authorizationUrl;
    },

    async exchangeCodeForTokens(input: { code: string; redirectUri: string }) {
      return exchangeTokens({
        body: new URLSearchParams({
          code: input.code,
          grant_type: "authorization_code",
          redirect_uri: input.redirectUri
        }),
        clientId: requireClientId(),
        clientSecret: requireClientSecret(),
        fetchImpl
      });
    },

    async refreshAccessToken(input: { refreshToken: string }) {
      return exchangeTokens({
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: input.refreshToken
        }),
        clientId: requireClientId(),
        clientSecret: requireClientSecret(),
        fetchImpl
      });
    }
  };
}

async function exchangeTokens(input: {
  body: URLSearchParams;
  clientId: string;
  clientSecret: string;
  fetchImpl: FetchLike;
}): Promise<SpotifyAccessTokenResult> {
  const response = await input.fetchImpl(SPOTIFY_TOKEN_URL, {
    body: input.body.toString(),
    headers: {
      Accept: "application/json; charset=utf-8",
      Authorization: `Basic ${Buffer.from(
        `${input.clientId}:${input.clientSecret}`
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(
      (await readSpotifyErrorMessage(response)) ?? "Spotify authentication failed."
    );
  }

  const payload = (await response.json()) as SpotifyTokenPayload;

  if (!payload.access_token) {
    throw new Error(
      "Spotify authentication response did not include an access token."
    );
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    scope: cleanValue(payload.scope),
    tokenType: cleanValue(payload.token_type)
  };
}

function cleanValue(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : null;
}

async function readSpotifyErrorMessage(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string | { message?: string };
          error_description?: string;
          message?: string;
        }
      | null;

    if (!payload) {
      return null;
    }

    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }

    if (
      payload.error &&
      typeof payload.error === "object" &&
      payload.error.message?.trim()
    ) {
      return payload.error.message;
    }

    if (payload.error_description?.trim()) {
      return payload.error_description;
    }

    if (payload.message?.trim()) {
      return payload.message;
    }
  }

  const responseText = await response.text().catch(() => "");
  return cleanValue(responseText);
}
