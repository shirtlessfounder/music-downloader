/* @vitest-environment node */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

async function withTempWorkspace(callback: (workspaceRoot: string) => Promise<void>) {
  const workspaceRoot = mkdtempSync(
    path.join(tmpdir(), "music-downloader-artifact-route-")
  );
  const databasePath = path.join(workspaceRoot, "data", "music-downloader.sqlite");
  const originalDatabasePath = process.env.MUSIC_DOWNLOADER_DB_PATH;
  const originalWorkspaceRoot = process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT;

  process.env.MUSIC_DOWNLOADER_DB_PATH = databasePath;
  process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT = workspaceRoot;

  try {
    await callback(workspaceRoot);
  } finally {
    const runStoreModule = await import("@/features/runs/run-store");

    runStoreModule.resetRunStoreForTests();

    if (originalDatabasePath === undefined) {
      delete process.env.MUSIC_DOWNLOADER_DB_PATH;
    } else {
      process.env.MUSIC_DOWNLOADER_DB_PATH = originalDatabasePath;
    }

    if (originalWorkspaceRoot === undefined) {
      delete process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT;
    } else {
      process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT = originalWorkspaceRoot;
    }

    rmSync(workspaceRoot, { force: true, recursive: true });
  }
}

function createSha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

describe("/api/runs/[runId]/artifacts", () => {
  it("generates artifacts and exposes stable download URLs for the run report UI", async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      vi.resetModules();

      const [
        { POST, GET: listArtifacts },
        { GET: downloadArtifact },
        runStoreModule,
        runArtifactsModule
      ] = await Promise.all([
        import("./route"),
        import("./[artifactKind]/route"),
        import("@/features/runs/run-store"),
        import("@/features/artifacts/run-artifacts")
      ]);

      const store = runStoreModule.getRunStore();
      const run = store.createRun({
        playlistTitle: "Night Drive",
        playlistUrl: "https://soundcloud.com/sets/night-drive",
        sourceType: "soundcloud"
      });
      const [track] = store.replaceRunTracks(run.id, [
        {
          artist: "Nora En Pure",
          sourcePosition: 1,
          title: "Lake Arrowhead",
          version: "Original Mix"
        }
      ]);
      const acquiredFilePath = path.join(workspaceRoot, "downloads", "lake-arrowhead.mp3");
      const acquiredFileBody = Buffer.from("fixture download\n", "utf8");

      mkdirSync(path.dirname(acquiredFilePath), { recursive: true });
      writeFileSync(acquiredFilePath, acquiredFileBody);

      store.transitionRunStatus(run.id, "ingesting");
      store.transitionRunStatus(run.id, "matching");
      store.transitionRunStatus(run.id, "packaging");
      store.updateRunTrackStatus(track.id, "acquired");
      store.recordAcquisitionAttempt({
        note: JSON.stringify(
          runArtifactsModule.buildAcquiredArtifactSourceNote({
            artifact: {
              contentType: "audio/mpeg",
              fileExtension: "mp3",
              fileName: "lake-arrowhead.mp3",
              format: "mp3",
              localFilePath: acquiredFilePath,
              sha256: createSha256(acquiredFileBody),
              sizeBytes: acquiredFileBody.length
            },
            provider: {
              authorizationBasis: "uploader-enabled-download",
              candidateId: "sc-track-201",
              discoveredVia: "search",
              priceTier: "free",
              providerId: "soundcloud-direct-downloads",
              providerName: "SoundCloud Direct Downloads",
              providerUrl: "https://soundcloud.com/noraenpure/lake-arrowhead"
            },
            selection: {
              details: "Original Mix matched the approved fallback preference order.",
              reason: "accepted-original-mix",
              selectedFormat: "mp3"
            }
          })
        ),
        outcome: "matched",
        providerKey: "soundcloud-direct-downloads",
        runTrackId: track.id
      });

      const generateResponse = await POST(
        new Request(`http://localhost/api/runs/${run.id}/artifacts`, {
          method: "POST"
        }),
        {
          params: Promise.resolve({ runId: run.id })
        }
      );

      expect(generateResponse.status).toBe(200);

      const generatedPayload = (await generateResponse.json()) as {
        artifacts: Array<{
          downloadUrl: string;
          kind: string;
        }>;
      };

      expect(generatedPayload.artifacts).toEqual([
        {
          downloadUrl: `/api/runs/${run.id}/artifacts/downloads-zip`,
          kind: "downloads-zip"
        },
        {
          downloadUrl: `/api/runs/${run.id}/artifacts/misses-txt`,
          kind: "misses-txt"
        },
        {
          downloadUrl: `/api/runs/${run.id}/artifacts/manifest-json`,
          kind: "manifest-json"
        }
      ]);

      const listResponse = await listArtifacts(
        new Request(`http://localhost/api/runs/${run.id}/artifacts`, {
          method: "GET"
        }),
        {
          params: Promise.resolve({ runId: run.id })
        }
      );

      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toEqual(generatedPayload);

      const manifestResponse = await downloadArtifact(
        new Request(`http://localhost/api/runs/${run.id}/artifacts/manifest-json`, {
          method: "GET"
        }),
        {
          params: Promise.resolve({
            artifactKind: "manifest-json",
            runId: run.id
          })
        }
      );

      expect(manifestResponse.status).toBe(200);
      expect(manifestResponse.headers.get("content-type")).toMatch(
        /application\/json/
      );
      await expect(manifestResponse.json()).resolves.toMatchObject({
        run: {
          id: run.id,
          playlistTitle: "Night Drive"
        },
        summary: {
          acquiredCount: 1,
          missCount: 0,
          trackCount: 1
        }
      });
    });
  });
});
