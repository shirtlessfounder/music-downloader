/* @vitest-environment node */

import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { createRunStore } from "@/features/runs/run-store";

import {
  buildAcquiredArtifactSourceNote,
  buildMissedArtifactSourceNote,
  generateRunArtifacts
} from "./run-artifacts";

function createTempWorkspace() {
  const workspaceRoot = mkdtempSync(
    path.join(tmpdir(), "music-downloader-run-artifacts-")
  );

  return {
    databasePath: path.join(workspaceRoot, "data", "music-downloader.sqlite"),
    cleanup() {
      rmSync(workspaceRoot, { force: true, recursive: true });
    },
    workspaceRoot
  };
}

function createSha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readStoredZipEntries(zipFilePath: string) {
  const bytes = readFileSync(zipFilePath);
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const signature = bytes.readUInt32LE(offset);

    if (signature === 0x02014b50 || signature === 0x06054b50) {
      break;
    }

    if (signature !== 0x04034b50) {
      throw new Error(`Unexpected ZIP signature ${signature.toString(16)} at ${offset}`);
    }

    const compressionMethod = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 18);
    const fileNameLength = bytes.readUInt16LE(offset + 26);
    const extraFieldLength = bytes.readUInt16LE(offset + 28);
    const fileName = bytes
      .subarray(offset + 30, offset + 30 + fileNameLength)
      .toString("utf8");
    const fileDataStart = offset + 30 + fileNameLength + extraFieldLength;
    const fileDataEnd = fileDataStart + compressedSize;

    if (compressionMethod !== 0) {
      throw new Error(`Expected stored ZIP entry for ${fileName}.`);
    }

    entries.set(fileName, bytes.subarray(fileDataStart, fileDataEnd));
    offset = fileDataEnd;
  }

  return entries;
}

