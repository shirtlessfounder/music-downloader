import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  RunArtifactNotFoundError,
  resolveRunArtifact
} from "@/features/artifacts/run-artifacts";
import { type ArtifactKind, getRunStore } from "@/features/runs/run-store";

type RouteContext = {
  params: Promise<{
    artifactKind: string;
    runId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { artifactKind, runId } = await context.params;
  const runStore = getRunStore();

  if (!runStore.getRun(runId)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (!isArtifactKind(artifactKind)) {
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  }

  try {
    const artifact = resolveRunArtifact({
      artifactKind,
      runId,
      runStore
    });
    const fileBytes = await readFile(
      /* turbopackIgnore: true */ artifact.absolutePath
    );

    return new Response(fileBytes, {
      headers: {
        "content-disposition": `attachment; filename="${path.basename(
          artifact.relativePath
        )}"`,
        "content-type": getArtifactContentType(artifact.kind)
      }
    });
  } catch (error) {
    if (error instanceof RunArtifactNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    throw error;
  }
}

function isArtifactKind(value: string): value is ArtifactKind {
  return (
    value === "downloads-zip" ||
    value === "manifest-json" ||
    value === "misses-txt" ||
    value === "run-report"
  );
}

function getArtifactContentType(kind: ArtifactKind) {
  switch (kind) {
    case "downloads-zip":
      return "application/zip";
    case "manifest-json":
      return "application/json; charset=utf-8";
    case "misses-txt":
      return "text/plain; charset=utf-8";
    case "run-report":
      return "text/html; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
