import { NextResponse } from "next/server";

import { createSpotifyAuthService } from "@/features/spotify-auth/spotify-auth-service";
import { createSpotifyAuthStore } from "@/features/spotify-auth/spotify-auth-store";

export async function GET(request: Request) {
  const loopbackOrigin = resolveLoopbackOrigin(request.url);
  const callbackUrl = new URL(request.url);
  const code = callbackUrl.searchParams.get("code")?.trim();
  const redirectUri = new URL(
    "/api/operator/spotify-auth/callback",
    loopbackOrigin
  ).toString();
  const homeUrl = new URL("/", loopbackOrigin);

  if (!code) {
    homeUrl.searchParams.set("spotify", "error");
    return NextResponse.redirect(homeUrl);
  }

  try {
    const tokens = await createSpotifyAuthService().exchangeCodeForTokens({
      code,
      redirectUri
    });

    if (!tokens.refreshToken) {
      throw new Error("Spotify authentication response did not include a refresh token.");
    }

    await createSpotifyAuthStore().writeSession({
      connectedAt: new Date().toISOString(),
      provider: "spotify",
      refreshToken: tokens.refreshToken,
      scope: tokens.scope,
      subjectHint: null
    });

    homeUrl.searchParams.set("spotify", "connected");
    return NextResponse.redirect(homeUrl);
  } catch {
    homeUrl.searchParams.set("spotify", "error");
    return NextResponse.redirect(homeUrl);
  }
}

function resolveLoopbackOrigin(requestUrl: string) {
  const parsedUrl = new URL(requestUrl);

  return `${parsedUrl.protocol}//127.0.0.1${parsedUrl.port ? `:${parsedUrl.port}` : ""}`;
}
