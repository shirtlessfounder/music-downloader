/* @vitest-environment node */

import {
  mapSoundCloudPlaylistSnapshot,
  parseSoundCloudPlaylistUrl
} from "./soundcloud-playlist";

describe("parseSoundCloudPlaylistUrl", () => {
  it("normalizes supported SoundCloud set URLs", () => {
    const playlistUrl = parseSoundCloudPlaylistUrl(
      "https://m.soundcloud.com/dj-nova/sets/warehouse-finds?si=abc123#cue"
    );

    expect(playlistUrl.toString()).toBe(
      "https://soundcloud.com/dj-nova/sets/warehouse-finds"
    );
  });

  it("rejects non-playlist SoundCloud URLs with an explicit error", () => {
    expect(() =>
      parseSoundCloudPlaylistUrl("https://soundcloud.com/dj-nova/warehouse-tool")
    ).toThrowError(
      "SoundCloud URL must point to a playlist set (for example /artist/sets/playlist-name)."
    );
  });
});

describe("mapSoundCloudPlaylistSnapshot", () => {
  it("maps resolved playlist payloads into run-track inputs", () => {
    const snapshot = mapSoundCloudPlaylistSnapshot(
      {
        kind: "playlist",
        permalink_url: "https://soundcloud.com/dj-nova/sets/warehouse-finds",
        title: "Warehouse Finds",
        tracks: [
          {
            id: 111,
            metadata_artist: "DJ Sealer",
            title: "DJ Sealer - Warehouse Tool (Extended Mix) [Free DL]",
            urn: "soundcloud:tracks:111",
            user: {
              username: "dj-sealer"
            }
          },
          {
            id: 222,
            title: "Selector Two - Loft Shaker",
            user: {
              username: "selector-two"
            }
          }
        ]
      },
      "https://soundcloud.com/dj-nova/sets/warehouse-finds"
    );

    expect(snapshot).toEqual({
      playlistTitle: "Warehouse Finds",
      playlistUrl: "https://soundcloud.com/dj-nova/sets/warehouse-finds",
      tracks: [
        {
          artist: "DJ Sealer",
          sourcePosition: 1,
          sourceTrackId: "soundcloud:tracks:111",
          title: "Warehouse Tool",
          version: "Extended Mix"
        },
        {
          artist: "Selector Two",
          sourcePosition: 2,
          sourceTrackId: "222",
          title: "Loft Shaker",
          version: null
        }
      ]
    });
  });
});
