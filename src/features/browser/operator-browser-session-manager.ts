import path from "node:path";

import {
  type BrowserSessionRecord,
  BrowserSessionService
} from "@/features/browser/browser-session-service";
import {
  BANDCAMP_PROVIDER_ID,
  BANDCAMP_PROVIDER_NAME,
  BANDCAMP_SESSION_NAME
} from "@/features/providers/bandcamp";
import {
  BEATPORT_PROVIDER_ID,
  BEATPORT_PROVIDER_NAME,
  BEATPORT_SESSION_NAME
} from "@/features/providers/beatport";
import {
  SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
  SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
  SOUNDCLOUD_DIRECT_DOWNLOADS_SESSION_NAME
} from "@/features/providers/soundcloud-direct-downloads";

type OperatorBrowserSessionProviderDefinition = {
  missingDetail: string;
  providerId: string;
  providerName: string;
  readyDetail: string;
  refreshDetail: string;
  sessionName: string;
  setupUrl: string;
};

export type OperatorBrowserSessionStatus =
  | "expired"
  | "missing"
  | "ready"
  | "setup-in-progress";

export interface OperatorBrowserSessionReadiness {
  authenticatedAt?: string;
  detail: string;
  expiredAt?: string;
  providerId: string;
  providerName: string;
  sessionName: string;
  setupUrl: string;
  status: OperatorBrowserSessionStatus;
  subjectHint?: string | null;
}

export interface OperatorBrowserSessionManagerDependencies {
  getSessionRecord(sessionName: string): Promise<BrowserSessionRecord | null>;
  openSession(options: {
    authState?: BrowserSessionRecord["authState"];
    headless?: boolean;
    sessionName: string;
  }): Promise<{
    close(): Promise<void>;
    getRecord(): Promise<BrowserSessionRecord>;
    navigate(options: { url: string; waitUntil?: "load" }): Promise<unknown>;
    setAuthState(
      authState: BrowserSessionRecord["authState"]
    ): Promise<BrowserSessionRecord>;
    withPage<T>(
      task: (page: { bringToFront?: () => Promise<void> }) => Promise<T>
    ): Promise<T>;
  }>;
  shutdown?(): Promise<void>;
}

export class UnsupportedOperatorBrowserSessionProviderError extends Error {
  readonly providerId: string;

  constructor(providerId: string) {
    super(`Unsupported operator browser-session provider "${providerId}".`);
    this.name = "UnsupportedOperatorBrowserSessionProviderError";
    this.providerId = providerId;
  }
}

const REQUIRED_OPERATOR_BROWSER_SESSIONS: OperatorBrowserSessionProviderDefinition[] = [
  {
    missingDetail:
      "Launch setup to create the persisted SoundCloud browser session used during live automatic acquisition.",
    providerId: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_ID,
    providerName: SOUNDCLOUD_DIRECT_DOWNLOADS_PROVIDER_NAME,
    readyDetail: "Authenticated session available for automatic downloads.",
    refreshDetail:
      "The SoundCloud session expired. Refresh it before automatic downloads can run.",
    sessionName: SOUNDCLOUD_DIRECT_DOWNLOADS_SESSION_NAME,
    setupUrl: "https://soundcloud.com"
  },
  {
    missingDetail:
      "Launch setup to create the persisted Bandcamp browser session used during live automatic acquisition.",
    providerId: BANDCAMP_PROVIDER_ID,
    providerName: BANDCAMP_PROVIDER_NAME,
    readyDetail: "Authenticated session available for automatic downloads.",
    refreshDetail:
      "The Bandcamp session expired. Refresh it before automatic downloads can run.",
    sessionName: BANDCAMP_SESSION_NAME,
    setupUrl: "https://bandcamp.com"
  },
  {
    missingDetail:
      "Launch setup to create the persisted Beatport browser session used for owned-download refresh after review approval.",
    providerId: BEATPORT_PROVIDER_ID,
    providerName: BEATPORT_PROVIDER_NAME,
    readyDetail:
      "Authenticated session available for owned-download refresh after review approval.",
    refreshDetail:
      "The Beatport session expired. Refresh it before owned downloads can run.",
    sessionName: BEATPORT_SESSION_NAME,
    setupUrl: "https://www.beatport.com"
  }
];

const sharedOperatorBrowserSessionManagers = new Map<
  string,
  OperatorBrowserSessionManager
>();

export function createOperatorBrowserSessionManager(options: {
  browserSessionService?: OperatorBrowserSessionManagerDependencies;
  workspaceRoot?: string;
} = {}) {
  return new OperatorBrowserSessionManager({
    browserSessionService:
      options.browserSessionService ??
      new BrowserSessionService({
        workspaceRoot: resolveWorkspaceRoot(options.workspaceRoot)
      }),
    workspaceRoot: resolveWorkspaceRoot(options.workspaceRoot)
  });
}

export function getSharedOperatorBrowserSessionManager(options: {
  workspaceRoot?: string;
} = {}) {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const existingManager = sharedOperatorBrowserSessionManagers.get(workspaceRoot);

  if (existingManager) {
    return existingManager;
  }

  const manager = createOperatorBrowserSessionManager({ workspaceRoot });
  sharedOperatorBrowserSessionManagers.set(workspaceRoot, manager);
  return manager;
}

