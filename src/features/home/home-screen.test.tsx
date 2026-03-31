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
  });
});
