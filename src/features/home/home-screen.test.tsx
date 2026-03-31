import { render, screen } from "@testing-library/react";

import { HomeScreen } from "./home-screen";

describe("HomeScreen", () => {
  it("renders the intake shell and empty run state", () => {
    render(<HomeScreen />);

    expect(
      screen.getByRole("heading", { name: /authorized-source acquisition/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/playlist url/i)).toBeVisible();
    expect(
      screen.getByRole("button", { name: /queue playlist/i })
    ).toBeDisabled();
    expect(screen.getByRole("heading", { name: /recent runs/i })).toBeVisible();
    expect(screen.getByText(/downloads\.zip/i)).toBeVisible();
    expect(screen.getAllByText(/no runs yet/i)).toHaveLength(2);
    expect(
      screen.getByText(
        /let the local orchestrator ingest tracks, match authorized sources, package artifacts, and open beatport review/i
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        /playwright fixture mode keeps end-to-end verification deterministic\. live operator runs still need spotify and soundcloud credentials configured before intake starts/i
      )
    ).toBeVisible();
  });

  it("links recent runs into the run report detail flow", () => {
    render(
      <HomeScreen
        initialRuns={[
          {
            artifactCount: 3,
            createdAt: "2026-03-31T15:00:00.000Z",
            id: "run-42",
            playlistTitle: "Warehouse Drivers",
            playlistUrl:
              "https://open.spotify.com/playlist/37i9dQZF1DWVRSukIED0e9",
            resumeAfterStatus: null,
            sourceType: "spotify",
            status: "completed",
            trackCount: 12,
            updatedAt: "2026-03-31T15:15:00.000Z"
          }
        ]}
      />
    );

    expect(
      screen.getByRole("link", { name: /open report for warehouse drivers/i })
    ).toHaveAttribute("href", "/runs/run-42");
  });
});
