import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { render, screen } from "@testing-library/react";
import { resetSharedRunWorkerForTests } from "@/features/runs/run-worker";

async function withTempDatabase(callback: (databasePath: string) => Promise<void>) {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), "music-downloader-page-"));
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

describe("HomePage", () => {
  beforeEach(() => {
    resetSharedRunWorkerForTests();
  });

  afterEach(() => {
    resetSharedRunWorkerForTests();
  });

  it("forces live home-page rendering against the SQLite run store", async () => {
    vi.resetModules();

    const pageModule = await import("./page");

    expect(pageModule.dynamic).toBe("force-dynamic");
  });

  it("renders real recent runs from SQLite-backed data", async () => {
    await withTempDatabase(async () => {
      vi.resetModules();

      const runStoreModule = await import("@/features/runs/run-store");
      const store = runStoreModule.getRunStore();
      const run = store.createRun({
        playlistUrl: "https://soundcloud.com/artist/sets/warehouse-test",
        sourceType: "soundcloud"
      });

      store.replaceRunTracks(run.id, [
        {
          artist: "Artist One",
          sourcePosition: 1,
          title: "Warehouse Tool"
        }
      ]);
      store.transitionRunStatus(run.id, "ingesting");

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify(store.getRun(run.id)), { status: 200 })
        );
      const pageModule = await import("./page");

      render(await pageModule.default());

      expect(screen.getByText(/^SoundCloud$/i)).toBeVisible();
      expect(
        screen.getByText(/https:\/\/soundcloud\.com\/artist\/sets\/warehouse-test/i)
      ).toBeVisible();
      expect(screen.getByText(/ingesting/i)).toBeVisible();
      expect(screen.getByText(/1 track/i)).toBeVisible();

      fetchSpy.mockRestore();
    });
  });
});
