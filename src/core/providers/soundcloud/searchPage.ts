import type { Page } from '@playwright/test';
import type { SoundCloudCandidate } from './candidateTypes';

export class SoundCloudSearchPage {
  constructor(
    private readonly page: Page,
    private readonly baseUrl = 'https://soundcloud.com/search/sounds?q='
  ) {}

  async search(query: string): Promise<SoundCloudCandidate[]> {
    await this.page.goto(`${this.baseUrl}${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded'
    });
    await this.page.waitForLoadState('networkidle');

    const candidates = await this.page.locator('.searchList__item, li').evaluateAll(
      (nodes) =>
        nodes
          .map((node) => {
            const anchor =
              node.querySelector<HTMLAnchorElement>('a.soundTitle__title') ??
              node.querySelector<HTMLAnchorElement>('a[href*="soundcloud.com"]');
            const title =
              anchor?.textContent?.trim() ??
              node.getAttribute('data-track-title') ??
              '';
            const artist =
              node.querySelector<HTMLElement>('.soundTitle__username')?.textContent?.trim() ??
              node.getAttribute('data-track-artist') ??
              '';
            const durationLabel =
              node.querySelector<HTMLElement>('.sc-ministats-duration, .duration')?.textContent?.trim() ??
              node.getAttribute('data-track-duration') ??
              '';
            const durationMatch = durationLabel.match(/(?:(\d+):)?(\d+):(\d+)|(\d+):(\d+)/);

            let durationSeconds = 0;

            if (durationMatch) {
              if (durationMatch[4] && durationMatch[5]) {
                durationSeconds =
                  Number(durationMatch[4]) * 60 + Number(durationMatch[5]);
              } else {
                durationSeconds =
                  Number(durationMatch[1] ?? 0) * 3600 +
                  Number(durationMatch[2] ?? 0) * 60 +
                  Number(durationMatch[3] ?? 0);
              }
            }

            if (!anchor?.href || !title) {
              return null;
            }

            return {
              artist,
              title,
              url: anchor.href,
              durationSeconds
            };
          })
          .filter((candidate): candidate is SoundCloudCandidate => candidate !== null)
    );

    return candidates;
  }
}
