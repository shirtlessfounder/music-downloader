import { NextResponse } from "next/server";

import { PlaylistIntakeError } from "@/features/ingestion/playlist-intake-error";
import { getRunStore } from "@/features/runs/run-store";
import { submitLiveRunFromPlaylistUrl } from "@/features/runs/live-run-orchestrator";

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

  try {
    return NextResponse.json(await submitLiveRunFromPlaylistUrl(playlistUrl), {
      status: 201
    });
  } catch (error) {
    if (error instanceof PlaylistIntakeError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    throw error;
  }
}
