import { NextResponse } from "next/server";

import { maybeCreateFixtureRunFromPlaylistUrl } from "@/features/e2e/e2e-fixtures";
import { createRunFromPlaylistUrl } from "@/features/ingestion/playlist-intake";
import { PlaylistIntakeError } from "@/features/ingestion/playlist-intake-error";
import { getRunStore } from "@/features/runs/run-store";

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
    const fixtureRun = await maybeCreateFixtureRunFromPlaylistUrl(playlistUrl);

    if (fixtureRun) {
      return NextResponse.json(fixtureRun, {
        status: 201
      });
    }

    return NextResponse.json(await createRunFromPlaylistUrl(playlistUrl), {
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
