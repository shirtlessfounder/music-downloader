import { render, screen } from "@testing-library/react";

import { HomeScreen } from "./home-screen";

describe("HomeScreen", () => {
  it("renders the intake shell and empty run state", () => {
    render(
      <HomeScreen
        initialBrowserSessions={[
          {
            detail:
              "Launch setup to create the persisted SoundCloud browser session used during live automatic acquisition.",
            providerId: "soundcloud-direct-downloads",
            providerName: "SoundCloud Direct Downloads",
            sessionName: "soundcloud-direct-downloads",
            setupUrl: "https://soundcloud.com",
            status: "missing"
          },
          {
            detail: "Authenticated session available for automatic downloads.",
            providerId: "bandcamp",
            providerName: "Bandcamp",
            sessionName: "bandcamp",
            setupUrl: "https://bandcamp.com/login",
            status: "ready",
            subjectHint: "crate-digger@example.com"
          },
          {
            detail:
              "The Beatport session expired. Refresh it before owned downloads can run.",
            providerId: "beatport",
            providerName: "Beatport",
            sessionName: "beatport",
            setupUrl: "https://www.beatport.com/login",
            status: "expired"
          }
        ]}
        initialSpotifyAuth={{
          detail:
            "Spotify playlist intake requires a connected Spotify account before queueing Spotify playlists.",
          status: "missing",
          subjectHint: null
        }}
      />
    );

    expect(
      screen.getByRole("heading", { name: /playlist acquisition/i })
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
        /let the local orchestrator ingest tracks, match providers, package artifacts, and open beatport review/i
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        /playwright fixture mode keeps end-to-end verification deterministic\. live operator runs need spotify and soundcloud api credentials plus refreshed provider browser sessions before queueing real acquisition/i
      )
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /live prerequisites/i })
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /spotify connection/i })
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /connect spotify account/i })
    ).toHaveAttribute("href", "/api/operator/spotify-auth/start");
    expect(
      screen.getByRole("button", {
        name: /launch soundcloud direct downloads session setup/i
      })
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: /refresh beatport session setup/i
      })
    ).toBeVisible();
    expect(screen.getByText(/crate-digger@example\.com/i)).toBeVisible();
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
        initialSpotifyAuth={{
          detail: "Spotify operator account connected for playlist intake.",
          status: "connected",
          subjectHint: "playlist-operator"
        }}
      />
    );

    expect(
      screen.getByRole("link", { name: /open report for warehouse drivers/i })
    ).toHaveAttribute("href", "/runs/run-42");
    expect(screen.getByText(/playlist-operator/i)).toBeVisible();
    expect(
      screen.getByRole("link", { name: /reconnect spotify account/i })
    ).toHaveAttribute("href", "/api/operator/spotify-auth/start");
  });
});
