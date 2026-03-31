import { getRunStore, type RunDetail, type RunStore } from "@/features/runs/run-store";

import { PlaylistIntakeError } from "./playlist-intake-error";
import { fetchSoundCloudPlaylistSnapshot } from "./soundcloud-playlist";

type PlaylistIntakeDependencies = {
  fetchSoundCloudPlaylistSnapshot?: typeof fetchSoundCloudPlaylistSnapshot;
  runStore?: Pick<RunStore, "createRun" | "getRun" | "replaceRunTracks">;
};

function detectPlaylistSource(playlistUrl: string) {
  try {
    const hostname = new URL(playlistUrl).hostname.toLowerCase();

    if (hostname.includes("spotify.com")) {
      return "spotify" as const;
    }

    if (hostname.includes("soundcloud.com")) {
      return "soundcloud" as const;
    }

    return null;
  } catch {
    return null;
  }
}

export async function createRunFromPlaylistUrl(
  playlistUrl: string,
  dependencies: PlaylistIntakeDependencies = {}
): Promise<RunDetail> {
  const sourceType = detectPlaylistSource(playlistUrl);

  if (!sourceType) {
    throw new PlaylistIntakeError(
      "Only Spotify and SoundCloud playlist URLs are supported.",
      400
    );
  }

  const runStore = dependencies.runStore ?? getRunStore();

  if (sourceType === "spotify") {
    return runStore.createRun({ playlistUrl, sourceType });
  }

  const snapshot = await (
    dependencies.fetchSoundCloudPlaylistSnapshot ??
    fetchSoundCloudPlaylistSnapshot
  )(playlistUrl);
  const run = runStore.createRun({
    playlistTitle: snapshot.playlistTitle,
    playlistUrl: snapshot.playlistUrl,
    sourceType: "soundcloud"
  });

  runStore.replaceRunTracks(run.id, snapshot.tracks);

  const hydratedRun = runStore.getRun(run.id);

  if (!hydratedRun) {
    throw new Error(`Run not found after SoundCloud ingestion: ${run.id}`);
  }

  return hydratedRun;
}
