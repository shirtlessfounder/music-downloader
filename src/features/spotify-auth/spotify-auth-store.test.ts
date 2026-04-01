/* @vitest-environment node */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createSpotifyAuthStore } from "./spotify-auth-store";

describe("createSpotifyAuthStore", () => {
  it("persists one local Spotify auth session in the workspace and clears it again", async () => {
    const workspaceRoot = mkdtempSync(
      path.join(tmpdir(), "music-downloader-spotify-auth-store-")
    );

    try {
      const store = createSpotifyAuthStore({ workspaceRoot });
      const expectedSession = {
        connectedAt: "2026-04-01T00:00:00.000Z",
        provider: "spotify" as const,
        refreshToken: "spotify-refresh-token",
        scope: "playlist-read-private playlist-read-collaborative",
        subjectHint: "operator"
      };

      expect(await store.readSession()).toBeNull();

      const persistedSession = await store.writeSession(expectedSession);

      expect(persistedSession).toEqual(expectedSession);
      expect(existsSync(store.getSessionPath())).toBe(true);

      const reloadedStore = createSpotifyAuthStore({ workspaceRoot });

      expect(await reloadedStore.readSession()).toEqual(expectedSession);

      await reloadedStore.clearSession();

      expect(await reloadedStore.readSession()).toBeNull();
      expect(existsSync(store.getSessionPath())).toBe(false);
    } finally {
      rmSync(workspaceRoot, { force: true, recursive: true });
    }
  });
});