export async function resetSharedOperatorBrowserSessionManagerForTests() {
  const managers = [...sharedOperatorBrowserSessionManagers.values()];
  sharedOperatorBrowserSessionManagers.clear();

  await Promise.all(managers.map((manager) => manager.shutdown()));
}

class OperatorBrowserSessionManager {
  readonly #browserSessionService: OperatorBrowserSessionManagerDependencies;
  readonly #providersById: Map<string, OperatorBrowserSessionProviderDefinition>;
  readonly #setupInProgressProviderIds = new Set<string>();
  readonly #workspaceRoot: string;

  constructor(options: {
    browserSessionService: OperatorBrowserSessionManagerDependencies;
    workspaceRoot: string;
  }) {
    this.#browserSessionService = options.browserSessionService;
    this.#providersById = new Map(
      REQUIRED_OPERATOR_BROWSER_SESSIONS.map((provider) => [
        provider.providerId,
        provider
      ])
    );
    this.#workspaceRoot = options.workspaceRoot;
  }

  async listSessions() {
    return Promise.all(
      REQUIRED_OPERATOR_BROWSER_SESSIONS.map((provider) =>
        this.#readinessForProvider(provider)
      )
    );
  }

  async launchSetup(providerId: string) {
    const provider = this.#getProvider(providerId);
    const session = await this.#browserSessionService.openSession({
      headless: false,
      sessionName: provider.sessionName
    });

    await session.navigate({
      url: provider.setupUrl,
      waitUntil: "load"
    });
    await session.withPage(async (page) => {
      await page.bringToFront?.();
    });

    this.#setupInProgressProviderIds.add(providerId);

    return this.#buildReadiness({
      detail: "Browser window open. Finish login, then mark the session ready.",
      provider,
      record: await session.getRecord(),
      status: "setup-in-progress"
    });
  }

  async markAuthenticated(
    providerId: string,
    input: { subjectHint?: string } = {}
  ) {
    const provider = this.#getProvider(providerId);
    const session = await this.#browserSessionService.openSession({
      headless: false,
      sessionName: provider.sessionName
    });

    try {
      const record = await session.setAuthState({
        authenticatedAt: new Date().toISOString(),
        providerId,
        status: "authenticated",
        subjectHint: input.subjectHint?.trim() || null
      });

      this.#setupInProgressProviderIds.delete(providerId);

      return this.#buildReadiness({
        provider,
        record,
        status: "ready"
      });
    } finally {
      await session.close();
    }
  }

  async shutdown() {
    await this.#browserSessionService.shutdown?.();
  }

  async #readinessForProvider(
    provider: OperatorBrowserSessionProviderDefinition
  ): Promise<OperatorBrowserSessionReadiness> {
    if (this.#setupInProgressProviderIds.has(provider.providerId)) {
      const activeRecord = await this.#browserSessionService.getSessionRecord(
        provider.sessionName
      );

      return this.#buildReadiness({
        detail: "Browser window open. Finish login, then mark the session ready.",
        provider,
        record: activeRecord,
        status: "setup-in-progress"
      });
    }

    const record = await this.#browserSessionService.getSessionRecord(
      provider.sessionName
    );

    if (record === null || record.authState.status === "unknown") {
      return this.#buildReadiness({
        detail: provider.missingDetail,
        provider,
        record,
        status: "missing"
      });
    }

    if (
      record.authState.status === "expired" ||
      (record.authState.status === "authenticated" &&
        record.authState.expiresAt &&
        Date.parse(record.authState.expiresAt) <= Date.now())
    ) {
      return this.#buildReadiness({
        detail: provider.refreshDetail,
        provider,
        record,
        status: "expired"
      });
    }

    return this.#buildReadiness({
      provider,
      record,
      status: "ready"
    });
  }

  #buildReadiness(input: {
    detail?: string;
    provider: OperatorBrowserSessionProviderDefinition;
    record: BrowserSessionRecord | null;
    status: OperatorBrowserSessionStatus;
  }): OperatorBrowserSessionReadiness {
    const authState = input.record?.authState;

    return {
      authenticatedAt:
        authState?.status === "authenticated" ? authState.authenticatedAt : undefined,
      detail:
        input.detail ??
        (input.status === "ready"
          ? input.provider.readyDetail
          : input.provider.missingDetail),
      expiredAt:
        authState?.status === "expired"
          ? authState.expiredAt
          : authState?.status === "authenticated"
            ? authState.expiresAt ?? undefined
            : undefined,
      providerId: input.provider.providerId,
      providerName: input.provider.providerName,
      sessionName: input.provider.sessionName,
      setupUrl: input.provider.setupUrl,
      status: input.status,
      subjectHint:
        authState?.status === "authenticated" ? authState.subjectHint ?? null : undefined
    };
  }

  #getProvider(providerId: string) {
    const provider = this.#providersById.get(providerId);

    if (!provider) {
      throw new UnsupportedOperatorBrowserSessionProviderError(providerId);
    }

    return provider;
  }
}

function resolveWorkspaceRoot(workspaceRoot?: string) {
  return (
    workspaceRoot ??
    process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT ??
    path.join(process.cwd())
  );
}
