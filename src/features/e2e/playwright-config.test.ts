import { describe, expect, it } from "vitest";

import playwrightConfig from "../../../playwright.config";

describe("playwright e2e config", () => {
  it("limits the shared e2e harness to a single worker", () => {
    expect(playwrightConfig.workers).toBe(1);
  });

  it("disables fully parallel execution for the shared e2e harness", () => {
    expect(playwrightConfig.fullyParallel).toBe(false);
  });
});
