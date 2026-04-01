import {
  DEFAULT_TRACK_SELECTION_POLICY,
  buildMissDecision,
  canonicalizeTrack,
  evaluateTrackCandidate,
  extractMixMetadata,
  parseDurationSeconds
} from "./canonical-track";

describe("canonicalizeTrack", () => {
  it("normalizes Spotify-style metadata into one canonical shape", () => {
    const track = canonicalizeTrack({
      source: "spotify",
      sourceTrackId: "spotify-track-1",
      artistNames: ["Anyma", "Chris Avantgarde"],
      title: "Consciousness (Extended Mix)",
      duration: 391578
    });

    expect(track).toMatchObject({
      artistCredits: [
        { display: "Anyma", normalized: "anyma", role: "primary" },
        {
          display: "Chris Avantgarde",
          normalized: "chris avantgarde",
          role: "primary"
        }
      ],
      primaryArtist: "Anyma",
      normalizedArtistKey: "anyma chris avantgarde",
      title: "Consciousness",
      normalizedTitle: "consciousness",
      mix: {
        displayLabel: "Extended Mix",
        normalizedLabel: "extended mix",
        kind: "extended",
        selectionClass: "preferred",
        confidence: "high"
      },
      durationSeconds: 392,
      preferredFormats: DEFAULT_TRACK_SELECTION_POLICY.preferredFormats,
      availableFormats: [],
      provenance: {
        source: "spotify",
        sourceTrackId: "spotify-track-1",
        rawArtists: ["Anyma", "Chris Avantgarde"],
        rawTitle: "Consciousness (Extended Mix)",
        rawDuration: 391578
      }
    });
  });

  it("normalizes SoundCloud-style metadata, featured credits, and promotional tags", () => {
    const track = canonicalizeTrack({
      source: "soundcloud",
      sourceUrl: "https://soundcloud.com/example/revision",
      title:
        "Maceo Plex x Program 2 - Revision feat. Giovanni (Original Mix) [Free Download]",
      duration: "4:38"
    });

    expect(track).toMatchObject({
      artistCredits: [
        { display: "Maceo Plex", normalized: "maceo plex", role: "primary" },
        { display: "Program 2", normalized: "program 2", role: "primary" },
        { display: "Giovanni", normalized: "giovanni", role: "featured" }
      ],
      primaryArtist: "Maceo Plex",
      normalizedArtistKey: "maceo plex program 2",
      title: "Revision",
      normalizedTitle: "revision",
      mix: {
        displayLabel: "Original Mix",
        normalizedLabel: "original mix",
        kind: "original",
        selectionClass: "preferred",
        confidence: "high"
      },
      durationSeconds: 278,
      provenance: {
        source: "soundcloud",
        sourceUrl: "https://soundcloud.com/example/revision",
        rawArtists: ["Maceo Plex x Program 2"],
        rawTitle:
          "Maceo Plex x Program 2 - Revision feat. Giovanni (Original Mix) [Free Download]",
        rawDuration: "4:38"
      }
    });
  });

  it("marks versionless tracks as high-confidence fallback candidates", () => {
    const track = canonicalizeTrack({
      source: "spotify",
      artistNames: ["Tinlicker"],
      title: "Fractal",
      duration: "301"
    });

    expect(track.mix).toMatchObject({
      displayLabel: null,
      normalizedLabel: null,
      kind: "base",
      selectionClass: "fallback",
      confidence: "high"
    });
    expect(track.durationSeconds).toBe(301);
  });
});

describe("extractMixMetadata", () => {
  it("pulls out allowed and rejected mix labels", () => {
    expect(extractMixMetadata("Consciousness (Extended Mix)")).toMatchObject({
      cleanTitle: "Consciousness",
      displayLabel: "Extended Mix",
      kind: "extended",
      selectionClass: "preferred"
    });

    expect(extractMixMetadata("Cola (Radio Edit)")).toMatchObject({
      cleanTitle: "Cola",
      displayLabel: "Radio Edit",
      kind: "variant",
      selectionClass: "reject"
    });
  });

  it("keeps explicit non-approved trailing labels rejected after promotional tags are removed", () => {
    expect(extractMixMetadata("Consciousness (Live) [Free Download]")).toMatchObject({
      cleanTitle: "Consciousness",
      displayLabel: "Live",
      normalizedLabel: "live",
      kind: "variant",
      selectionClass: "reject"
    });
  });
});

describe("parseDurationSeconds", () => {
  it("handles milliseconds, numeric strings, and clock strings", () => {
    expect(parseDurationSeconds(391578)).toBe(392);
    expect(parseDurationSeconds("391578")).toBe(392);
    expect(parseDurationSeconds("301")).toBe(301);
    expect(parseDurationSeconds("4:38")).toBe(278);
  });
});

describe("evaluateTrackCandidate", () => {
  it("accepts eligible fallback candidates and picks the allowed format order", () => {
    const decision = evaluateTrackCandidate(
      canonicalizeTrack({
        source: "soundcloud",
        title: "Tinlicker - Fractal",
        duration: 301,
        availableFormats: ["wav"]
      })
    );

    expect(decision).toEqual({
      outcome: "accepted",
      reason: "accepted-base-version-fallback",
      selectedFormat: "wav",
      details: "Versionless track cleared the fallback duration threshold."
    });
  });

  it("rejects non-approved version labels with an explainable reason", () => {
    const decision = evaluateTrackCandidate(
      canonicalizeTrack({
        source: "spotify",
        artistNames: ["CamelPhat"],
        title: "Cola (Radio Edit)",
        duration: 250,
        availableFormats: ["mp3", "wav"]
      })
    );

    expect(decision).toEqual({
      outcome: "rejected",
      reason: "mix-version-not-eligible",
      selectedFormat: "mp3",
      details: "Radio Edit is outside the approved mix preference order."
    });
  });

  it("does not treat explicit labeled variants as eligible base fallbacks", () => {
    const decision = evaluateTrackCandidate(
      canonicalizeTrack({
        source: "soundcloud",
        title: "Tinlicker - Fractal (Live)",
        duration: 301,
        availableFormats: ["mp3", "wav"]
      })
    );

    expect(decision).toEqual({
      outcome: "rejected",
      reason: "mix-version-not-eligible",
      selectedFormat: "mp3",
      details: "Live is outside the approved mix preference order."
    });
  });
});

describe("buildMissDecision", () => {
  it("keeps miss outcomes distinct from rejected candidates", () => {
    expect(buildMissDecision("no-eligible-candidate")).toEqual({
      outcome: "miss",
      reason: "no-eligible-candidate",
      selectedFormat: null,
      details: "No supported candidate met the selection rules."
    });
  });
});
