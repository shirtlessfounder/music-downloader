/* @vitest-environment node */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

async function withTempDatabase(
  callback: (databasePath: string) => Promise<void> | void
) {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), "music-downloader-api-"));
  const databasePath = path.join(tempDirectory, "music-downloader.sqlite");

  process.env.MUSIC_DOWNLOADER_DB_PATH = databasePath;

  try {
    await callback(databasePath);
  } finally {
    const runStoreModule = await import("@/features/runs/run-store");

    runStoreModule.resetRunStoreForTests();
    delete process.env.MUSIC_DOWNLOADER_DB_PATH;
    rmSync(tempDirectory, { force: true, recursive: true });
  }
}

describe("/api/runs", () => {
  it("creates a queued run and exposes its pollable status", async () => {
    await withTempDatabase(async (databasePath) => {
      vi.resetModules();

      const [{ POST }, { GET }, runStoreModule] = await Promise.all([
        import("./route"),
        import("../runs/[runId]/route"),
        import("@/features/runs/run-store")
      ]);

      const createResponse = await POST(
        new Request("http://localhost/api/runs", {
          body: JSON.stringify({
            playlistUrl:
              "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9"
          }),
          headers: {
            "content-type": "application/json"
          },
          method: "POST"
        })
      );

      expect(createResponse.status).toBe(201);
      expect(existsSync(databasePath)).toBe(true);

      const createdRun = (await createResponse.json()) as { id: string };
      const pollResponse = await GET(
        new Request(`http://localhost/api/runs/${createdRun.id}`),
        {
          params: Promise.resolve({ runId: createdRun.id })
        }
      );
      const polledRun = (await pollResponse.json()) as {
        id: string;
        sourceType: string;
        status: string;
      };

      expect(polledRun).toEqual(
        expect.objectContaining({
          id: createdRun.id,
          sourceType: "spotify",
          status: "queued"
        })
      );
      expect(runStoreModule.getRunStore().listRuns()).toHaveLength(1);
    });
  });
});
