import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from '../../app/page';

describe('HomePage', () => {
  it('renders the local acquisition app heading and demo provider result', async () => {
    const html = renderToStaticMarkup(await HomePage());

    expect(html).toContain('music-downloader');
    expect(html).toContain('SoundCloudDL backup provider');
    expect(html).toContain('soundclouddl');
    expect(html).toContain('https://soundcloud.com/artist/track-extended');
    expect(html).toContain('Artist Track Extended Mix');
  });
});
