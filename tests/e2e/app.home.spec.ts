import { expect, test } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('music-downloader')).toBeVisible();
  await expect(page.getByText('SoundCloudDL backup provider')).toBeVisible();
  await expect(page.getByText('soundclouddl', { exact: true })).toBeVisible();
  await expect(page.getByText('https://soundcloud.com/artist/track-extended')).toBeVisible();
  await expect(page.getByText('Artist Track Extended Mix')).toBeVisible();
});
