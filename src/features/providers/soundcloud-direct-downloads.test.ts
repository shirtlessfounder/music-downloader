/* @vitest-environment node */

import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BrowserSessionService } from "@/features/browser/browser-session-service";
import { canonicalizeTrack } from "@/features/tracks/canonical-track";

import {
  ProviderRegistry,
  buildProviderMissResult,
  buildProviderRejectedResult,
  defineAutomaticProvider,
  defineReviewQueueProvider
} from "./provider-registry";
import {
  SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
  SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
  SOUNDCLOUD_DIRECT_DOWNLOADS_SESSION_NAME,
  createSoundCloudDirectDownloadsProvider
} from "./soundcloud-direct-downloads";

describe("createSoundCloudDirectDownloadsProvider", () => {
  it("registers with the research-mandated metadata and deterministic provider order", () => {
    const registry = new ProviderRegistry([
      defineReviewQueueProvider({
        id: "beatport",
        displayName: "Beatport",
        authorizationBasis: "purchase-entitlement",
        priorityRank: 90,
        supportedFormats: ["mp3", "wav", "aiff"],
        search: async () =>
          buildProviderMissResult({
            detail: "No Beatport candidate queued yet.",
            providerId: "beatport",
            providerName: "Beatport",
            reason: "no-search-results",
            trackMissReason: "no-authorized-source-match"
          }),
        queueForReview: async ({ candidate }) => ({
          outcome: "queued-for-review",
          candidate,
          review: {
            queueName: "beatport-review",
            summary: "Queued for later operator approval."
          }
        })
      }),
      defineAutomaticProvider({
        id: "bandcamp",
        displayName: "Bandcamp",
        authorizationBasis: "rights-holder-storefront",
        priceTier: "free-or-owned",
        priorityRank: 20,
        supportedFormats: ["mp3", "wav", "flac"],
        search: async () =>
          buildProviderMissResult({
            detail: "No Bandcamp result for the requested track.",
            providerId: "bandcamp",
            providerName: "Bandcamp",
            reason: "no-search-results",
            trackMissReason: "no-authorized-source-match"
          }),
        acquire: async ({ candidate }) =>
          buildProviderRejectedResult({
            candidate,
            detail: "Fixture provider does not acquire assets in this test.",
            providerId: "bandcamp",
            providerName: "Bandcamp",
            reason: "provider-error"
          })
      }),
      createSoundCloudDirectDownloadsProvider({
        browserSessionService: createUnusedBrowserSessionService()
      })
    ]);

    expect(registry.list().map((provider) => provider.id)).toEqual([
      SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
      "bandcamp",
      "beatport"
    ]);

    const provider = registry.get(SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID);

    expect(provider).toEqual(
      expect.objectContaining({
        authorizationBasis: "uploader-enabled-download",
        displayName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
        id: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
        implementationBucket: "free-auto",
        mode: "automatic",
        priceTier: "free",
        priorityRank: 10,
        supportedFormats: ["original-upload-format"]
      })
    );
  });

  it(
    "returns an authorized candidate when a matching track exposes an uploader-enabled download",
    async () => {
      const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), "music-downloader-soundcloud-provider-")
      );
      const fixtureServer = await startSoundCloudFixtureServer({
        searchResults: ["/dj-sealer/warehouse-tool-extended-mix"],
        tracks: [
          {
            artistName: "DJ Sealer",
            download: {
              body: "lossless fixture payload\n",
              contentType: "audio/flac",
              fileName: "warehouse-tool.flac"
            },
            durationSeconds: 392,
            path: "/dj-sealer/warehouse-tool-extended-mix",
            title: "Warehouse Tool (Extended Mix)",
            trackId: "111"
          }
        ]
      });
      const browserSessionService = new BrowserSessionService({ workspaceRoot });
      const provider = createSoundCloudDirectDownloadsProvider({
        baseUrl: fixtureServer.origin,
        browserSessionService
      });

      try {
        await seedAuthenticatedSession(browserSessionService);

        const result = await provider.search({
          track: canonicalizeTrack({
            artistName: "DJ Sealer",
            source: "spotify",
            title: "Warehouse Tool (Extended Mix)"
          })
        });

        expect(result).toEqual({
          outcome: "candidates",
          candidates: [
            {
              artistName: "DJ Sealer",
              authorizationBasis: "uploader-enabled-download",
              availableFormats: ["original-upload-format"],
              candidateId: "111",
              durationSeconds: 392,
              mixConfidence: "high",
              mixLabel: "Extended Mix",
              priceTier: "free",
              providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
              providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
              provenance: {
                discoveredVia: "search",
                providerTrackId: "111",
                providerUrl:
                  `${fixtureServer.origin}/dj-sealer/warehouse-tool-extended-mix`,
                searchQuery: "DJ Sealer Warehouse Tool Extended Mix",
                sourcePageUrl:
                  `${fixtureServer.origin}/dj-sealer/warehouse-tool-extended-mix`
              },
              title: "Warehouse Tool"
            }
          ]
        });
      } finally {
        await browserSessionService.shutdown();
        await fixtureServer.close();
        await rm(workspaceRoot, { force: true, recursive: true });
      }
    },
    15_000
  );

  it.each([
    {
      detailPattern: /external download/i,
      download: {
        externalUrl: "https://label.example.com/free-download",
        kind: "external" as const
      },
      name: "an external download link"
    },
    {
      detailPattern: /download.*enabled/i,
      download: {
        kind: "disabled" as const
      },
      name: "no download button"
    }
  ])(
    "returns a structured miss when the matching track exposes $name instead of an uploader-enabled download",
    async ({ detailPattern, download }) => {
      const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), "music-downloader-soundcloud-provider-miss-")
      );
      const fixtureServer = await startSoundCloudFixtureServer({
        searchResults: ["/dj-sealer/warehouse-tool-extended-mix"],
        tracks: [
          {
            artistName: "DJ Sealer",
            download,
            durationSeconds: 392,
            path: "/dj-sealer/warehouse-tool-extended-mix",
            title: "Warehouse Tool (Extended Mix)",
            trackId: "111"
          }
        ]
      });
      const browserSessionService = new BrowserSessionService({ workspaceRoot });
      const provider = createSoundCloudDirectDownloadsProvider({
        baseUrl: fixtureServer.origin,
        browserSessionService
      });

      try {
        await seedAuthenticatedSession(browserSessionService);

        const result = await provider.search({
          track: canonicalizeTrack({
            artistName: "DJ Sealer",
            source: "spotify",
            title: "Warehouse Tool (Extended Mix)"
          })
        });

        expect(result).toEqual({
          outcome: "miss",
          miss: expect.objectContaining({
            providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
            providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
            reason: "no-authorized-candidate",
            trackMissReason: "no-authorized-source-match"
          })
        });
        if (result.outcome !== "miss") {
          throw new Error("Expected SoundCloud search to return a provider miss.");
        }
        expect(result.miss.detail).toMatch(detailPattern);
      } finally {
        await browserSessionService.shutdown();
        await fixtureServer.close();
        await rm(workspaceRoot, { force: true, recursive: true });
      }
    },
    15_000
  );

  it("maps missing and expired browser sessions to structured rejections", async () => {
    const missingWorkspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-soundcloud-provider-auth-")
    );
    const expiredWorkspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-soundcloud-provider-expired-")
    );
    const fixtureServer = await startSoundCloudFixtureServer({
      searchResults: [],
      tracks: []
    });
    const missingBrowserSessionService = new BrowserSessionService({
      workspaceRoot: missingWorkspaceRoot
    });
    const expiredBrowserSessionService = new BrowserSessionService({
      workspaceRoot: expiredWorkspaceRoot
    });

    try {
      const expiredSession = await expiredBrowserSessionService.openSession({
        sessionName: SOUNDCLOUD_DIRECT_DOWNLOADS_SESSION_NAME,
        authState: {
          expiredAt: "2026-03-31T05:00:00.000Z",
          providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
          reason: "fixture session expired",
          status: "expired"
        }
      });
      await expiredSession.close();

      const track = canonicalizeTrack({
        artistName: "DJ Sealer",
        source: "spotify",
        title: "Warehouse Tool (Extended Mix)"
      });

      await expect(
        createSoundCloudDirectDownloadsProvider({
          baseUrl: fixtureServer.origin,
          browserSessionService: missingBrowserSessionService
        }).search({ track })
      ).resolves.toEqual({
        outcome: "rejected",
        rejection: {
          detail:
            "An authenticated SoundCloud browser session is required before automatic downloads can run.",
          providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
          providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
          reason: "auth-required",
          retryable: true,
          trackDecisionReason: undefined
        }
      });

      await expect(
        createSoundCloudDirectDownloadsProvider({
          baseUrl: fixtureServer.origin,
          browserSessionService: expiredBrowserSessionService
        }).search({ track })
      ).resolves.toEqual({
        outcome: "rejected",
        rejection: {
          detail:
            "The SoundCloud browser session expired and must be refreshed before automatic downloads can run.",
          providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
          providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
          reason: "provider-session-expired",
          retryable: true,
          trackDecisionReason: undefined
        }
      });
    } finally {
      await missingBrowserSessionService.shutdown();
      await expiredBrowserSessionService.shutdown();
      await fixtureServer.close();
      await rm(missingWorkspaceRoot, { force: true, recursive: true });
      await rm(expiredWorkspaceRoot, { force: true, recursive: true });
    }
  });

  it(
    "acquires the original uploaded file and normalizes artifact metadata",
    async () => {
      const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), "music-downloader-soundcloud-provider-acquire-")
      );
      const fixtureServer = await startSoundCloudFixtureServer({
        searchResults: ["/dj-sealer/warehouse-tool-extended-mix"],
        tracks: [
          {
            artistName: "DJ Sealer",
            download: {
              body: "lossless fixture payload\n",
              contentType: "audio/flac",
              fileName: "warehouse-tool.flac"
            },
            durationSeconds: 392,
            path: "/dj-sealer/warehouse-tool-extended-mix",
            title: "Warehouse Tool (Extended Mix)",
            trackId: "111"
          }
        ]
      });
      const browserSessionService = new BrowserSessionService({ workspaceRoot });
      const provider = createSoundCloudDirectDownloadsProvider({
        baseUrl: fixtureServer.origin,
        browserSessionService
      });

      try {
        await seedAuthenticatedSession(browserSessionService);

        const searchResult = await provider.search({
          track: canonicalizeTrack({
            artistName: "DJ Sealer",
            source: "spotify",
            title: "Warehouse Tool (Extended Mix)"
          })
        });

        expect(searchResult.outcome).toBe("candidates");
        if (searchResult.outcome !== "candidates") {
          throw new Error("Expected SoundCloud search to produce a candidate.");
        }

        const candidate = searchResult.candidates[0];
        const acquisition = await provider.acquire({
          candidate,
          track: canonicalizeTrack({
            artistName: "DJ Sealer",
            source: "spotify",
            title: "Warehouse Tool (Extended Mix)"
          })
        });

        expect(acquisition).toEqual({
          outcome: "acquired",
          candidate,
          artifact: {
            contentType: "audio/flac",
            fileExtension: "flac",
            fileName: "warehouse-tool.flac",
            format: "flac",
            sha256:
              "93d31421dcf5b0f8fc767062a4ed9241b3fe0b3774ea70589e95128a7b56b703",
            sizeBytes: 25
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
});

type AuthorizedDownloadFixture = {
  body: string;
  contentType: string;
  fileName: string;
};

type TrackFixture = {
  artistName: string;
  download: AuthorizedDownloadFixture | { kind: "disabled" } | { kind: "external"; externalUrl: string };
  durationSeconds: number;
  path: string;
  title: string;
  trackId: string;
};

async function seedAuthenticatedSession(browserSessionService: BrowserSessionService) {
  const session = await browserSessionService.openSession({
    sessionName: SOUNDCLOUD_DIRECT_DOWNLOADS_SESSION_NAME,
    authState: {
      authenticatedAt: "2026-03-31T05:00:00.000Z",
      providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
      status: "authenticated"
    }
  });

  await session.close();
}

function createUnusedBrowserSessionService() {
  return {
    async openSession() {
      throw new Error("Browser sessions should not be opened in registration tests.");
    },
    async requireAuthenticatedSession() {
      throw new Error(
        "Authenticated browser sessions should not be required in registration tests."
      );
    }
  };
}

async function startSoundCloudFixtureServer(input: {
  searchResults: string[];
  tracks: TrackFixture[];
}) {
  const trackFixtures = new Map(input.tracks.map((track) => [track.path, track]));
  const server = createServer((request, response) =>
    handleFixtureRequest(request, response, input.searchResults, trackFixtures)
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

  const origin = `http://127.0.0.1:${address.port}`;

  return {
    close: () => closeFixtureServer(server),
    origin
  };
}

function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
  searchResults: string[],
  trackFixtures: Map<string, TrackFixture>
) {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const trackFixture = trackFixtures.get(requestUrl.pathname);

  if (requestUrl.pathname === "/search/sounds") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="en">
  <body>
    <main>
      ${searchResults
        .map(
          (resultPath) =>
            `<article><a data-testid="soundcloud-track-link" href="${resultPath}">${resultPath}</a></article>`
        )
        .join("\n")}
    </main>
  </body>
</html>`);

    return;
  }

  if (trackFixture) {
    const host = request.headers.host ?? "127.0.0.1";
    const trackUrl = `http://${host}${trackFixture.path}`;
    const downloadMarkup =
      "fileName" in trackFixture.download
        ? `<a href="/downloads/${trackFixture.trackId}/${trackFixture.download.fileName}" download>Download file</a>`
        : trackFixture.download.kind === "external"
          ? `<a href="${trackFixture.download.externalUrl}" data-testid="external-download-link">External download</a>`
          : `<p>Downloads are not enabled on this track.</p>`;

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta property="og:title" content="${escapeHtml(trackFixture.title)}" />
    <meta property="og:url" content="${escapeHtml(trackUrl)}" />
    <meta name="soundcloud:track_id" content="${escapeHtml(trackFixture.trackId)}" />
    <meta name="soundcloud:artist_name" content="${escapeHtml(trackFixture.artistName)}" />
    <meta name="soundcloud:duration_seconds" content="${trackFixture.durationSeconds}" />
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "MusicRecording",
      byArtist: {
        "@type": "MusicGroup",
        name: trackFixture.artistName
      },
      duration: toIsoDuration(trackFixture.durationSeconds),
      identifier: trackFixture.trackId,
      name: trackFixture.title,
      url: trackUrl
    })}</script>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(trackFixture.title)}</h1>
      ${downloadMarkup}
    </main>
  </body>
</html>`);

    return;
  }

  const downloadMatch = requestUrl.pathname.match(/^\/downloads\/([^/]+)\/(.+)$/);

  if (downloadMatch) {
    const [, trackId, fileName] = downloadMatch;
    const matchingFixture = [...trackFixtures.values()].find(
      (fixture) =>
        fixture.trackId === trackId &&
        "fileName" in fixture.download &&
        fixture.download.fileName === fileName
    );

    if (matchingFixture && "fileName" in matchingFixture.download) {
      response.writeHead(200, {
        "content-disposition": `attachment; filename="${matchingFixture.download.fileName}"`,
        "content-type": matchingFixture.download.contentType
      });
      response.end(matchingFixture.download.body);

      return;
    }
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

function toIsoDuration(durationSeconds: number) {
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;

  return `PT${minutes}M${seconds}S`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
