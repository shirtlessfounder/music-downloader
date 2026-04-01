import type { ReplaceRunTrackInput } from "@/features/runs/run-store";
import { canonicalizeTrack } from "@/features/tracks/canonical-track";

import { PlaylistIntakeError } from "./playlist-intake-error";

type FetchLike = typeof fetch;

type SpotifyExternalUrlsPayload = {
  spotify?: string | null;
};

type SpotifyArtistPayload = {
  name?: string | null;
};

type SpotifyTrackPayload = {
  artists?: SpotifyArtistPayload[] | null;
  duration_ms?: number | null;
  external_urls?: SpotifyExternalUrlsPayload | null;
  id?: string | null;
  is_local?: boolean | null;
  name?: string | null;
  type?: string | null;
};

type SpotifyPlaylistPayload = {
  external_urls?: SpotifyExternalUrlsPayload | null;
  name?: string | null;
  type?: string | null;
};

type SpotifyPlaylistItemPayload = {
  track?: SpotifyTrackPayload | null;
};

type SpotifyPlaylistItemsPagePayload = {
  items?: SpotifyPlaylistItemPayload[] | null;
  next?: string | null;
};

type SpotifyTokenPayload = {
  access_token?: string;
  error?: string | { message?: string };
  error_description?: string;
};

type SpotifyPlaylistSnapshot = {
  playlistTitle: string | null;
  playlistUrl: string;
  tracks: ReplaceRunTrackInput[];
};

type SpotifyPlaylistDependencies = {
  apiBaseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: FetchLike;
  market?: string;
  tokenUrl?: string;
};

const spotifyHosts = new Set(["open.spotify.com", "play.spotify.com"]);
const spotifyPlaylistIdPattern = /^[A-Za-z0-9]{22}$/;

export function parseSpotifyPlaylistUrl(playlistUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(playlistUrl);
  } catch {
    throw new PlaylistIntakeError("Spotify URL is invalid.", 400);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
  const playlistSegmentIndex = pathSegments.lastIndexOf("playlist");
  const playlistId = pathSegments.at(-1);

  if (!spotifyHosts.has(hostname)) {
    throw new PlaylistIntakeError(
      "Spotify URL must use open.spotify.com playlist links.",
      400
    );
  }

  if (
    playlistSegmentIndex < 0 ||
    playlistSegmentIndex !== pathSegments.length - 2 ||
    !playlistId ||
    !spotifyPlaylistIdPattern.test(playlistId)
  ) {
    throw new PlaylistIntakeError(
      "Spotify URL must point to a playlist (for example /playlist/<playlist-id>).",
      400
    );
  }

  return new URL(`https://open.spotify.com/playlist/${playlistId}`);
}

export function mapSpotifyPlaylistSnapshot(
  playlist: SpotifyPlaylistPayload,
  itemPages: SpotifyPlaylistItemsPagePayload[],
  playlistUrl: string
): SpotifyPlaylistSnapshot {
  if (cleanValue(playlist.type) && cleanValue(playlist.type) !== "playlist") {
    throw new PlaylistIntakeError(
      "Spotify URL did not resolve to a playlist.",
      502
    );
  }

  const tracks: ReplaceRunTrackInput[] = [];

  for (const page of itemPages) {
    if (!Array.isArray(page.items)) {
      throw new PlaylistIntakeError(
        "Spotify playlist response did not include track data.",
        502
      );
    }

    for (const item of page.items) {
      tracks.push(mapSpotifyPlaylistItem(item, tracks.length));
    }
  }

  return {
    playlistTitle: cleanValue(playlist.name),
    playlistUrl: cleanValue(playlist.external_urls?.spotify) ?? playlistUrl,
    tracks
  };
}

