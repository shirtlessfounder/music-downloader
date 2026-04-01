/* @vitest-environment node */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { URLSearchParams } from "node:url";

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
  SOUNDCLOUDDL_PROVIDER_ID,
  SOUNDCLOUDDL_PROVIDER_NAME,
  createSoundCloudDLProvider
} from "./soundclouddl";

describe("createSoundCloudDLProvider", () => {
  it("registers between SoundCloud direct downloads and Bandcamp", () => {
    const registry = new ProviderRegistry([
      defineReviewQueueProvider({
        id: "beatport",
        displayName: "Beatport",
        sourceBasis: "purchase-entitlement",
        priorityRank: 90,
        supportedFormats: ["mp3", "wav", "aiff"],
        search: async () =>
          buildProviderMissResult({
            detail: "No Beatport review candidate matched this track.",
            providerId: "beatport",
            providerName: "Beatport",
            reason: "no-search-results",
            trackMissReason: "no-supported-source-match"
          }),
        acquirePurchased: async ({ candidate }) =>
          buildProviderRejectedResult({
            candidate,
            detail: "Fixture provider is not wired to acquire owned downloads in tests.",
            providerId: "beatport",
            providerName: "Beatport",
            reason: "provider-error"
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
        sourceBasis: "rights-holder-storefront",
        priceTier: "free-or-owned",
        priorityRank: 20,
        supportedFormats: ["mp3", "wav", "flac"],
        search: async () =>
          buildProviderMissResult({
            detail: "No Bandcamp result matched this track.",
            providerId: "bandcamp",
            providerName: "Bandcamp",
            reason: "no-search-results",
            trackMissReason: "no-supported-source-match"
          }),
        acquire: async ({ candidate }) =>
          buildProviderRejectedResult({
            candidate,
            detail: "Fixture provider is not wired to acquire assets in tests.",
            providerId: "bandcamp",
            providerName: "Bandcamp",
            reason: "provider-error"
          })
      }),
      defineAutomaticProvider({
        id: "soundcloud-direct-downloads",
        displayName: "SoundCloud Direct Downloads",
        sourceBasis: "uploader-enabled-download",
        priceTier: "free",
        priorityRank: 10,
        supportedFormats: ["original-upload-format"],
        search: async () =>
          buildProviderMissResult({
            detail: "No direct SoundCloud download matched this track.",
            providerId: "soundcloud-direct-downloads",
            providerName: "SoundCloud Direct Downloads",
            reason: "no-supported-candidate",
            trackMissReason: "no-supported-source-match"
          }),
        acquire: async ({ candidate }) =>
          buildProviderRejectedResult({
            candidate,
            detail: "Fixture provider is not wired to acquire assets in tests.",
            providerId: "soundcloud-direct-downloads",
            providerName: "SoundCloud Direct Downloads",
            reason: "provider-error"
          })
      }),
      createSoundCloudDLProvider({
        browserSessionService: createUnusedBrowserSessionService()
      })
    ]);

    expect(registry.list().map((provider) => provider.id)).toEqual([
      "soundcloud-direct-downloads",
      SOUNDCLOUDDL_PROVIDER_ID,
      "bandcamp",
      "beatport"
    ]);
    expect(registry.get(SOUNDCLOUDDL_PROVIDER_ID)).toEqual(
      expect.objectContaining({
        displayName: SOUNDCLOUDDL_PROVIDER_NAME,
        id: SOUNDCLOUDDL_PROVIDER_ID,
        implementationBucket: "free-auto",
        mode: "automatic",
        priceTier: "free",
        priorityRank: 15,
        sourceBasis: "uploader-enabled-download",
        supportedFormats: ["mp3"]
      })
    );
  });

  it("searches SoundCloud query variants and returns matcher-eligible MP3 candidates", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-soundclouddl-provider-search-")
    );
    const fixtureServer = await startSoundCloudDLFixtureServer({
      searchResponses: {
        "DJ Sealer Warehouse Tool Extended Mix": [
          "/dj-sealer/warehouse-tool-extended-mix",
          "/dj-sealer/warehouse-tool-live"
        ]
      },
      tracks: [
        {
          artistName: "DJ Sealer",
          durationSeconds: 392,
          path: "/dj-sealer/warehouse-tool-extended-mix",
          title: "Warehouse Tool (Extended Mix)",
          trackId: "111"
        },
        {
          artistName: "DJ Sealer",
          durationSeconds: 390,
          path: "/dj-sealer/warehouse-tool-live",
          title: "Warehouse Tool (Live)",
          trackId: "112"
        }
      ]
    });
    const browserSessionService = new BrowserSessionService({ workspaceRoot });
    const provider = createSoundCloudDLProvider({
      browserSessionService,
      converterBaseUrl: `${fixtureServer.origin}/soundclouddl`,
      soundCloudBaseUrl: fixtureServer.origin
    });

    try {
      const track = canonicalizeTrack({
        artistName: "DJ Sealer",
        source: "spotify",
        title: "Warehouse Tool"
      });

      const result = await provider.search({ track });

      expect(fixtureServer.observedQueries).toEqual([
        "DJ Sealer Warehouse Tool Extended Mix"
      ]);
      expect(result).toEqual({
        outcome: "candidates",
        candidates: [
          {
            artistName: "DJ Sealer",
            availableFormats: ["mp3"],
            candidateId: "111",
            durationSeconds: 392,
            mixConfidence: "high",
            mixLabel: "Extended Mix",
            priceTier: "free",
            providerId: SOUNDCLOUDDL_PROVIDER_ID,
            providerName: SOUNDCLOUDDL_PROVIDER_NAME,
            provenance: {
              discoveredVia: "search",
              providerTrackId: "111",
              providerUrl: `${fixtureServer.origin}/dj-sealer/warehouse-tool-extended-mix`,
              searchQuery: "DJ Sealer Warehouse Tool Extended Mix",
              sourcePageUrl: `${fixtureServer.origin}/dj-sealer/warehouse-tool-extended-mix`
            },
            sourceBasis: "uploader-enabled-download",
            title: "Warehouse Tool"
          }
        ]
      });

      if (result.outcome !== "candidates") {
        throw new Error("Expected SoundCloudDL search to return provider candidates.");
      }

      expect(
        matchTrackCandidates({
          candidates: result.candidates,
          track
        })
      ).toMatchObject({
        outcome: "selected",
        selected: {
          candidate: {
            candidateId: "111"
          },
          reason: "accepted-extended-mix",
          selectedFormat: "mp3"
        }
      });
    } finally {
      await browserSessionService.shutdown();
      await fixtureServer.close();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("downloads an MP3 through the converter surface", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "music-downloader-soundclouddl-provider-acquire-")
    );
    const fixtureServer = await startSoundCloudDLFixtureServer({
      conversions: {
        "http://127.0.0.1/source-track": {
          body: "fixture mp3 payload\n",
          fileName: "warehouse-tool.mp3"
        }
      },
      searchResponses: {},
      tracks: []
    });
    const browserSessionService = new BrowserSessionService({ workspaceRoot });
    const provider = createSoundCloudDLProvider({
      browserSessionService,
      converterBaseUrl: `${fixtureServer.origin}/soundclouddl`,
      soundCloudBaseUrl: fixtureServer.origin
    });
    const track = canonicalizeTrack({
      artistName: "DJ Sealer",
      source: "spotify",
      title: "Warehouse Tool (Extended Mix)"
    });
    const candidate: ProviderCandidate = {
      artistName: "DJ Sealer",
      availableFormats: ["mp3"],
      candidateId: "111",
      durationSeconds: 392,
      mixConfidence: "high",
      mixLabel: "Extended Mix",
      priceTier: "free",
      providerId: SOUNDCLOUDDL_PROVIDER_ID,
      providerName: SOUNDCLOUDDL_PROVIDER_NAME,
      provenance: {
        discoveredVia: "search",
        providerTrackId: "111",
        providerUrl: "http://127.0.0.1/source-track",
        searchQuery: "DJ Sealer Warehouse Tool Extended Mix",
        sourcePageUrl: "http://127.0.0.1/source-track"
      },
      sourceBasis: "uploader-enabled-download",
      title: "Warehouse Tool"
    };

    try {
      const result = await provider.acquire({ candidate, track });

      expect(result).toMatchObject({
        outcome: "acquired",
        artifact: {
          contentType: "audio/mpeg",
          fileExtension: "mp3",
          fileName: "warehouse-tool.mp3",
          format: "mp3"
        },
        candidate
      });

      if (result.outcome !== "acquired") {
        throw new Error("Expected SoundCloudDL acquisition to succeed.");
      }

      await expect(readFile(result.artifact.localFilePath, "utf8")).resolves.toBe(
        "fixture mp3 payload\n"
      );
    } finally {
      await browserSessionService.shutdown();
      await fixtureServer.close();
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});

function createUnusedBrowserSessionService() {
  return {
    async openSession() {
      throw new Error("Browser sessions should not be opened in registration tests.");
    }
  };
}

type TrackFixture = {
  artistName: string;
  durationSeconds: number;
  path: string;
  title: string;
  trackId: string;
};

type ConversionFixture = {
  body: string;
  fileName: string;
};

async function startSoundCloudDLFixtureServer(input: {
  conversions?: Record<string, ConversionFixture>;
  searchResponses: Record<string, string[]>;
  tracks: TrackFixture[];
}) {
  const observedQueries: string[] = [];
  const trackFixtures = new Map(input.tracks.map((track) => [track.path, track]));
  const conversionFixtures = new Map(Object.entries(input.conversions ?? {}));
  const server = createServer((request, response) =>
    handleFixtureRequest({
      conversionFixtures,
      observedQueries,
      request,
      response,
      searchResponses: input.searchResponses,
      trackFixtures
    })
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
    close: () => closeFixtureServer(server),
    observedQueries,
    origin: `http://127.0.0.1:${address.port}`
  };
}

async function handleFixtureRequest(input: {
  conversionFixtures: Map<string, ConversionFixture>;
  observedQueries: string[];
  request: IncomingMessage;
  response: ServerResponse;
  searchResponses: Record<string, string[]>;
  trackFixtures: Map<string, TrackFixture>;
}) {
  const requestUrl = new URL(input.request.url ?? "/", "http://127.0.0.1");
  const trackFixture = input.trackFixtures.get(requestUrl.pathname);

  if (requestUrl.pathname === "/search/sounds") {
    const query = requestUrl.searchParams.get("q") ?? "";
    input.observedQueries.push(query);

    input.response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    input.response.end(`<!doctype html>
<html lang="en">
  <body>
    <main>
      ${(input.searchResponses[query] ?? [])
        .map(
          (resultPath) =>
            `<article><a data-testid="soundcloud-track-link" href="${resultPath}">${escapeHtml(resultPath)}</a></article>`
        )
        .join("\n")}
    </main>
  </body>
</html>`);

    return;
  }

  if (trackFixture) {
    const host = input.request.headers.host ?? "127.0.0.1";
    const trackUrl = `http://${host}${trackFixture.path}`;

    input.response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    input.response.end(`<!doctype html>
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
    </main>
  </body>
</html>`);

    return;
  }

  if (requestUrl.pathname === "/soundclouddl") {
    input.response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    input.response.end(`<!doctype html>
<html lang="en">
  <body>
    <form action="/convertAudio" method="post">
      <input name="url" type="text" />
      <select name="format">
        <option value="MP3">MP3</option>
        <option value="M4A">M4A</option>
      </select>
      <button type="submit">Convert</button>
    </form>
  </body>
</html>`);

    return;
  }

  if (requestUrl.pathname === "/convertAudio" && input.request.method === "POST") {
    const body = await readRequestBody(input.request);
    const params = new URLSearchParams(body);
    const sourceUrl = params.get("url") ?? "";
    const format = params.get("format") ?? "";
    const conversion = input.conversionFixtures.get(sourceUrl);

    input.response.writeHead(200, { "content-type": "text/html; charset=utf-8" });

    if (!conversion || format.toUpperCase() !== "MP3") {
      input.response.end("<!doctype html><html lang=\"en\"><body><p>No conversion</p></body></html>");
      return;
    }

    input.response.end(`<!doctype html>
<html lang="en">
  <body>
    <a download href="/converted/${encodeURIComponent(conversion.fileName)}">Download MP3</a>
  </body>
</html>`);

    return;
  }

  const convertedMatch = requestUrl.pathname.match(/^\/converted\/(.+)$/);

  if (convertedMatch) {
    const fileName = decodeURIComponent(convertedMatch[1]);
    const conversion = [...input.conversionFixtures.values()].find(
      (fixture) => fixture.fileName === fileName
    );

    if (conversion) {
      input.response.writeHead(200, {
        "content-disposition": `attachment; filename="${conversion.fileName}"`,
        "content-type": "audio/mpeg"
      });
      input.response.end(conversion.body);
      return;
    }
  }

  input.response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  input.response.end("Not found");
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toIsoDuration(durationSeconds: number) {
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const seconds = durationSeconds % 60;

  return `PT${hours > 0 ? `${hours}H` : ""}${minutes > 0 ? `${minutes}M` : ""}${seconds}S`;
}