describe("generateRunArtifacts", () => {
  it("packages rejected Beatport reviews once the rejection persists a miss note", async () => {
    const tempWorkspace = createTempWorkspace();
    const store = createRunStore({ databasePath: tempWorkspace.databasePath });

    try {
      const run = store.createRun({
        playlistTitle: "Rejected Beatport Candidate",
        playlistUrl: "https://soundcloud.com/sets/rejected-beatport-candidate",
        sourceType: "soundcloud"
      });
      const [track] = store.replaceRunTracks(run.id, [
        {
          artist: "Anyma",
          sourcePosition: 1,
          title: "Consciousness",
          version: "Original Mix"
        }
      ]);

      store.transitionRunStatus(run.id, "ingesting");
      store.transitionRunStatus(run.id, "matching");

      const review = store.queueRunTrackReview({
        authorizationBasis: "purchase-entitlement",
        availableFormats: ["mp3", "wav"],
        candidateId: "beatport-rejected-1",
        mixLabel: "Original Mix",
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl: "https://www.beatport.com/track/consciousness/rejected-1",
        queueName: "beatport-review",
        runTrackId: track.id,
        summary: "Queued after all automatic free-source providers missed."
      });

      store.transitionRunTrackReviewStatus(review.id, "rejected");

      expect(store.getRun(run.id)).toEqual(
        expect.objectContaining({
          id: run.id,
          status: "packaging"
        })
      );

      const generated = await generateRunArtifacts({
        runId: run.id,
        runStore: store,
        workspaceRoot: tempWorkspace.workspaceRoot
      });

      expect(generated.manifest.summary).toEqual({
        acquiredCount: 0,
        missCount: 1,
        trackCount: 1
      });
      expect(generated.manifest.tracks).toMatchObject([
        {
          artist: "Anyma",
          miss: {
            detail: "Rejected during Beatport paid review.",
            providerId: "beatport",
            providerName: "Beatport",
            reason: "paid-review-rejected"
          },
          outcome: "missed",
          sourcePosition: 1,
          title: "Consciousness",
          version: "Original Mix"
        }
      ]);
    } finally {
      store.close();
      tempWorkspace.cleanup();
    }
  });

  it("packages purchased Beatport reviews after the owned artifact is acquired", async () => {
    const tempWorkspace = createTempWorkspace();
    const store = createRunStore({ databasePath: tempWorkspace.databasePath });

    try {
      const run = store.createRun({
        playlistTitle: "Purchased Beatport Candidate",
        playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DX5trt9i14X7j",
        sourceType: "spotify"
      });
      const [track] = store.replaceRunTracks(run.id, [
        {
          artist: "Mau P",
          sourcePosition: 1,
          title: "Drugs From Amsterdam"
        }
      ]);

      store.transitionRunStatus(run.id, "ingesting");
      store.transitionRunStatus(run.id, "matching");

      const review = store.queueRunTrackReview({
        authorizationBasis: "purchase-entitlement",
        availableFormats: ["mp3"],
        candidateId: "beatport-purchased-1",
        mixLabel: null,
        priceTier: "paid",
        providerKey: "beatport",
        providerName: "Beatport",
        providerUrl:
          "https://www.beatport.com/track/drugs-from-amsterdam/purchased-1",
        queueName: "beatport-review",
        runTrackId: track.id,
        summary: "Queued after all automatic free-source providers missed."
      });

      store.transitionRunTrackReviewStatus(review.id, "approved");
      const downloadDirectory = path.join(tempWorkspace.workspaceRoot, "downloads");
      const acquiredFilePath = path.join(downloadDirectory, "drugs-from-amsterdam.mp3");
      const acquiredFileBody = Buffer.from("owned beatport payload\n", "utf8");

      mkdirSync(downloadDirectory, { recursive: true });
      writeFileSync(acquiredFilePath, acquiredFileBody);

      store.completePurchasedRunTrackReview({
        artifact: {
          contentType: "audio/mpeg",
          fileExtension: "mp3",
          fileName: "drugs-from-amsterdam.mp3",
          format: "mp3",
          localFilePath: acquiredFilePath,
          sha256: createSha256(acquiredFileBody),
          sizeBytes: acquiredFileBody.byteLength
        },
        reviewId: review.id
      });

      expect(store.getRun(run.id)).toEqual(
        expect.objectContaining({
          id: run.id,
          status: "packaging"
        })
      );
      expect(store.getRun(run.id)?.tracks.map((candidate) => [candidate.sourcePosition, candidate.status])).toEqual(
        [[1, "acquired"]]
      );

      const generated = await generateRunArtifacts({
        runId: run.id,
        runStore: store,
        workspaceRoot: tempWorkspace.workspaceRoot
      });

      expect(generated.manifest.summary).toEqual({
        acquiredCount: 1,
        missCount: 0,
        trackCount: 1
      });
      expect(generated.manifest.tracks).toMatchObject([
        {
          artist: "Mau P",
          miss: null,
          outcome: "acquired",
          selection: {
            artifactFormat: "mp3",
            providerId: "beatport",
            providerName: "Beatport",
            providerUrl:
              "https://www.beatport.com/track/drugs-from-amsterdam/purchased-1",
            selectedFormat: "mp3",
            selectedReason: "accepted-base-version-fallback",
            zipEntryName: "001 - Mau P - Drugs From Amsterdam.mp3"
          },
          sourcePosition: 1,
          title: "Drugs From Amsterdam",
          version: null
        }
      ]);

      const zipArtifact = generated.artifacts.find(
        (artifact) => artifact.kind === "downloads-zip"
      );

      expect(zipArtifact).toBeDefined();
      expect(
        readStoredZipEntries(zipArtifact?.absolutePath ?? "").get(
          "001 - Mau P - Drugs From Amsterdam.mp3"
        )
      ).toEqual(acquiredFileBody);
    } finally {
      store.close();
      tempWorkspace.cleanup();
    }
  });

  it("uses the most recently persisted artifact note when attempts share a timestamp", async () => {
    const tempWorkspace = createTempWorkspace();
    const store = createRunStore({ databasePath: tempWorkspace.databasePath });
    let randomUuidSpy:
      | ReturnType<typeof vi.spyOn>
      | undefined;

    try {
      const run = store.createRun({
        playlistTitle: "Deterministic Notes",
        playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DX1s9knjP51Oa",
        sourceType: "spotify"
      });
      const [track] = store.replaceRunTracks(run.id, [
        {
          artist: "DJ Sealer",
          sourcePosition: 1,
          title: "Warehouse Tool",
          version: "Extended Mix"
        }
      ]);

      store.transitionRunStatus(run.id, "ingesting");
      store.transitionRunStatus(run.id, "matching");
      store.transitionRunStatus(run.id, "packaging");

      const downloadDirectory = path.join(tempWorkspace.workspaceRoot, "downloads");
      const acquiredFilePath = path.join(downloadDirectory, "warehouse-tool-latest.mp3");
      const acquiredFileBody = Buffer.from("latest acquired payload\n", "utf8");

      mkdirSync(downloadDirectory, { recursive: true });
      writeFileSync(acquiredFilePath, acquiredFileBody);

      store.updateRunTrackStatus(track.id, "acquired");

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-31T12:00:00.000Z"));

      randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID");
      randomUuidSpy
        .mockImplementationOnce(() => "f0000000-0000-4000-8000-000000000000")
        .mockImplementationOnce(() => "00000000-0000-4000-8000-000000000000");

      store.recordAcquisitionAttempt({
        note: JSON.stringify(
          buildMissedArtifactSourceNote({
            miss: {
              detail: "Older miss note should not win the same-timestamp tie.",
              reason: "no-authorized-source-match"
            }
          })
        ),
        outcome: "missed",
        providerKey: "track-matcher",
        runTrackId: track.id
      });

      store.recordAcquisitionAttempt({
        note: JSON.stringify(
          buildAcquiredArtifactSourceNote({
            artifact: {
              contentType: "audio/mpeg",
              fileExtension: "mp3",
              fileName: "warehouse-tool-latest.mp3",
              format: "mp3",
              localFilePath: acquiredFilePath,
              sha256: createSha256(acquiredFileBody),
              sizeBytes: acquiredFileBody.length
            },
            provider: {
              authorizationBasis: "uploader-enabled-download",
              candidateId: "sc-track-latest",
              discoveredVia: "search",
              priceTier: "free",
              providerId: "soundcloud-direct-downloads",
              providerName: "SoundCloud Direct Downloads",
              providerUrl:
                "https://soundcloud.com/dj-sealer/warehouse-tool-extended-mix"
            },
            selection: {
              details:
                "Later acquired note should beat the older miss even with identical timestamps.",
              reason: "accepted-extended-mix",
              selectedFormat: "mp3"
            }
          })
        ),
        outcome: "matched",
        providerKey: "soundcloud-direct-downloads",
        runTrackId: track.id
      });

      const generated = await generateRunArtifacts({
        runId: run.id,
        runStore: store,
        workspaceRoot: tempWorkspace.workspaceRoot
      });

      expect(generated.manifest.summary).toEqual({
        acquiredCount: 1,
        missCount: 0,
        trackCount: 1
      });
      expect(generated.manifest.tracks).toMatchObject([
        {
          artist: "DJ Sealer",
          outcome: "acquired",
          selection: {
            providerId: "soundcloud-direct-downloads",
            zipEntryName: "001 - DJ Sealer - Warehouse Tool (Extended Mix).mp3"
          },
          sourcePosition: 1,
          title: "Warehouse Tool",
          version: "Extended Mix"
        }
      ]);
    } finally {
      randomUuidSpy?.mockRestore();
      vi.useRealTimers();
      store.close();
      tempWorkspace.cleanup();
    }
  });

  it("packages acquired downloads, misses, and manifest metadata from persisted run data", async () => {
    const tempWorkspace = createTempWorkspace();
    const store = createRunStore({ databasePath: tempWorkspace.databasePath });

    try {
      const run = store.createRun({
        playlistTitle: "Warehouse Drivers",
        playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9",
        sourceType: "spotify"
      });
      const tracks = store.replaceRunTracks(run.id, [
        {
          artist: "DJ Sealer",
          sourcePosition: 1,
          title: "Warehouse Tool",
          version: "Extended Mix"
        },
        {
          artist: "Lane 8",
          sourcePosition: 2,
          title: "Little Voices"
        }
      ]);

      store.transitionRunStatus(run.id, "ingesting");
      store.transitionRunStatus(run.id, "matching");
      store.transitionRunStatus(run.id, "packaging");

      const downloadDirectory = path.join(tempWorkspace.workspaceRoot, "downloads");
      const acquiredFilePath = path.join(downloadDirectory, "warehouse-tool-source.mp3");
      const acquiredFileBody = Buffer.from("fixture mp3 payload\n", "utf8");

      mkdirSync(downloadDirectory, { recursive: true });
      writeFileSync(acquiredFilePath, acquiredFileBody);

      store.updateRunTrackStatus(tracks[0].id, "acquired");
      store.recordAcquisitionAttempt({
        note: JSON.stringify(
          buildAcquiredArtifactSourceNote({
            artifact: {
              contentType: "audio/mpeg",
              fileExtension: "mp3",
              fileName: "warehouse-tool-source.mp3",
              format: "mp3",
              localFilePath: acquiredFilePath,
              sha256: createSha256(acquiredFileBody),
              sizeBytes: acquiredFileBody.length
            },
            provider: {
              authorizationBasis: "uploader-enabled-download",
              candidateId: "sc-track-111",
              discoveredVia: "search",
              priceTier: "free",
              providerId: "soundcloud-direct-downloads",
              providerName: "SoundCloud Direct Downloads",
              providerUrl:
                "https://soundcloud.com/dj-sealer/warehouse-tool-extended-mix"
            },
            selection: {
              details: "Extended Mix matched the highest-priority mix preference.",
              reason: "accepted-extended-mix",
              selectedFormat: "mp3"
            }
          })
        ),
        outcome: "matched",
        providerKey: "soundcloud-direct-downloads",
        runTrackId: tracks[0].id
      });

      store.updateRunTrackStatus(tracks[1].id, "missed");
      store.recordAcquisitionAttempt({
        note: JSON.stringify(
          buildMissedArtifactSourceNote({
            miss: {
              detail: "No authorized source matched the requested track.",
              reason: "no-authorized-source-match"
            }
          })
        ),
        outcome: "missed",
        providerKey: "track-matcher",
        runTrackId: tracks[1].id
      });

      const generated = await generateRunArtifacts({
        runId: run.id,
        runStore: store,
        workspaceRoot: tempWorkspace.workspaceRoot
      });
      const regenerated = await generateRunArtifacts({
        runId: run.id,
        runStore: store,
        workspaceRoot: tempWorkspace.workspaceRoot
      });

      expect(generated.artifacts.map((artifact) => artifact.kind)).toEqual([
        "downloads-zip",
        "misses-txt",
        "manifest-json"
      ]);
      expect(generated.artifacts.map((artifact) => artifact.relativePath)).toEqual([
        `data/runs/${run.id}/artifacts/downloads.zip`,
        `data/runs/${run.id}/artifacts/misses.txt`,
        `data/runs/${run.id}/artifacts/manifest.json`
      ]);
      expect(regenerated.artifacts.map((artifact) => artifact.relativePath)).toEqual(
        generated.artifacts.map((artifact) => artifact.relativePath)
      );
      expect(store.getRun(run.id)?.artifacts).toHaveLength(3);

      const downloadsZipPath = generated.artifacts.find(
        (artifact) => artifact.kind === "downloads-zip"
      )?.absolutePath;
      const manifestPath = generated.artifacts.find(
        (artifact) => artifact.kind === "manifest-json"
      )?.absolutePath;
      const missesPath = generated.artifacts.find(
        (artifact) => artifact.kind === "misses-txt"
      )?.absolutePath;

      expect(downloadsZipPath).toBeDefined();
      expect(manifestPath).toBeDefined();
      expect(missesPath).toBeDefined();

      const zipEntries = readStoredZipEntries(downloadsZipPath as string);
      const manifest = JSON.parse(readFileSync(manifestPath as string, "utf8")) as {
        run: {
          id: string;
          playlistTitle: string | null;
          sourceType: string;
        };
        summary: {
          acquiredCount: number;
          missCount: number;
          trackCount: number;
        };
        tracks: Array<{
          artist: string;
          miss?: {
            detail: string;
            reason: string;
          } | null;
          outcome: string;
          selection?: {
            artifactFormat: string;
            providerId: string;
            zipEntryName: string;
          } | null;
          sourcePosition: number;
          title: string;
          version: string | null;
        }>;
      };
      const missesText = readFileSync(missesPath as string, "utf8");

      expect([...zipEntries.keys()]).toEqual([
        "001 - DJ Sealer - Warehouse Tool (Extended Mix).mp3"
      ]);
      expect(
        zipEntries.get("001 - DJ Sealer - Warehouse Tool (Extended Mix).mp3")?.toString(
          "utf8"
        )
      ).toBe(acquiredFileBody.toString("utf8"));
      expect(missesText).toBe(
        "002 - Lane 8 - Little Voices :: no-authorized-source-match :: No authorized source matched the requested track.\n"
      );
      expect(manifest).toMatchObject({
        run: {
          id: run.id,
          playlistTitle: "Warehouse Drivers",
          sourceType: "spotify"
        },
        summary: {
          acquiredCount: 1,
          missCount: 1,
          trackCount: 2
        },
        tracks: [
          {
            artist: "DJ Sealer",
            outcome: "acquired",
            selection: {
              artifactFormat: "mp3",
              providerId: "soundcloud-direct-downloads",
              zipEntryName: "001 - DJ Sealer - Warehouse Tool (Extended Mix).mp3"
            },
            sourcePosition: 1,
            title: "Warehouse Tool",
            version: "Extended Mix"
          },
          {
            artist: "Lane 8",
            miss: {
              detail: "No authorized source matched the requested track.",
              reason: "no-authorized-source-match"
            },
            outcome: "missed",
            sourcePosition: 2,
            title: "Little Voices",
            version: null
          }
        ]
      });
    } finally {
      store.close();
      tempWorkspace.cleanup();
    }
  });
});
