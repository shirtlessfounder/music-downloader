// @vitest-environment node

import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BrowserSessionService,
  MissingBrowserSessionAuthStateError,
  MissingBrowserSessionStateError
} from "./browser-session-service";

describe("BrowserSessionService", () => {
  it(
    "reopens a named persistent session with its browser profile intact",
    async () => {
      const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), "music-downloader-browser-session-")
      );
      const fixtureServer = await startFixtureServer();
      const service = new BrowserSessionService({ workspaceRoot });

      try {
        const session = await service.openSession({
          sessionName: "beatport-review"
        });

        await session.navigate({ url: fixtureServer.url("/persist") });
        await session.withPage(async (page) => {
          await page.evaluate(() => {
            localStorage.setItem("auth-token", "persisted-token");
          });
        });
        await session.close();

        const reopenedSession = await service.openSession({
          sessionName: "beatport-review"
        });

        await reopenedSession.navigate({ url: fixtureServer.url("/persist") });
        const persistedToken = await reopenedSession.withPage((page) =>
          page.evaluate(() => localStorage.getItem("auth-token"))
        );

        expect(reopenedSession.wasReused).toBe(true);
        expect(persistedToken).toBe("persisted-token");

        await reopenedSession.close();
        await service.shutdown();
      } finally {
        await fixtureServer.close();
        await rm(workspaceRoot, { force: true, recursive: true });
      }
    },
    15_000
  );

  it("surfaces typed missing and expired auth state failures", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-browser-session-auth-")
    );
    const service = new BrowserSessionService({ workspaceRoot });

    try {
      await expect(
        service.requireAuthenticatedSession("missing-session")
      ).rejects.toBeInstanceOf(MissingBrowserSessionStateError);

      const unknownAuthSession = await service.openSession({
        sessionName: "beatport-review"
      });
      await unknownAuthSession.close();

      await expect(
        service.requireAuthenticatedSession("beatport-review")
      ).rejects.toBeInstanceOf(MissingBrowserSessionAuthStateError);

      const expiredAt = "2026-03-31T05:00:00.000Z";
      const expiredSession = await service.openSession({
        sessionName: "expired-session",
        authState: {
          expiredAt,
          providerId: "beatport",
          reason: "fixture login expired",
          status: "expired"
        }
      });
      await expiredSession.close();

      await expect(
        service.requireAuthenticatedSession("expired-session")
      ).rejects.toEqual(
        expect.objectContaining({
          code: "expired-session-auth-state",
          expiredAt,
          sessionName: "expired-session"
        })
      );
    } finally {
      await service.shutdown();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("wraps navigation, screenshots, and downloads behind provider helpers", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-browser-session-helpers-")
    );
    const fixtureServer = await startFixtureServer();
    const service = new BrowserSessionService({ workspaceRoot });

    try {
      const session = await service.openSession({
        sessionName: "helper-fixture",
        authState: {
          authenticatedAt: "2026-03-31T05:00:00.000Z",
          providerId: "fixture-provider",
          status: "authenticated"
        }
      });

      const visit = await session.navigate({ url: fixtureServer.url("/download") });
      expect(visit).toEqual({
        status: 200,
        url: fixtureServer.url("/download")
      });

      const screenshotPath = path.join(workspaceRoot, "artifacts", "fixture.png");
      const screenshot = await session.takeScreenshot({ path: screenshotPath });
      await access(screenshot.path);

      const downloadPath = path.join(workspaceRoot, "artifacts", "fixture.txt");
      const download = await session.captureDownload({
        saveAs: downloadPath,
        trigger: async (page) => {
          await page.getByRole("link", { name: "Download fixture" }).click();
        }
      });

      expect(download.suggestedFilename).toBe("fixture.txt");
      expect(await readFile(download.path, "utf8")).toBe("fixture download contents\n");
      await access(download.path);
      expect(screenshot).toEqual({ path: screenshotPath });

      await session.close();
    } finally {
      await service.shutdown();
      await fixtureServer.close();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

async function startFixtureServer() {
  const server = createServer(handleFixtureRequest);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("Fixture server did not expose a TCP address.");
  }

  return {
    close: () => closeFixtureServer(server),
    url: (pathname: string) => `http://127.0.0.1:${address.port}${pathname}`
  };
}

function handleFixtureRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.url === "/persist") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="en">
  <body>
    <main>
      <h1>Persistent Session Fixture</h1>
      <p>Used to verify local browser state survives a reopen.</p>
    </main>
  </body>
</html>`);

    return;
  }

  if (request.url === "/download") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="en">
  <body>
    <main>
      <h1>Download Fixture</h1>
      <a href="/files/fixture.txt" download>Download fixture</a>
    </main>
  </body>
</html>`);

    return;
  }

  if (request.url === "/files/fixture.txt") {
    response.writeHead(200, {
      "content-disposition": 'attachment; filename="fixture.txt"',
      "content-type": "text/plain; charset=utf-8"
    });
    response.end("fixture download contents\n");

    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

async function closeFixtureServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
