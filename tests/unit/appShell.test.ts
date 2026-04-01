import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HomePage from '../../app/page';

describe('HomePage', () => {
  it('renders the local acquisition app heading', () => {
    const html = renderToStaticMarkup(createElement(HomePage));

    expect(html).toContain('music-downloader');
    expect(html).toContain('SoundCloudDL backup provider');
  });
});
