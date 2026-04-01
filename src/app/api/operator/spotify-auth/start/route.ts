import { NextResponse } from "next/server";

import { createSpotifyAuthService } from "@/features/spotify-auth/spotify-auth-service";

export async function GET(request: Request) {
  const loopbackOrigin = resolveLoopbackOrigin(request.url);
  const redirectUri = new URL(
    "/api/operator/spotify-auth/callback",
    loopbackOrigin
  ).toString();
  const authorizationUrl = createSpotifyAuthService().buildAuthorizationUrl({
    redirectUri
  });

  return NextResponse.redirect(authorizationUrl);
}

function resolveLoopbackOrigin(requestUrl: string) {
  const parsedUrl = new URL(requestUrl);

  return `${parsedUrl.protocol}//127.0.0.1${parsedUrl.port ? `:${parsedUrl.port}` : ""}`;
}
