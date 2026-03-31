import type { ReplaceRunTrackInput } from "@/features/runs/run-store";
import { canonicalizeTrack } from "@/features/tracks/canonical-track";

import { PlaylistIntakeError } from "./playlist-intake-error";

type FetchLike = typeof fetch;

type SoundCloudTrackPayload = {
  id?: number | string | null;
  metadata_artist?: string | null;
  title?: string | null;
  urn?: string | null;
  user?: {
    username?: string | null;
  } | null;
};

type SoundCloudPlaylistPayload = {
  kind?: string | null;
  permalink_url?: string | null;
  title?: string | null;
  tracks?: SoundCloudTrackPayload[] | null;
};

type SoundCloudTokenPayload = {
  access_token?: string;
};

type SoundCloudPlaylistSnapshot = {
  playlistTitle: string | null;
  playlistUrl: string;
  tracks: ReplaceRunTrackInput[];
};

type SoundCloudPlaylistDependencies = {
  apiBaseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: FetchLike;
  tokenUrl?: string;
};

const soundCloudHosts = new Set([
  "m.soundcloud.com",
  "soundcloud.com",
  "www.soundcloud.com"
]);

export function parseSoundCloudPlaylistUrl(playlistUrl: string) {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(playlistUrl);
  } catch {
    throw new PlaylistIntakeError("SoundCloud URL is invalid.", 400);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);

  if (!soundCloudHosts.has(hostname)) {
    throw new PlaylistIntakeError(
      "SoundCloud URL must use soundcloud.com playlist/set links.",
      400
    );
  }

  if (
    pathSegments.length !== 3 ||
    pathSegments[1] !== "sets" ||
    !pathSegments[0] ||
    !pathSegments[2]
  ) {
    throw new PlaylistIntakeError(
      "SoundCloud URL must point to a playlist set (for example /artist/sets/playlist-name).",
      400
    );
  }

  return new URL(
    `https://soundcloud.com/${pathSegments[0]}/sets/${pathSegments[2]}`
  );
}

export function mapSoundCloudPlaylistSnapshot(
  payload: SoundCloudPlaylistPayload,
  playlistUrl: string
): SoundCloudPlaylistSnapshot {
  if (payload.kind !== "playlist") {
    throw new PlaylistIntakeError(
      "SoundCloud URL did not resolve to a playlist.",
      502
    );
  }

  if (!Array.isArray(payload.tracks)) {
    throw new PlaylistIntakeError(
      "SoundCloud playlist response did not include track data.",
      502
    );
  }

  return {
    playlistTitle: cleanValue(payload.title),
    playlistUrl: cleanValue(payload.permalink_url) ?? playlistUrl,
    tracks: payload.tracks.map((track, index) => mapSoundCloudTrack(track, index))
  };
}

export async function fetchSoundCloudPlaylistSnapshot(
  playlistUrl: string,
  dependencies: SoundCloudPlaylistDependencies = {}
) {
  const normalizedPlaylistUrl = parseSoundCloudPlaylistUrl(playlistUrl).toString();
  const clientId = dependencies.clientId ?? process.env.SOUNDCLOUD_CLIENT_ID;
  const clientSecret =
    dependencies.clientSecret ?? process.env.SOUNDCLOUD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new PlaylistIntakeError(
      "SoundCloud ingestion requires SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET.",
      500
    );
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const accessToken = await fetchSoundCloudAccessToken({
    clientId,
    clientSecret,
    fetchImpl,
    tokenUrl:
      dependencies.tokenUrl ?? "https://secure.soundcloud.com/oauth/token"
  });
  const resolveUrl = new URL(
    "/resolve",
    dependencies.apiBaseUrl ?? "https://api.soundcloud.com"
  );

  resolveUrl.searchParams.set("url", normalizedPlaylistUrl);

  const response = await fetchImpl(resolveUrl, {
    headers: {
      Accept: "application/json; charset=utf-8",
      Authorization: `OAuth ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new PlaylistIntakeError(
      (await readErrorMessage(response)) ?? "SoundCloud playlist lookup failed.",
      502
    );
  }

  return mapSoundCloudPlaylistSnapshot(
    (await response.json()) as SoundCloudPlaylistPayload,
    normalizedPlaylistUrl
  );
}

async function fetchSoundCloudAccessToken(input: {
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
      (await readErrorMessage(response)) ?? "SoundCloud authentication failed.",
      502
    );
  }

  const payload = (await response.json()) as SoundCloudTokenPayload;

  if (!payload.access_token) {
    throw new PlaylistIntakeError(
      "SoundCloud authentication response did not include an access token.",
      502
    );
  }

  return payload.access_token;
}

function cleanValue(value: string | null | undefined) {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : null;
}

function mapSoundCloudTrack(
  track: SoundCloudTrackPayload,
  index: number
): ReplaceRunTrackInput {
  const rawTitle = cleanValue(track.title);

  if (!rawTitle) {
    throw new PlaylistIntakeError(
      `SoundCloud playlist track ${index + 1} is missing a title.`,
      502
    );
  }

  const explicitArtist = cleanValue(track.metadata_artist);
  const sourceTrackId = resolveSourceTrackId(track);
  const canonicalTrack = canonicalizeTrack({
    ...(explicitArtist ? { artistName: explicitArtist } : {}),
    source: "soundcloud",
    sourceTrackId: sourceTrackId ?? undefined,
    title: stripLeadingArtistPrefix(rawTitle, explicitArtist)
  });
  const artist =
    explicitArtist ??
    canonicalTrack.primaryArtist ??
    inferArtistFromTitle(rawTitle) ??
    cleanValue(track.user?.username);

  if (!artist) {
    throw new PlaylistIntakeError(
      `SoundCloud playlist track ${index + 1} is missing artist metadata.`,
      502
    );
  }

  return {
    artist,
    sourcePosition: index + 1,
    sourceTrackId,
    title: canonicalTrack.title,
    version: canonicalTrack.mix.displayLabel
  };
}

function inferArtistFromTitle(rawTitle: string) {
  const separatorIndex = rawTitle.search(/\s[-–—]\s/);

  if (separatorIndex < 0) {
    return null;
  }

  const artistSegment = rawTitle.slice(0, separatorIndex).trim();

  return artistSegment || null;
}

function stripLeadingArtistPrefix(rawTitle: string, artist: string | null) {
  if (!artist) {
    return rawTitle;
  }

  for (const separator of [" - ", " – ", " — "]) {
    const candidatePrefix = `${artist}${separator}`;

    if (rawTitle.toLowerCase().startsWith(candidatePrefix.toLowerCase())) {
      return rawTitle.slice(candidatePrefix.length);
    }
  }

  return rawTitle;
}

function resolveSourceTrackId(track: SoundCloudTrackPayload) {
  const urn = cleanValue(track.urn);

  if (urn) {
    return urn;
  }

  if (typeof track.id === "number") {
    return String(track.id);
  }

  return cleanValue(track.id);
}

async function readErrorMessage(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; error_description?: string }
      | null;

    return payload?.error_description ?? payload?.error ?? null;
  }

  const text = await response.text().catch(() => "");

  return text.trim() || null;
}
