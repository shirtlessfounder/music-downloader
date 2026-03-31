import { HomeScreen } from "@/features/home/home-screen";
import { getRunStore } from "@/features/runs/run-store";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <HomeScreen initialRuns={getRunStore().listRuns()} />;
}
