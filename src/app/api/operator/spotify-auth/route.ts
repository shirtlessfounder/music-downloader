import { NextResponse } from "next/server";

import { createSpotifyAuthStore } from "@/features/spotify-auth/spotify-auth-store";

export async function GET() {
  const session = await createSpotifyAuthStore().readSession();

  return NextResponse.json({
    spotifyAuth: session
      ? {
          detail: "Spotify operator account connected for playlist intake.",
          status: "connected" as const,
          subjectHint: session.subjectHint
        }
      : {
          detail:
            "Spotify playlist intake requires a connected Spotify account before queueing Spotify playlists.",
          status: "missing" as const,
          subjectHint: null
        }
  });
}
