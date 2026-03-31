import { expect, test } from "@playwright/test";

test("renders the intake shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /authorized-source acquisition/i })
  ).toBeVisible();
  await expect(page.getByLabel(/playlist url/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /queue playlist/i })
  ).toBeVisible();
});
