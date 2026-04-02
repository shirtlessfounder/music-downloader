/* @vitest-environment node */

import { mkdtemp, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import os from "node:os";
import path from "node:path";

import { BrowserSessionService } from "@/features/browser/browser-session-service";

import { BEATPORT_SESSION_NAME } from "./beatport";
import { openBeatportCartForReviews } from "./beatport-cart";

describe("openBeatportCartForReviews", () => {
  it(
    "adds multiple Beatport reviews into one cart and keeps already-present entries",
    async () => {
      const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), "music-downloader-beatport-cart-builder-")
      );
      const fixtureServer = await startBeatportCartFixtureServer({
        initialCartTrackIds: ["1002"]
      });
      const browserSessionService = new BrowserSessionService({ workspaceRoot });

      try {
        await seedAuthenticatedSession(browserSessionService);

        const result = await openBeatportCartForReviews({
          baseUrl: fixtureServer.baseUrl,
          browserSessionService,
          headless: true,
          reviews: [
            {
              artist: "Anyma",
              candidateId: "beatport-1001",
              mixLabel: "Extended Mix",
              providerUrl: `${fixtureServer.baseUrl}/track/consciousness/1001`,
              reviewId: "review-1",
              title: "Consciousness"
            },
            {
              artist: "Mau P",
              candidateId: "beatport-1002",
              mixLabel: null,
              providerUrl: `${fixtureServer.baseUrl}/track/drugs-from-amsterdam/1002`,
              reviewId: "review-2",
              title: "Drugs From Amsterdam"
            }
          ]
        });

        expect(result).toEqual({
          cartUrl: `${fixtureServer.baseUrl}/cart`,
          outcome: "opened-cart",
          results: [
            {
              cartDetail: "Added track to the Beatport cart.",
              cartStatus: "added",
              providerUrl: `${fixtureServer.baseUrl}/track/consciousness/1001`,
              reviewId: "review-1"
            },
            {
              cartDetail: "Track already existed in the Beatport cart.",
              cartStatus: "already-in-cart",
              providerUrl: `${fixtureServer.baseUrl}/track/drugs-from-amsterdam/1002`,
              reviewId: "review-2"
            }
          ],
          summary: {
            added: 1,
            alreadyInCart: 1,
            failed: 0,
            notFound: 0,
            total: 2
          }
        });
        expect(fixtureServer.getCartTrackIds()).toEqual(["1001", "1002"]);
      } finally {
        await browserSessionService.shutdown();
        await fixtureServer.close();
        await rm(workspaceRoot, { force: true, recursive: true });
      }
    },
    15_000
  );

  it(
    "falls back to Beatport search when the persisted review target URL is missing",
    async () => {
      const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), "music-downloader-beatport-cart-search-fallback-")
      );
      const fixtureServer = await startBeatportCartFixtureServer();
      const browserSessionService = new BrowserSessionService({ workspaceRoot });

      try {
        await seedAuthenticatedSession(browserSessionService);

        const result = await openBeatportCartForReviews({
          baseUrl: fixtureServer.baseUrl,
          browserSessionService,
          headless: true,
          reviews: [
            {
              artist: "Anyma",
              candidateId: "beatport-1001",
              mixLabel: "Extended Mix",
              providerUrl: null,
              reviewId: "review-1",
              title: "Consciousness"
            }
          ]
        });

        expect(result).toEqual({
          cartUrl: `${fixtureServer.baseUrl}/cart`,
          outcome: "opened-cart",
          results: [
            {
              cartDetail: "Added track to the Beatport cart.",
              cartStatus: "added",
              providerUrl: `${fixtureServer.baseUrl}/track/consciousness/1001`,
              reviewId: "review-1"
            }
          ],
          summary: {
            added: 1,
            alreadyInCart: 0,
            failed: 0,
            notFound: 0,
            total: 1
          }
        });
      } finally {
        await browserSessionService.shutdown();
        await fixtureServer.close();
        await rm(workspaceRoot, { force: true, recursive: true });
      }
    },
    15_000
  );

  it("fails early when no authenticated Beatport session exists", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-beatport-cart-no-auth-")
    );
    const fixtureServer = await startBeatportCartFixtureServer();
    const browserSessionService = new BrowserSessionService({ workspaceRoot });

    try {
      const result = await openBeatportCartForReviews({
        baseUrl: fixtureServer.baseUrl,
        browserSessionService,
        headless: true,
        reviews: []
      });

      expect(result).toEqual({
        detail:
          "An authenticated Beatport browser session is required before the cart can be opened.",
        outcome: "failed",
        reason: "auth-expired"
      });
    } finally {
      await browserSessionService.shutdown();
      await fixtureServer.close();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("fails cleanly when a background Beatport session is already active", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-beatport-cart-session-conflict-")
    );
    const fixtureServer = await startBeatportCartFixtureServer();
    const browserSessionService = new BrowserSessionService({ workspaceRoot });

    try {
      await seedAuthenticatedSession(browserSessionService);
      const backgroundSession = await browserSessionService.openSession({
        owner: "background",
        sessionName: BEATPORT_SESSION_NAME
      });

      const result = await openBeatportCartForReviews({
        baseUrl: fixtureServer.baseUrl,
        browserSessionService,
        headless: true,
        reviews: []
      });

      expect(result).toEqual({
        detail:
          "Another background browser session is already active for Beatport. Wait for it to finish before opening the cart.",
        outcome: "failed",
        reason: "session-conflict"
      });

      await backgroundSession.close();
    } finally {
      await browserSessionService.shutdown();
      await fixtureServer.close();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

async function seedAuthenticatedSession(browserSessionService: BrowserSessionService) {
  const session = await browserSessionService.openSession({
    authState: {
      authenticatedAt: "2026-04-02T15:00:00.000Z",
      providerId: "beatport",
      status: "authenticated"
    },
    sessionName: BEATPORT_SESSION_NAME
  });

  await session.close();
}

async function startBeatportCartFixtureServer(input: {
  initialCartTrackIds?: string[];
} = {}) {
  const cartTrackIds = new Set(input.initialCartTrackIds ?? []);
  const server = createServer((request, response) =>
    handleFixtureRequest({ cartTrackIds, request, response })
  );

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
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeFixtureServer(server),
    getCartTrackIds() {
      return [...cartTrackIds].sort();
    }
  };
}

function handleFixtureRequest(input: {
  cartTrackIds: Set<string>;
  request: IncomingMessage;
  response: ServerResponse;
}) {
  const requestUrl = new URL(input.request.url ?? "/", "http://127.0.0.1");

  if (requestUrl.pathname === "/search/tracks") {
    input.response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    input.response.end(`<!doctype html>
<html lang="en">
  <body>
    <main>
      <article data-testid="beatport-search-result">
        <a href="/track/consciousness/1001">Consciousness</a>
        <p data-testid="beatport-search-result-artist">Anyma</p>
      </article>
    </main>
  </body>
</html>`);

    return;
  }

  if (requestUrl.pathname === "/track/consciousness/1001") {
    input.response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    input.response.end(renderTrackPage({
      alreadyInCart: input.cartTrackIds.has("1001"),
      addPath: "/cart/add/1001",
      heading: "Anyma - Consciousness"
    }));
    return;
  }

  if (requestUrl.pathname === "/track/drugs-from-amsterdam/1002") {
    input.response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    input.response.end(renderTrackPage({
      alreadyInCart: input.cartTrackIds.has("1002"),
      addPath: "/cart/add/1002",
      heading: "Mau P - Drugs From Amsterdam"
    }));
    return;
  }

  if (requestUrl.pathname === "/cart/add/1001") {
    input.cartTrackIds.add("1001");
    input.response.writeHead(302, { location: "/cart" });
    input.response.end();
    return;
  }

  if (requestUrl.pathname === "/cart/add/1002") {
    input.cartTrackIds.add("1002");
    input.response.writeHead(302, { location: "/cart" });
    input.response.end();
    return;
  }

  if (requestUrl.pathname === "/cart") {
    input.response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    input.response.end(`<!doctype html>
<html lang="en">
  <body>
    <main data-testid="beatport-cart-page">
      <p>Cart items: ${[...input.cartTrackIds].sort().join(",")}</p>
    </main>
  </body>
</html>`);
    return;
  }

  input.response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  input.response.end("Not found");
}

function renderTrackPage(input: {
  addPath: string;
  alreadyInCart: boolean;
  heading: string;
}) {
  return `<!doctype html>
<html lang="en">
  <body>
    <main>
      <h1>${input.heading}</h1>
      ${
        input.alreadyInCart
          ? '<p data-testid="beatport-cart-status" data-status="already-in-cart">Already in cart</p>'
          : `<a data-testid="beatport-add-to-cart" href="${input.addPath}">Add to cart</a>`
      }
    </main>
  </body>
</html>`;
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
