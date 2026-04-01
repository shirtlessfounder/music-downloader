import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import os from "node:os";
import path from "node:path";

import { BrowserSessionService } from "@/features/browser/browser-session-service";

import {
  BEATPORT_SESSION_NAME,
  createBeatportProvider
} from "./beatport";
import { createLiveProviderRegistry } from "./live-provider-registry";

describe("createBeatportProvider", () => {
  it("builds review queue candidates and queue metadata for paid fallback review", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-beatport-provider-search-")
    );
    const browserSessionService = new BrowserSessionService({ workspaceRoot });
    const provider = createBeatportProvider({ browserSessionService });

    try {
      const searchResult = await provider.search({
        track: buildCanonicalTrack()
      });

      if (searchResult.outcome !== "candidates") {
        throw new Error("Expected Beatport search to return a candidate.");
      }

      expect(searchResult.candidates[0].provenance.providerUrl).toBe(
        "https://www.beatport.com/search/tracks?q=Anyma%20Consciousness%20Extended%20Mix"
      );
      expect(searchResult.candidates[0].provenance).not.toHaveProperty(
        "providerTrackId"
      );
      expect(searchResult).toEqual({
        candidates: [
          expect.objectContaining({
            artistName: "Anyma",
            availableFormats: ["mp3", "wav"],
            candidateId: "beatport-anyma-consciousness",
            mixLabel: "Extended Mix",
            priceTier: "paid",
            providerId: "beatport",
            providerName: "Beatport",
            provenance: expect.objectContaining({
              providerUrl:
                "https://www.beatport.com/search/tracks?q=Anyma%20Consciousness%20Extended%20Mix"
            }),
            title: "Consciousness"
          })
        ],
        outcome: "candidates"
      });

      await expect(
        provider.queueForReview({
          candidate: searchResult.candidates[0],
          track: buildCanonicalTrack()
        })
      ).resolves.toEqual({
        candidate: expect.objectContaining({
          candidateId: "beatport-anyma-consciousness"
        }),
        outcome: "queued-for-review",
        review: {
          queueName: "beatport-review",
          summary: "Queued after all automatic free-source providers missed."
        }
      });
    } finally {
      await browserSessionService.shutdown();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("acquires an owned Beatport download and prefers MP3 over WAV", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-beatport-provider-owned-")
    );
    const fixtureServer = await startFixtureServer();
    const browserSessionService = new BrowserSessionService({ workspaceRoot });

    try {
      await seedAuthenticatedSession(browserSessionService);

      const provider = createBeatportProvider({
        baseUrl: fixtureServer.baseUrl,
        browserSessionService
      });
      const searchResult = await provider.search({
        track: buildCanonicalTrack()
      });

      if (searchResult.outcome !== "candidates") {
        throw new Error("Expected Beatport search to return a candidate.");
      }

      const acquisitionResult = await provider.acquirePurchased({
        candidate: searchResult.candidates[0],
        track: buildCanonicalTrack()
      });

      expect(acquisitionResult).toEqual(
        expect.objectContaining({
          artifact: expect.objectContaining({
            contentType: "audio/mpeg",
            fileExtension: "mp3",
            fileName: "consciousness.mp3",
            format: "mp3",
            localFilePath: expect.stringMatching(/consciousness\.mp3$/),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            sizeBytes: expect.any(Number)
          }),
          candidate: searchResult.candidates[0],
          outcome: "acquired"
        })
      );

      if (acquisitionResult.outcome !== "acquired") {
        throw new Error("Expected Beatport acquisition to return an owned download.");
      }

      expect(await readFile(acquisitionResult.artifact.localFilePath, "utf8")).toBe(
        "beatport owned mp3\n"
      );
      await access(acquisitionResult.artifact.localFilePath);
    } finally {
      await browserSessionService.shutdown();
      await fixtureServer.close();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("rejects owned downloads when no authenticated Beatport session is available", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-beatport-provider-auth-")
    );
    const browserSessionService = new BrowserSessionService({ workspaceRoot });

    try {
      const provider = createBeatportProvider({ browserSessionService });
      const candidate = {
        artistName: "Anyma",
        authorizationBasis: "purchase-entitlement" as const,
        availableFormats: ["mp3", "wav"] as const,
        candidateId: "beatport-anyma-consciousness",
        durationSeconds: 392,
        mixConfidence: "high" as const,
        mixLabel: "Extended Mix",
        priceTier: "paid" as const,
        providerId: "beatport",
        providerName: "Beatport",
        provenance: {
          discoveredVia: "search" as const,
          providerTrackId: "beatport-anyma-consciousness",
          providerUrl: "https://www.beatport.com/track/anyma-consciousness/anyma-consciousness",
          searchQuery: "Anyma Consciousness Extended Mix"
        },
        title: "Consciousness"
      };

      await expect(
        provider.acquirePurchased({
          candidate,
          track: buildCanonicalTrack()
        })
      ).resolves.toEqual({
        candidate,
        outcome: "rejected",
        rejection: expect.objectContaining({
          detail:
            "An authenticated Beatport browser session is required before owned downloads can be acquired.",
          providerId: "beatport",
          providerName: "Beatport",
          reason: "auth-required",
          retryable: true
        })
      });
    } finally {
      await browserSessionService.shutdown();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("registers Beatport as the live paid review provider", () => {
    const registry = createLiveProviderRegistry();

    expect(registry.listReviewQueue().map((provider) => provider.id)).toEqual([
      "beatport"
    ]);
  });
});

function buildCanonicalTrack() {
  return {
    artistCredits: [
      {
        display: "Anyma",
        normalized: "anyma",
        role: "primary" as const
      }
    ],
    availableFormats: [],
    durationSeconds: 392,
    mix: {
      cleanTitle: "Consciousness",
      confidence: "high" as const,
      displayLabel: "Extended Mix",
      kind: "extended" as const,
      normalizedLabel: "extended mix",
      selectionClass: "preferred" as const
    },
    normalizedArtistKey: "anyma",
    normalizedTitle: "consciousness",
    preferredFormats: ["mp3", "wav"] as const,
    primaryArtist: "Anyma",
    provenance: {
      rawArtists: ["Anyma"],
      rawDuration: null,
      rawTitle: "Consciousness (Extended Mix)",
      source: "playlist-run-track",
      sourceTrackId: "track-1"
    },
    title: "Consciousness"
  };
}

async function seedAuthenticatedSession(browserSessionService: BrowserSessionService) {
  const session = await browserSessionService.openSession({
    authState: {
      authenticatedAt: "2026-03-31T05:00:00.000Z",
      providerId: "beatport",
      status: "authenticated"
    },
    sessionName: BEATPORT_SESSION_NAME
  });

  await session.close();
}

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
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeFixtureServer(server)
  };
}

function handleFixtureRequest(request: IncomingMessage, response: ServerResponse) {
  if (request.url === "/search/tracks?q=Anyma%20Consciousness%20Extended%20Mix") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="en">
  <body>
    <main>
      <h1>Anyma - Consciousness</h1>
      <a
        data-testid="beatport-owned-download"
        data-format-key="mp3"
        href="/downloads/consciousness.mp3"
        download="consciousness.mp3"
        type="audio/mpeg"
      >
        Download MP3
      </a>
      <a
        data-testid="beatport-owned-download"
        data-format-key="wav"
        href="/downloads/consciousness.wav"
        download="consciousness.wav"
        type="audio/wav"
      >
        Download WAV
      </a>
    </main>
  </body>
</html>`);

    return;
  }

  if (request.url === "/downloads/consciousness.mp3") {
    response.writeHead(200, {
      "content-disposition": 'attachment; filename="consciousness.mp3"',
      "content-type": "audio/mpeg"
    });
    response.end("beatport owned mp3\n");

    return;
  }

  if (request.url === "/downloads/consciousness.wav") {
    response.writeHead(200, {
      "content-disposition": 'attachment; filename="consciousness.wav"',
      "content-type": "audio/wav"
    });
    response.end("beatport owned wav\n");

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
