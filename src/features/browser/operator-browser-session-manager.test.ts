// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { BrowserContext, BrowserType } from "playwright";
import { describe, expect, it, vi } from "vitest";

import { BrowserSessionService } from "./browser-session-service";
import { createOperatorBrowserSessionManager } from "./operator-browser-session-manager";

describe("OperatorBrowserSessionManager", () => {
  it("lists required provider session readiness from persisted auth state", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-operator-session-readiness-")
    );
    const browserType = createStubBrowserType();
    const browserSessionService = new BrowserSessionService({
      workspaceRoot,
      browserType: browserType.browserType
    });
    const manager = createOperatorBrowserSessionManager({
      browserSessionService,
      workspaceRoot
    });

    try {
      const bandcampSession = await browserSessionService.openSession({
        authState: {
          authenticatedAt: "2026-04-01T07:00:00.000Z",
          providerId: "bandcamp",
          status: "authenticated",
          subjectHint: "crate-digger@example.com"
        },
        sessionName: "bandcamp"
      });
      await bandcampSession.close();

      const beatportSession = await browserSessionService.openSession({
        authState: {
          expiredAt: "2026-04-01T07:30:00.000Z",
          providerId: "beatport",
          reason: "fixture expiry",
          status: "expired"
        },
        sessionName: "beatport"
      });
      await beatportSession.close();

      const sessions = await manager.listSessions();

      expect(
        sessions.map(({ providerId, status }) => ({ providerId, status }))
      ).toEqual([
        {
          providerId: "soundcloud-direct-downloads",
          status: "missing"
        },
        {
          providerId: "bandcamp",
          status: "ready"
        },
        {
          providerId: "beatport",
          status: "expired"
        }
      ]);
    } finally {
      await browserSessionService.shutdown();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("launches headed provider setup and persists authenticated readiness after completion", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-operator-session-launch-")
    );
    const browserType = createStubBrowserType();
    const browserSessionService = new BrowserSessionService({
      workspaceRoot,
      browserType: browserType.browserType
    });
    const manager = createOperatorBrowserSessionManager({
      browserSessionService,
      workspaceRoot
    });

    try {
      const launchedSession = await manager.launchSetup(
        "soundcloud-direct-downloads"
      );

      expect(launchedSession).toEqual(
        expect.objectContaining({
          providerId: "soundcloud-direct-downloads",
          status: "setup-in-progress"
        })
      );
      expect(browserType.launchPersistentContext).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          acceptDownloads: true,
          headless: false
        })
      );
      expect(browserType.page.goto).toHaveBeenCalledWith(
        "https://soundcloud.com",
        expect.objectContaining({
          waitUntil: "load"
        })
      );

      const completedSession = await manager.markAuthenticated(
        "soundcloud-direct-downloads",
        {
          subjectHint: "warehouse-operator@example.com"
        }
      );

      expect(completedSession).toEqual(
        expect.objectContaining({
          providerId: "soundcloud-direct-downloads",
          status: "ready",
          subjectHint: "warehouse-operator@example.com"
        })
      );

      await browserSessionService.shutdown();

      const restartedManager = createOperatorBrowserSessionManager({
        browserSessionService: new BrowserSessionService({
          workspaceRoot,
          browserType: browserType.browserType
        }),
        workspaceRoot
      });
      const sessionsAfterRestart = await restartedManager.listSessions();

      expect(
        sessionsAfterRestart.find(
          ({ providerId }) => providerId === "soundcloud-direct-downloads"
        )
      ).toEqual(
        expect.objectContaining({
          providerId: "soundcloud-direct-downloads",
          status: "ready",
          subjectHint: "warehouse-operator@example.com"
        })
      );
    } finally {
      await browserSessionService.shutdown();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

function createStubBrowserType() {
  let currentUrl = "about:blank";
  const page = {
    bringToFront: vi.fn(async () => undefined),
    goto: vi.fn(async (url: string) => {
      currentUrl = url;

      return {
        status: () => 200
      };
    }),
    url: () => currentUrl
  };
  const launchPersistentContext = vi
    .fn<BrowserType["launchPersistentContext"]>()
    .mockImplementation(async () => createStubBrowserContext(page));

  return {
    browserType: {
      launchPersistentContext
    } as unknown as BrowserType,
    launchPersistentContext,
    page
  };
}

function createStubBrowserContext(page: {
  bringToFront: () => Promise<void>;
  goto: (url: string) => Promise<{ status: () => number }>;
  url: () => string;
}) {
  return {
    close: async () => undefined,
    newPage: async () => page,
    pages: () => []
  } as unknown as BrowserContext;
}
