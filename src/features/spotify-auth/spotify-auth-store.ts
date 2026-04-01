import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SpotifyAuthSession {
  connectedAt: string;
  provider: "spotify";
  refreshToken: string;
  scope: string | null;
  subjectHint: string | null;
}

export function createSpotifyAuthStore(options: { workspaceRoot?: string } = {}) {
  const sessionPath = path.join(
    resolveWorkspaceRoot(options.workspaceRoot),
    ".music-downloader",
    "spotify-auth",
    "session.json"
  );

  return {
    async clearSession() {
      await rm(sessionPath, { force: true });
    },

    getSessionPath() {
      return sessionPath;
    },

    async readSession(): Promise<SpotifyAuthSession | null> {
      try {
        const fileContents = await readFile(sessionPath, "utf8");

        return JSON.parse(fileContents) as SpotifyAuthSession;
      } catch (error) {
        if (isMissingFileError(error)) {
          return null;
        }

        throw error;
      }
    },

    async writeSession(session: SpotifyAuthSession) {
      await mkdir(path.dirname(sessionPath), { recursive: true });
      await writeFile(sessionPath, JSON.stringify(session, null, 2), "utf8");
      return session;
    }
  };
}

function isMissingFileError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function resolveWorkspaceRoot(workspaceRoot?: string) {
  return (
    workspaceRoot ??
    process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT ??
    path.join(process.cwd())
  );
}
