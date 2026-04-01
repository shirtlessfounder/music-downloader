import { HomeScreen } from "@/features/home/home-screen";
import { getRunStore } from "@/features/runs/run-store";
import { getSharedRunWorker } from "@/features/runs/run-worker";

export const dynamic = "force-dynamic";

export default function HomePage() {
  getSharedRunWorker();

  return <HomeScreen initialRuns={getRunStore().listRuns()} />;
}
