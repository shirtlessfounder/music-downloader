/* @vitest-environment node */

import vitestConfig from "../../vitest.config";

import { describe, expect, it } from "vitest";

const browserBackedTestFiles = [
  "src/features/providers/beatport.test.ts",
  "src/features/providers/bandcamp.test.ts",
  "src/features/providers/soundclouddl.test.ts",
  "src/features/providers/soundcloud-direct-downloads.test.ts",
  "src/features/browser/browser-session-service.test.ts",
  "src/app/api/runs/[runId]/review-queue/[reviewId]/route.test.ts"
];

describe("vitest project scheduling", () => {
  it("runs browser-backed suites in a dedicated project group", () => {
    const projects = vitestConfig.test?.projects;

    expect(projects).toBeDefined();
    expect(projects).toHaveLength(2);

    const defaultProject = projects?.find((project) => project.test?.name === "default");
    const browserBackedProject = projects?.find(
      (project) => project.test?.name === "browser-backed"
    );

    expect(defaultProject).toMatchObject({
      extends: true,
      test: {
        exclude: expect.arrayContaining(browserBackedTestFiles),
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        name: "default"
      }
    });
    expect(browserBackedProject).toMatchObject({
      extends: true,
      test: {
        include: browserBackedTestFiles,
        name: "browser-backed",
        sequence: {
          groupOrder: 1
        }
      }
    });
  });
});
