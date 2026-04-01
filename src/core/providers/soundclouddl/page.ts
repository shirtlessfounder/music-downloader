import type { Page } from '@playwright/test';

export type SoundCloudDLConvertInput = {
  sourceUrl: string;
  format: 'mp3';
};

export type SoundCloudDLConvertResult = {
  downloadUrl: string;
};

export interface SoundCloudDLConverterPage {
  convertTrack(
    input: SoundCloudDLConvertInput
  ): Promise<SoundCloudDLConvertResult>;
}

export class SoundCloudDLPageError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'SoundCloudDLPageError';
  }
}

export class SoundCloudDLPage implements SoundCloudDLConverterPage {
  constructor(
    private readonly page: Page,
    private readonly baseUrl = 'https://soundclouddl.cc/'
  ) {}

  async convertTrack(
    input: SoundCloudDLConvertInput
  ): Promise<SoundCloudDLConvertResult> {
    await this.page.goto(this.baseUrl, { waitUntil: 'domcontentloaded' });

    const urlInput = this.page.locator('input[name="url"]');
    if ((await urlInput.count()) === 0) {
      throw new SoundCloudDLPageError('converter form unavailable', true);
    }

    await urlInput.fill(input.sourceUrl);

    const mp3Select = this.page.locator('select[name="format"]');
    if ((await mp3Select.count()) > 0) {
      await mp3Select.selectOption({ label: 'MP3' }).catch(async () => {
        await mp3Select.selectOption('MP3');
      });
    } else {
      const mp3Radio = this.page.locator(
        'input[name="format"][value="MP3"], input[name="format"][value="mp3"]'
      );

      if ((await mp3Radio.count()) > 0) {
        await mp3Radio.first().check();
      }
    }

    const submitButton = this.page.locator('button[type="submit"], input[type="submit"]');
    if ((await submitButton.count()) === 0) {
      throw new SoundCloudDLPageError('converter submit unavailable', true);
    }

    await submitButton.first().click();

    const downloadLink = this.page.locator('a[href$=".mp3"], a.download-button, a[href*="download"]');
    try {
      await downloadLink.first().waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
      throw new SoundCloudDLPageError('timeout waiting for conversion', true);
    }

    const downloadUrl = await downloadLink.first().getAttribute('href');

    if (!downloadUrl) {
      throw new SoundCloudDLPageError('converter returned no download link', false);
    }

    return {
      downloadUrl
    };
  }
}
