import { NextResponse } from "next/server";

import { getRunStore, type PlaylistSource } from "@/features/runs/run-store";

function detectPlaylistSource(playlistUrl: string): PlaylistSource | null {
  try {
    const parsedUrl = new URL(playlistUrl);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (hostname.includes("spotify.com")) {
      return "spotify";
    }

    if (hostname.includes("soundcloud.com")) {
      return "soundcloud";
    }

    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  return NextResponse.json(getRunStore().listRuns());
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | { playlistUrl?: string }
    | null;
  const playlistUrl = payload?.playlistUrl?.trim();

  if (!playlistUrl) {
    return NextResponse.json(
      { error: "playlistUrl is required" },
      { status: 400 }
    );
  }

  const sourceType = detectPlaylistSource(playlistUrl);

  if (!sourceType) {
    return NextResponse.json(
      { error: "Only Spotify and SoundCloud playlist URLs are supported." },
      { status: 400 }
    );
  }

  const run = getRunStore().createRun({ playlistUrl, sourceType });

  return NextResponse.json(run, { status: 201 });
}
