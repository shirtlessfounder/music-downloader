import type { CanonicalTrack } from '../src/core/catalog/trackTypes';
import { buildProviderRegistry } from '../src/core/providers/providerRegistry';
import { planTrackAcquisition } from '../src/core/runs/acquisitionPlanner';

const demoTrack: CanonicalTrack = {
  artist: 'Artist',
  title: 'Track',
  source: 'spotify',
  mixPreferenceOrder: ['extended', 'original', 'long-fallback']
};

async function loadDemoAcquisition() {
  return planTrackAcquisition({
    track: demoTrack,
    providerRegistry: buildProviderRegistry([
      {
        id: 'hypeddit',
        async download() {
          return {
            status: 'terminal_failure',
            provider: 'hypeddit',
            reason: 'miss'
          } as const;
        }
      },
      {
        id: 'reddit',
        async download() {
          return {
            status: 'terminal_failure',
            provider: 'reddit',
            reason: 'miss'
          } as const;
        }
      },
      {
        id: 'soundclouddl',
        async download(input) {
          return {
            status: 'success',
            provider: 'soundclouddl',
            format: 'mp3',
            downloadUrl: 'https://soundclouddl.cc/downloads/track.mp3',
            sourceUrl: input.sourceUrl ?? null
          } as const;
        }
      }
    ]),
    resolveSoundCloudCandidate: async () => ({
      selected: {
        artist: 'Artist',
        title: 'Track Extended Mix',
        url: 'https://soundcloud.com/artist/track-extended',
        durationSeconds: 405
      },
      queryUsed: 'Artist Track Extended Mix',
      confidence: 100,
      mixClass: 'extended'
    })
  });
}

export default async function HomePage() {
  const demoAcquisition = await loadDemoAcquisition();

  return (
    <main>
      <h1>music-downloader</h1>
      <p>SoundCloudDL backup provider</p>
      <p>Minimal local acquisition app scaffold for provider development.</p>
      <section>
        <h2>Demo acquisition</h2>
        <p>{demoAcquisition.result.provider}</p>
        <p>{demoAcquisition.provenance?.matchedSoundCloudUrl}</p>
        <p>{demoAcquisition.provenance?.queryUsed}</p>
      </section>
    </main>
  );
}
