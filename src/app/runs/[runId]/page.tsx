import { notFound } from "next/navigation";

import { getRunReport } from "@/features/reports/run-report";
import { RunReportScreen } from "@/features/reports/run-report-screen";

export const dynamic = "force-dynamic";

type RunReportPageProps = {
  params: Promise<{
    runId: string;
  }>;
};

export default async function RunReportPage({ params }: RunReportPageProps) {
  const { runId } = await params;
  const report = getRunReport({ runId });

  if (!report) {
    notFound();
  }

  return <RunReportScreen report={report} />;
}
