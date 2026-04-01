import { getSharedOperatorBrowserSessionManager } from "@/features/browser/operator-browser-session-manager";
import { HomeScreen } from "@/features/home/home-screen";
import { getRunStore } from "@/features/runs/run-store";
import { getSharedRunWorker } from "@/features/runs/run-worker";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  getSharedRunWorker();

  const [initialRuns, initialBrowserSessions] = await Promise.all([
    Promise.resolve(getRunStore().listRuns()),
    getSharedOperatorBrowserSessionManager().listSessions()
  ]);

  return (
    <HomeScreen
      initialBrowserSessions={initialBrowserSessions}
      initialRuns={initialRuns}
    />
  );
}
