import { expect, test, type APIRequestContext } from "@playwright/test";

type SeedResponse = {
  run: {
    id: string;
    playlistTitle: string | null;
    playlistUrl: string;
  };
};

test.describe.configure({ mode: "serial" });

async function resetHarness(request: APIRequestContext) {
  const response = await request.post("/api/test/e2e/reset");

  expect(response.ok()).toBeTruthy();
}

async function seedScenario(
  request: APIRequestContext,
  scenario: string
) {
  const response = await request.post("/api/test/e2e/seed", {
    data: { scenario }
  });

  expect(response.ok()).toBeTruthy();

  return (await response.json()) as SeedResponse;
}

test.beforeEach(async ({ request }) => {
  await resetHarness(request);
});

test("submits a deterministic fixture-mode playlist through the live orchestration path and exposes completed artifacts", async ({
  page
}) => {
  await page.goto("/");
  await page.getByLabel(/playlist url/i).fill(
    "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9"
  );
  await page.getByRole("button", { name: /queue playlist/i }).click();

  await expect(page.getByText(/warehouse starters/i)).toBeVisible();
  await expect(page.getByText(/^completed$/i)).toBeVisible();

  await page
    .getByRole("link", { name: /open report for warehouse starters/i })
    .click();

  await expect(page).toHaveURL(/\/runs\/.+/);
  await expect(page.getByText(/downloads\.zip/i)).toBeVisible();
  await expect(page.getByText(/manifest\.json/i)).toBeVisible();
  await expect(page.getByText(/misses\.txt/i)).toBeVisible();

  const manifestLink = page.getByRole("link", { name: /manifest\.json/i });
  const manifestHref = await manifestLink.getAttribute("href");

  expect(manifestHref).toBeTruthy();

  const manifestResponse = await page.request.get(String(manifestHref));

  expect(manifestResponse.ok()).toBeTruthy();
  await expect(manifestResponse.json()).resolves.toMatchObject({
    run: {
      playlistTitle: "Warehouse Starters"
    },
    summary: {
      acquiredCount: 2,
      missCount: 0
    }
  });
});

test("covers a Beatport review-lane run via deterministic fixture mode through the live orchestration path", async ({
  page
}) => {
  await page.goto("/");
  await page.getByLabel(/playlist url/i).fill(
    "https://soundcloud.com/dj-nova/sets/warehouse-finds"
  );
  await page.getByRole("button", { name: /queue playlist/i }).click();

  await expect(page.getByText(/warehouse finds/i)).toBeVisible();
  await page
    .getByRole("link", { name: /open report for warehouse finds/i })
    .click();

  await expect(page.getByRole("heading", { name: /warehouse finds/i })).toBeVisible();
  await expect(
    page
      .getByText(/queued after all automatic free-source providers missed/i)
      .first()
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /approve beatport candidate for dj sealer - warehouse tool/i
    })
  ).toBeVisible();
  await expect(page.getByText(/awaiting operator review/i).first()).toBeVisible();
});

test("resumes interrupted runs after the run store is restarted", async ({
  page,
  request
}) => {
  const seedPayload = await seedScenario(request, "resume-matching");
  const restartResponse = await request.post("/api/test/e2e/restart");

  expect(restartResponse.ok()).toBeTruthy();

  await page.goto("/");

  const runCard = page
    .locator("article")
    .filter({ hasText: seedPayload.run.playlistTitle ?? seedPayload.run.playlistUrl });

  await expect(runCard).toContainText(/matching/i);
  await expect(runCard).toContainText(/completed/i, {
    timeout: 15_000
  });
  await expect(runCard).not.toContainText(/queued/i);
  await expect(
    runCard.getByRole("link", {
      name: new RegExp(
        `open report for ${(seedPayload.run.playlistTitle ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "i"
      )
    })
  ).toBeVisible();
});