export async function fetchSpotifyPlaylistSnapshot(
  playlistUrl: string,
  dependencies: SpotifyPlaylistDependencies = {}
) {
  const normalizedPlaylistUrl = parseSpotifyPlaylistUrl(playlistUrl).toString();
  const clientId = dependencies.clientId ?? process.env.SPOTIFY_CLIENT_ID;
  const clientSecret =
    dependencies.clientSecret ?? process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new PlaylistIntakeError(
      "Spotify ingestion requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.",
      500
    );
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const playlistId = normalizedPlaylistUrl.split("/").at(-1);

  if (!playlistId) {
    throw new PlaylistIntakeError("Spotify URL is invalid.", 400);
  }

  const accessToken = await fetchSpotifyAccessToken({
    clientId,
    clientSecret,
    fetchImpl,
    tokenUrl:
      dependencies.tokenUrl ?? "https://accounts.spotify.com/api/token"
  });
  const authorizationHeaders = {
    Accept: "application/json; charset=utf-8",
    Authorization: `Bearer ${accessToken}`
  };
  const apiBaseUrl = ensureTrailingSlash(
    dependencies.apiBaseUrl ?? "https://api.spotify.com/v1"
  );
  const market = resolveMarket(dependencies.market);

  const playlistResponse = await fetchImpl(
    new URL(`playlists/${playlistId}`, apiBaseUrl),
    { headers: authorizationHeaders }
  );

  if (!playlistResponse.ok) {
    throw new PlaylistIntakeError(
      (await readErrorMessage(playlistResponse)) ?? "Spotify playlist lookup failed.",
      502
    );
  }

  const itemPages: SpotifyPlaylistItemsPagePayload[] = [];
  const firstItemsUrl = new URL(`playlists/${playlistId}/items`, apiBaseUrl);

  firstItemsUrl.searchParams.set("limit", "50");
  firstItemsUrl.searchParams.set("market", market);

  let nextItemsUrl: string | null = firstItemsUrl.toString();

  while (nextItemsUrl) {
    const itemsResponse = await fetchImpl(nextItemsUrl, {
      headers: authorizationHeaders
    });

    if (!itemsResponse.ok) {
      throw new PlaylistIntakeError(
        (await readErrorMessage(itemsResponse)) ??
          "Spotify playlist tracks lookup failed.",
        502
      );
    }

    const itemPage = (await itemsResponse.json()) as SpotifyPlaylistItemsPagePayload;

    itemPages.push(itemPage);
    nextItemsUrl = cleanValue(itemPage.next);
  }

  return mapSpotifyPlaylistSnapshot(
    (await playlistResponse.json()) as SpotifyPlaylistPayload,
    itemPages,
    normalizedPlaylistUrl
  );
}

function mapSpotifyPlaylistItem(
  item: SpotifyPlaylistItemPayload,
  index: number
): ReplaceRunTrackInput {
  const track = item.track;
  const trackType = cleanValue(track?.type) ?? "track";

  if (!track || track.is_local || trackType !== "track") {
    throw new PlaylistIntakeError(
      `Spotify playlist item ${index + 1} is not a playable track.`,
      502
    );
  }

  const rawTitle = cleanValue(track.name);

  if (!rawTitle) {
    throw new PlaylistIntakeError(
      `Spotify playlist track ${index + 1} is missing a title.`,
      502
    );
  }

  const artistNames =
    track.artists?.flatMap((artist) => {
      const name = cleanValue(artist.name);

      return name ? [name] : [];
    }) ?? [];

  if (!artistNames.length) {
    throw new PlaylistIntakeError(
      `Spotify playlist track ${index + 1} is missing artist metadata.`,
      502
    );
  }

  const sourceTrackId = cleanValue(track.id);
  const canonicalTrack = canonicalizeTrack({
    artistNames,
    duration: track.duration_ms ?? null,
    source: "spotify",
    sourceTrackId: sourceTrackId ?? undefined,
    sourceUrl: cleanValue(track.external_urls?.spotify) ?? undefined,
    title: rawTitle
  });

  return {
    artist: canonicalTrack.primaryArtist ?? artistNames[0],
    sourcePosition: index + 1,
    sourceTrackId,
    title: canonicalTrack.title,
    version: canonicalTrack.mix.displayLabel
  };
}

async function fetchSpotifyAccessToken(input: {
  clientId: string;
  clientSecret: string;
  fetchImpl: FetchLike;
  tokenUrl: string;
}) {
  const response = await input.fetchImpl(input.tokenUrl, {
    body: new URLSearchParams({
      grant_type: "client_credentials"
    }).toString(),
    headers: {
      Accept: "application/json; charset=utf-8",
      Authorization: `Basic ${Buffer.from(
        `${input.clientId}:${input.clientSecret}`
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new PlaylistIntakeError(
      (await readErrorMessage(response)) ?? "Spotify authentication failed.",
      502
    );
  }

  const payload = (await response.json()) as SpotifyTokenPayload;

  if (!payload.access_token) {
    throw new PlaylistIntakeError(
      "Spotify authentication response did not include an access token.",
      502
    );
  }

  return payload.access_token;
}

function cleanValue(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : null;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function resolveMarket(marketOverride: string | undefined) {
  const configuredMarket = cleanValue(marketOverride ?? process.env.SPOTIFY_MARKET);

  return configuredMarket?.toUpperCase() ?? "US";
}

async function readErrorMessage(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string | { message?: string };
          error_description?: string;
          message?: string;
        }
      | null;

    if (!payload) {
      return null;
    }

    if (payload.error_description) {
      return payload.error_description;
    }

    if (typeof payload.error === "string") {
      return payload.error;
    }

    return payload.error?.message ?? payload.message ?? null;
  }

  const text = await response.text().catch(() => "");

  return text.trim() || null;
}
