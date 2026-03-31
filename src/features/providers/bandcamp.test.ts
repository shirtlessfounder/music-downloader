/* @vitest-environment node */

import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BrowserSessionService } from "@/features/browser/browser-session-service";
import { matchTrackCandidates } from "@/features/matching/track-matcher";
import { canonicalizeTrack } from "@/features/tracks/canonical-track";

import {
  ProviderRegistry,
  buildProviderMissResult,
  buildProviderRejectedResult,
  defineAutomaticProvider,
  defineReviewQueueProvider,
  type ProviderCandidate
} from "./provider-registry";
import {
  BANDCAMP_PROVIDER_ID,
  BANDCAMP_PROVIDER_NAME,
  BANDCAMP_SESSION_NAME,
  createBandcampProvider
} from "./bandcamp";

describe("createBandcampProvider", () => {
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
        id: "soundcloud-direct-downloads",
        displayName: "SoundCloud Direct Downloads",
        authorizationBasis: "uploader-enabled-download",
        priceTier: "free",
        priorityRank: 10,
        supportedFormats: ["original-upload-format"],
        search: async () =>
          buildProviderMissResult({
            detail: "No SoundCloud direct download is available for the requested track.",
            providerId: "soundcloud-direct-downloads",
            providerName: "SoundCloud Direct Downloads",
            reason: "no-authorized-candidate",
            trackMissReason: "no-authorized-source-match"
          }),
        acquire: async ({ candidate }) =>
          buildProviderRejectedResult({
            candidate,
            detail: "Fixture provider does not acquire assets in this test.",
            providerId: "soundcloud-direct-downloads",
            providerName: "SoundCloud Direct Downloads",
            reason: "provider-error"
          })
      }),
      createBandcampProvider({
        browserSessionService: createUnusedBrowserSessionService()
      })
    ]);

    expect(registry.list().map((provider) => provider.id)).toEqual([
      "soundcloud-direct-downloads",
      BANDCAMP_PROVIDER_ID,
      "beatport"
    ]);

    const provider = registry.get(BANDCAMP_PROVIDER_ID);

    expect(provider).toEqual(
      expect.objectContaining({
        authorizationBasis: "rights-holder-storefront",
        displayName: BANDCAMP_PROVIDER_NAME,
        id: BANDCAMP_PROVIDER_ID,
        implementationBucket: "free-auto",
        mode: "automatic",
        priceTier: "free-or-owned",
        priorityRank: 20,
        supportedFormats: ["mp3", "wav", "aiff", "flac", "aac", "ogg-vorbis", "alac"]
      })
    );
  });

  it(
    "returns an entitled candidate and acquires the preferred Bandcamp download with normalized metadata",
    async () => {
      const workspaceRoot = await mkdtemp(
        path.join(os.tmpdir(), "music-downloader-bandcamp-provider-")
      );
      const fixtureServer = await startBandcampFixtureServer({
        releases: [
          {
            artistName: "DJ Sealer",
            downloadOptions: [
              {
                body: "mp3 v0 fixture payload\n",
                contentType: "audio/mpeg",
                fileName: "warehouse-tool--v0.mp3",
                formatKey: "mp3-v0",
                label: "MP3 V0"
              },
              {
                body: "mp3 320 fixture payload\n",
                contentType: "audio/mpeg",
                fileName: "warehouse-tool--320.mp3",
                formatKey: "mp3-320",
                label: "MP3 320"
              },
              {
                body: "wav fixture payload\n",
                contentType: "audio/wav",
                fileName: "warehouse-tool.wav",
                formatKey: "wav",
                label: "WAV"
              },
              {
                body: "flac fixture payload\n",
                contentType: "audio/flac",
                fileName: "warehouse-tool.flac",
                formatKey: "flac",
                label: "FLAC"
              }
            ],
            durationSeconds: 392,
            entitlement: "owned",
            path: "/album/warehouse-tool-extended-mix",
            title: "Warehouse Tool (Extended Mix)",
            trackId: "bandcamp-track-111"
          }
        ],
        searchResults: ["/album/warehouse-tool-extended-mix"]
      });
      const browserSessionService = new BrowserSessionService({ workspaceRoot });
      const provider = createBandcampProvider({
        baseUrl: fixtureServer.origin,
        browserSessionService
      });

      try {
        await seedAuthenticatedSession(browserSessionService);
        const track = canonicalizeTrack({
          artistName: "DJ Sealer",
          source: "spotify",
          title: "Warehouse Tool (Extended Mix)"
        });

        const searchResult = await provider.search({ track });

        expect(searchResult).toEqual({
          outcome: "candidates",
          candidates: [
            {
              artistName: "DJ Sealer",
              authorizationBasis: "rights-holder-storefront",
              availableFormats: ["mp3", "wav", "flac"],
              candidateId: "bandcamp-track-111",
              durationSeconds: 392,
              mixConfidence: "high",
              mixLabel: "Extended Mix",
              priceTier: "free-or-owned",
              providerId: BANDCAMP_PROVIDER_ID,
              providerName: BANDCAMP_PROVIDER_NAME,
              provenance: {
                discoveredVia: "search",
                providerTrackId: "bandcamp-track-111",
                providerUrl: `${fixtureServer.origin}/album/warehouse-tool-extended-mix`,
                searchQuery: "DJ Sealer Warehouse Tool Extended Mix",
                sourcePageUrl: `${fixtureServer.origin}/album/warehouse-tool-extended-mix`
              },
              title: "Warehouse Tool"
            }
          ]
        });

        if (searchResult.outcome !== "candidates") {
          throw new Error("Expected Bandcamp search to produce a candidate.");
        }

        expect(
          matchTrackCandidates({
            candidates: searchResult.candidates,
            track
          })
        ).toMatchObject({
          outcome: "selected",
          rejected: [],
          selected: {
            candidate: {
              candidateId: "bandcamp-track-111"
            },
            reason: "accepted-extended-mix",
            selectedFormat: "mp3"
          }
        });

        const acquisition = await provider.acquire({
          candidate: searchResult.candidates[0],
          track
        });

        expect(acquisition).toEqual({
          outcome: "acquired",
          candidate: searchResult.candidates[0],
          artifact: {
            contentType: "audio/mpeg",
            fileExtension: "mp3",
            fileName: "warehouse-tool--320.mp3",
            format: "mp3",
            sha256: createHash("sha256")
              .update("mp3 320 fixture payload\n")
              .digest("hex"),
            sizeBytes: Buffer.byteLength("mp3 320 fixture payload\n")
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

  it("returns a structured miss when the matching release still requires payment", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-bandcamp-provider-paid-")
    );
    const fixtureServer = await startBandcampFixtureServer({
      releases: [
        {
          artistName: "DJ Sealer",
          downloadOptions: [],
          durationSeconds: 392,
          entitlement: "paid-only",
          path: "/album/warehouse-tool-extended-mix",
          title: "Warehouse Tool (Extended Mix)",
          trackId: "bandcamp-track-111"
        }
      ],
      searchResults: ["/album/warehouse-tool-extended-mix"]
    });
    const browserSessionService = new BrowserSessionService({ workspaceRoot });
    const provider = createBandcampProvider({
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

      expect(searchResult).toEqual({
        outcome: "miss",
        miss: expect.objectContaining({
          providerId: BANDCAMP_PROVIDER_ID,
          providerName: BANDCAMP_PROVIDER_NAME,
          reason: "no-authorized-candidate",
          trackMissReason: "no-authorized-source-match"
        })
      });

      if (searchResult.outcome !== "miss") {
        throw new Error("Expected a Bandcamp provider miss for a paid-only release.");
      }

      expect(searchResult.miss.detail).toMatch(/paid checkout|free-or-owned/i);
    } finally {
      await browserSessionService.shutdown();
      await fixtureServer.close();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("rejects acquisition when a candidate is no longer entitled for download", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-bandcamp-provider-entitlement-")
    );
    const fixtureServer = await startBandcampFixtureServer({
      releases: [
        {
          artistName: "DJ Sealer",
          downloadOptions: [],
          durationSeconds: 392,
          entitlement: "paid-only",
          path: "/album/warehouse-tool-extended-mix",
          title: "Warehouse Tool (Extended Mix)",
          trackId: "bandcamp-track-111"
        }
      ],
      searchResults: ["/album/warehouse-tool-extended-mix"]
    });
    const browserSessionService = new BrowserSessionService({ workspaceRoot });
    const provider = createBandcampProvider({
      baseUrl: fixtureServer.origin,
      browserSessionService
    });
    const track = canonicalizeTrack({
      artistName: "DJ Sealer",
      source: "spotify",
      title: "Warehouse Tool (Extended Mix)"
    });
    const candidate: ProviderCandidate = {
      artistName: "DJ Sealer",
      authorizationBasis: "rights-holder-storefront",
      availableFormats: ["mp3", "wav"],
      candidateId: "bandcamp-track-111",
      durationSeconds: 392,
      mixConfidence: "high",
      mixLabel: "Extended Mix",
      priceTier: "free-or-owned",
      providerId: BANDCAMP_PROVIDER_ID,
      providerName: BANDCAMP_PROVIDER_NAME,
      provenance: {
        discoveredVia: "search",
        providerTrackId: "bandcamp-track-111",
        providerUrl: `${fixtureServer.origin}/album/warehouse-tool-extended-mix`,
        searchQuery: "DJ Sealer Warehouse Tool Extended Mix",
        sourcePageUrl: `${fixtureServer.origin}/album/warehouse-tool-extended-mix`
      },
      title: "Warehouse Tool"
    };

    try {
      await seedAuthenticatedSession(browserSessionService);

      await expect(provider.acquire({ candidate, track })).resolves.toEqual({
        outcome: "rejected",
        candidate,
        rejection: {
          detail:
            "Bandcamp candidate is no longer entitled for automatic free-or-owned download acquisition.",
          providerId: BANDCAMP_PROVIDER_ID,
          providerName: BANDCAMP_PROVIDER_NAME,
          reason: "no-download-entitlement",
          retryable: false,
          trackDecisionReason: undefined
        }
      });
    } finally {
      await browserSessionService.shutdown();
      await fixtureServer.close();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("maps missing and expired browser sessions to structured rejections", async () => {
    const missingWorkspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-bandcamp-provider-auth-")
    );
    const expiredWorkspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-bandcamp-provider-expired-")
    );
    const fixtureServer = await startBandcampFixtureServer({
      releases: [],
      searchResults: []
    });
    const missingBrowserSessionService = new BrowserSessionService({
      workspaceRoot: missingWorkspaceRoot
    });
    const expiredBrowserSessionService = new BrowserSessionService({
      workspaceRoot: expiredWorkspaceRoot
    });

    try {
      const expiredSession = await expiredBrowserSessionService.openSession({
        sessionName: BANDCAMP_SESSION_NAME,
        authState: {
          expiredAt: "2026-03-31T05:00:00.000Z",
          providerId: BANDCAMP_PROVIDER_ID,
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
        createBandcampProvider({
          baseUrl: fixtureServer.origin,
          browserSessionService: missingBrowserSessionService
        }).search({ track })
      ).resolves.toEqual({
        outcome: "rejected",
        rejection: {
          detail:
            "An authenticated Bandcamp browser session is required before automatic downloads can run.",
          providerId: BANDCAMP_PROVIDER_ID,
          providerName: BANDCAMP_PROVIDER_NAME,
          reason: "auth-required",
          retryable: true,
          trackDecisionReason: undefined
        }
      });

      await expect(
        createBandcampProvider({
          baseUrl: fixtureServer.origin,
          browserSessionService: expiredBrowserSessionService
        }).search({ track })
      ).resolves.toEqual({
        outcome: "rejected",
        rejection: {
          detail:
            "The Bandcamp browser session expired and must be refreshed before automatic downloads can run.",
          providerId: BANDCAMP_PROVIDER_ID,
          providerName: BANDCAMP_PROVIDER_NAME,
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
});

type ReleaseEntitlement =
  | "free"
  | "no-minimum"
  | "redeemable"
  | "owned"
  | "paid-only";

type DownloadOptionFixture = {
  body: string;
  contentType: string;
  fileName: string;
  formatKey: string;
  label: string;
};

type ReleaseFixture = {
  artistName: string;
  downloadOptions: DownloadOptionFixture[];
  durationSeconds: number;
  entitlement: ReleaseEntitlement;
  path: string;
  title: string;
  trackId: string;
};

async function seedAuthenticatedSession(browserSessionService: BrowserSessionService) {
  const session = await browserSessionService.openSession({
    sessionName: BANDCAMP_SESSION_NAME,
    authState: {
      authenticatedAt: "2026-03-31T05:00:00.000Z",
      providerId: BANDCAMP_PROVIDER_ID,
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

async function startBandcampFixtureServer(input: {
  releases: ReleaseFixture[];
  searchResults: string[];
}) {
  const releaseFixtures = new Map(input.releases.map((release) => [release.path, release]));
  const server = createServer((request, response) =>
    handleFixtureRequest(request, response, input.searchResults, releaseFixtures)
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
  releaseFixtures: Map<string, ReleaseFixture>
) {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  const releaseFixture = releaseFixtures.get(requestUrl.pathname);

  if (requestUrl.pathname === "/search") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="en">
  <body>
    <main>
      ${searchResults
        .map(
          (resultPath) =>
            `<article><a data-testid="bandcamp-search-result" href="${resultPath}">${resultPath}</a></article>`
        )
        .join("\n")}
    </main>
  </body>
</html>`);

    return;
  }

  if (releaseFixture) {
    const host = request.headers.host ?? "127.0.0.1";
    const releaseUrl = `http://${host}${releaseFixture.path}`;
    const downloadMarkup =
      releaseFixture.downloadOptions.length > 0
        ? releaseFixture.downloadOptions
            .map(
              (downloadOption) =>
                `<a data-testid="bandcamp-download-link" data-entitlement="${releaseFixture.entitlement}" data-format-key="${escapeHtml(downloadOption.formatKey)}" href="/downloads/${releaseFixture.trackId}/${escapeHtml(downloadOption.fileName)}" download="${escapeHtml(downloadOption.fileName)}" type="${escapeHtml(downloadOption.contentType)}">${escapeHtml(downloadOption.label)}</a>`
            )
            .join("\n")
        : `<p data-testid="bandcamp-paid-message">Paid checkout required for this release.</p>`;

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta property="og:title" content="${escapeHtml(releaseFixture.title)}" />
    <meta property="og:url" content="${escapeHtml(releaseUrl)}" />
    <meta name="bandcamp:artist_name" content="${escapeHtml(releaseFixture.artistName)}" />
    <meta name="bandcamp:track_id" content="${escapeHtml(releaseFixture.trackId)}" />
    <meta name="bandcamp:duration_seconds" content="${releaseFixture.durationSeconds}" />
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "MusicRecording",
      byArtist: {
        "@type": "MusicGroup",
        name: releaseFixture.artistName
      },
      duration: toIsoDuration(releaseFixture.durationSeconds),
      identifier: releaseFixture.trackId,
      name: releaseFixture.title,
      url: releaseUrl
    })}</script>
  </head>
  <body>
    <main
      data-testid="bandcamp-release"
      data-bandcamp-entitlement="${escapeHtml(releaseFixture.entitlement)}"
    >
      <h1>${escapeHtml(releaseFixture.title)}</h1>
      <p data-testid="bandcamp-artist-name">${escapeHtml(releaseFixture.artistName)}</p>
      <p data-testid="bandcamp-entitlement">${escapeHtml(releaseFixture.entitlement)}</p>
      <section data-testid="bandcamp-downloads">
        ${downloadMarkup}
      </section>
    </main>
  </body>
</html>`);

    return;
  }

  const downloadMatch = requestUrl.pathname.match(/^\/downloads\/([^/]+)\/(.+)$/);

  if (downloadMatch) {
    const [, trackId, fileName] = downloadMatch;
    const matchingFixture = [...releaseFixtures.values()].find(
      (fixture) =>
        fixture.trackId === trackId &&
        fixture.downloadOptions.some((downloadOption) => downloadOption.fileName === fileName)
    );

    if (matchingFixture) {
      const downloadOption = matchingFixture.downloadOptions.find(
        (option) => option.fileName === fileName
      );

      if (downloadOption) {
        response.writeHead(200, {
          "content-disposition": `attachment; filename="${downloadOption.fileName}"`,
          "content-type": downloadOption.contentType
        });
        response.end(downloadOption.body);

        return;
      }
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
