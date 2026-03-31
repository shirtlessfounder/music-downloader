import { HomeScreen } from "@/features/home/home-screen";
import { getRunStore } from "@/features/runs/run-store";

export default function HomePage() {
  return <HomeScreen initialRuns={getRunStore().listRuns()} />;
}
