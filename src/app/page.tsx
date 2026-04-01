import { getSharedOperatorBrowserSessionManager } from "@/features/browser/operator-browser-session-manager";
import { HomeScreen } from "@/features/home/home-screen";
import { getRunStore } from "@/features/runs/run-store";
import { getSharedRunWorker } from "@/features/runs/run-worker";
import { createSpotifyAuthStore } from "@/features/spotify-auth/spotify-auth-store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  getSharedRunWorker();

  const [initialRuns, initialBrowserSessions, spotifySession] = await Promise.all([
    Promise.resolve(getRunStore().listRuns()),
    getSharedOperatorBrowserSessionManager().listSessions(),
    createSpotifyAuthStore().readSession()
  ]);

  return (
    <HomeScreen
      initialBrowserSessions={initialBrowserSessions}
      initialRuns={initialRuns}
      initialSpotifyAuth={
        spotifySession
          ? {
              detail: "Spotify operator account connected for playlist intake.",
              status: "connected",
              subjectHint: spotifySession.subjectHint
            }
          : {
              detail:
                "Spotify playlist intake requires a connected Spotify account before queueing Spotify playlists.",
              status: "missing",
              subjectHint: null
            }
      }
    />
  );
}
