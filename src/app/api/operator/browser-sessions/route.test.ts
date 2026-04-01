/* @vitest-environment node */

afterEach(() => {
  vi.doUnmock("@/features/browser/operator-browser-session-manager");
  vi.resetModules();
});

describe("/api/operator/browser-sessions", () => {
  it("returns the current operator browser-session readiness payload", async () => {
    const listSessions = vi.fn().mockResolvedValue([
      {
        detail: "Authenticated session available for automatic acquisition.",
        providerId: "bandcamp",
        providerName: "Bandcamp",
        sessionName: "bandcamp",
        setupUrl: "https://bandcamp.com/login",
        status: "ready",
        subjectHint: "crate-digger@example.com"
      }
    ]);

    vi.doMock("@/features/browser/operator-browser-session-manager", () => ({
      getSharedOperatorBrowserSessionManager: () => ({
        listSessions
      })
    }));

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(listSessions).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      providers: [
        expect.objectContaining({
          providerId: "bandcamp",
          status: "ready"
        })
      ]
    });
  });

  it("dispatches provider session setup actions through the shared manager", async () => {
    const launchSetup = vi.fn().mockResolvedValue({
      detail: "Browser window open. Finish login, then mark the session ready.",
      providerId: "beatport",
      providerName: "Beatport",
      sessionName: "beatport",
      setupUrl: "https://www.beatport.com/login",
      status: "setup-in-progress"
    });
    const markAuthenticated = vi.fn().mockResolvedValue({
      detail: "Authenticated session available for owned-download refresh.",
      providerId: "beatport",
      providerName: "Beatport",
      sessionName: "beatport",
      setupUrl: "https://www.beatport.com/login",
      status: "ready"
    });

    vi.doMock("@/features/browser/operator-browser-session-manager", () => ({
      getSharedOperatorBrowserSessionManager: () => ({
        launchSetup,
        markAuthenticated
      })
    }));

    const { POST } = await import("./route");

    const launchResponse = await POST(
      new Request("http://localhost/api/operator/browser-sessions", {
        body: JSON.stringify({
          action: "launch",
          providerId: "beatport"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      })
    );

    expect(launchSetup).toHaveBeenCalledWith("beatport");
    expect(launchResponse.status).toBe(200);
    await expect(launchResponse.json()).resolves.toEqual({
      provider: expect.objectContaining({
        providerId: "beatport",
        status: "setup-in-progress"
      })
    });

    const completeResponse = await POST(
      new Request("http://localhost/api/operator/browser-sessions", {
        body: JSON.stringify({
          action: "mark-authenticated",
          providerId: "beatport",
          subjectHint: "operator@example.com"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      })
    );

    expect(markAuthenticated).toHaveBeenCalledWith("beatport", {
      subjectHint: "operator@example.com"
    });
    expect(completeResponse.status).toBe(200);
    await expect(completeResponse.json()).resolves.toEqual({
      provider: expect.objectContaining({
        providerId: "beatport",
        status: "ready"
      })
    });
  });

  it("rejects unsupported setup actions", async () => {
    vi.doMock("@/features/browser/operator-browser-session-manager", () => ({
      getSharedOperatorBrowserSessionManager: () => ({
        launchSetup: vi.fn(),
        markAuthenticated: vi.fn()
      })
    }));

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/operator/browser-sessions", {
        body: JSON.stringify({
          action: "unsupported-action",
          providerId: "beatport"
        }),
        headers: {
          "content-type": "application/json"
        },
        method: "POST"
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "action must be one of: launch, mark-authenticated."
    });
  });
});
