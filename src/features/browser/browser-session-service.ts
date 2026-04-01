import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  chromium,
  type BrowserContext,
  type BrowserType,
  type Download,
  type Page
} from "playwright";

const SESSION_ROOT_DIRECTORY = ".music-downloader/browser-sessions";
const SESSION_METADATA_FILE = "session-state.json";
const SESSION_PROFILE_DIRECTORY = "profile";

export type BrowserSessionAuthState =
  | {
      status: "unknown";
    }
  | {
      status: "authenticated";
      providerId: string;
      authenticatedAt: string;
      expiresAt?: string | null;
      subjectHint?: string | null;
    }
  | {
      status: "expired";
      providerId: string;
      expiredAt: string;
      reason?: string;
    };

export interface BrowserSessionRecord {
  version: 1;
  sessionName: string;
  createdAt: string;
  lastOpenedAt: string;
  userDataDir: string;
  authState: BrowserSessionAuthState;
}

export interface BrowserSessionServiceOptions {
  workspaceRoot: string;
  browserType?: BrowserType;
}

export interface OpenBrowserSessionOptions {
  headless?: boolean;
  sessionName: string;
  authState?: BrowserSessionAuthState;
}

export interface BrowserSessionNavigationOptions {
  url: string;
  waitUntil?: BrowserSessionWaitUntil;
}

export interface BrowserSessionNavigationResult {
  status: number | null;
  url: string;
}

export interface BrowserSessionScreenshotOptions {
  path: string;
  fullPage?: boolean;
}

export interface BrowserSessionDownloadOptions {
  saveAs?: string;
  trigger: (page: Page) => Promise<void>;
}

export interface BrowserSessionDownloadResult {
  path: string;
  suggestedFilename: string;
}

export type BrowserSessionWaitUntil =
  | "commit"
  | "domcontentloaded"
  | "load"
  | "networkidle";

export interface ProviderBrowserSession {
  readonly authState: BrowserSessionAuthState;
  readonly sessionName: string;
  readonly wasReused: boolean;

  captureDownload(
    options: BrowserSessionDownloadOptions
  ): Promise<BrowserSessionDownloadResult>;
  close(): Promise<void>;
  getRecord(): Promise<BrowserSessionRecord>;
  navigate(
    options: BrowserSessionNavigationOptions
  ): Promise<BrowserSessionNavigationResult>;
  setAuthState(authState: BrowserSessionAuthState): Promise<BrowserSessionRecord>;
  takeScreenshot(
    options: BrowserSessionScreenshotOptions
  ): Promise<{ path: string }>;
  withPage<T>(task: (page: Page) => Promise<T>): Promise<T>;
}

export class MissingBrowserSessionStateError extends Error {
  readonly code = "missing-session-state";
  readonly sessionName: string;

  constructor(sessionName: string) {
    super(`No persisted browser session exists for "${sessionName}".`);
    this.name = "MissingBrowserSessionStateError";
    this.sessionName = sessionName;
  }
}

export class MissingBrowserSessionAuthStateError extends Error {
  readonly code = "missing-session-auth-state";
  readonly sessionName: string;

  constructor(sessionName: string) {
    super(`Browser session "${sessionName}" does not have persisted auth state.`);
    this.name = "MissingBrowserSessionAuthStateError";
    this.sessionName = sessionName;
  }
}

export class ExpiredBrowserSessionAuthStateError extends Error {
  readonly code = "expired-session-auth-state";
  readonly expiredAt: string;
  readonly providerId: string;
  readonly sessionName: string;

  constructor(input: { expiredAt: string; providerId: string; sessionName: string }) {
    super(
      `Browser session "${input.sessionName}" is expired for provider "${input.providerId}".`
    );
    this.name = "ExpiredBrowserSessionAuthStateError";
    this.expiredAt = input.expiredAt;
    this.providerId = input.providerId;
    this.sessionName = input.sessionName;
  }
}

/**
 * Manages named persistent Playwright profiles inside the local app workspace.
 */
export class BrowserSessionService {
  readonly #activeSessions = new Map<string, ManagedBrowserSession>();
  readonly #browserType: BrowserType;
  readonly #workspaceRoot: string;

  constructor(options: BrowserSessionServiceOptions) {
    this.#workspaceRoot = options.workspaceRoot;
    this.#browserType = options.browserType ?? chromium;
  }

  /**
   * Opens a named browser context and reuses its persisted profile on later boots.
   */
  async openSession(options: OpenBrowserSessionOptions): Promise<ProviderBrowserSession> {
    const activeSession = this.#activeSessions.get(options.sessionName);

    if (activeSession) {
      if (options.authState) {
        await activeSession.setAuthState(options.authState);
      }

      return activeSession;
    }

    const sessionPaths = buildSessionPaths(this.#workspaceRoot, options.sessionName);
    const existingRecord = await readBrowserSessionRecord(sessionPaths.metadataPath);

    await mkdir(sessionPaths.userDataDir, { recursive: true });

    const context = await this.#browserType.launchPersistentContext(sessionPaths.userDataDir, {
      acceptDownloads: true,
      headless: options.headless ?? true
    });

    const now = new Date().toISOString();
    const record: BrowserSessionRecord = {
      version: 1,
      sessionName: options.sessionName,
      createdAt: existingRecord?.createdAt ?? now,
      lastOpenedAt: now,
      userDataDir: sessionPaths.userDataDir,
      authState: options.authState ?? existingRecord?.authState ?? { status: "unknown" }
    };

    await writeBrowserSessionRecord(sessionPaths.metadataPath, record);

    const session = new ManagedBrowserSession({
      context,
      onClose: () => {
        this.#activeSessions.delete(options.sessionName);
      },
      record,
      sessionPaths
    });

    this.#activeSessions.set(options.sessionName, session);

    return session;
  }

  async getSessionRecord(sessionName: string) {
    const activeSession = this.#activeSessions.get(sessionName);
    if (activeSession) {
      return activeSession.getRecord();
    }

    const sessionPaths = buildSessionPaths(this.#workspaceRoot, sessionName);
    return readBrowserSessionRecord(sessionPaths.metadataPath);
  }

  /**
   * Reads persisted auth state without opening a browser and throws typed failures
   * for missing or expired sessions.
   */
  async requireAuthenticatedSession(sessionName: string) {
    const record = await this.getSessionRecord(sessionName);

    if (record === null) {
      throw new MissingBrowserSessionStateError(sessionName);
    }

    if (record.authState.status === "unknown") {
      throw new MissingBrowserSessionAuthStateError(sessionName);
    }

    if (record.authState.status === "expired") {
      throw new ExpiredBrowserSessionAuthStateError({
        expiredAt: record.authState.expiredAt,
        providerId: record.authState.providerId,
        sessionName
      });
    }

    if (
      record.authState.expiresAt &&
      Date.parse(record.authState.expiresAt) <= Date.now()
    ) {
      throw new ExpiredBrowserSessionAuthStateError({
        expiredAt: record.authState.expiresAt,
        providerId: record.authState.providerId,
        sessionName
      });
    }

    return record;
  }

  async shutdown() {
    const activeSessions = [...this.#activeSessions.values()];
    await Promise.all(activeSessions.map((session) => session.close()));
  }
}

interface ManagedBrowserSessionOptions {
  context: BrowserContext;
  onClose: () => void;
  record: BrowserSessionRecord;
  sessionPaths: {
    metadataPath: string;
    sessionRoot: string;
    userDataDir: string;
  };
}

/**
 * Provider-oriented wrapper that keeps common browser operations typed and documented.
 * Reach for `withPage` only when the narrower helpers are not enough for a provider flow.
 */
class ManagedBrowserSession implements ProviderBrowserSession {
  readonly #context: BrowserContext;
  readonly #metadataPath: string;
  readonly #onClose: () => void;
  readonly #sessionRoot: string;

  #closed = false;
  #record: BrowserSessionRecord;

  constructor(options: ManagedBrowserSessionOptions) {
    this.#context = options.context;
    this.#metadataPath = options.sessionPaths.metadataPath;
    this.#onClose = options.onClose;
    this.#record = options.record;
    this.#sessionRoot = options.sessionPaths.sessionRoot;
    this.sessionName = options.record.sessionName;
    this.wasReused = options.record.createdAt !== options.record.lastOpenedAt;
  }

  get authState() {
    return this.#record.authState;
  }

  readonly sessionName: string;
  readonly wasReused: boolean;

  async navigate(
    options: BrowserSessionNavigationOptions
  ): Promise<BrowserSessionNavigationResult> {
    const page = await this.#getPage();
    const response = await page.goto(options.url, {
      waitUntil: options.waitUntil ?? "load"
    });

    return {
      status: response?.status() ?? null,
      url: page.url()
    };
  }

  async withPage<T>(task: (page: Page) => Promise<T>) {
    const page = await this.#getPage();
    return task(page);
  }

  async takeScreenshot(options: BrowserSessionScreenshotOptions) {
    await mkdir(path.dirname(options.path), { recursive: true });
    const page = await this.#getPage();
    await page.screenshot({
      fullPage: options.fullPage ?? false,
      path: options.path
    });

    return { path: options.path };
  }

  async captureDownload(
    options: BrowserSessionDownloadOptions
  ): Promise<BrowserSessionDownloadResult> {
    const page = await this.#getPage();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      options.trigger(page)
    ]);
    const downloadPath = await resolveDownloadPath(
      download,
      options.saveAs ?? path.join(this.#sessionRoot, "downloads", download.suggestedFilename())
    );

    return {
      path: downloadPath,
      suggestedFilename: download.suggestedFilename()
    };
  }

  async setAuthState(authState: BrowserSessionAuthState) {
    this.#record = {
      ...this.#record,
      authState
    };
    await writeBrowserSessionRecord(this.#metadataPath, this.#record);
    return this.#record;
  }

  async getRecord() {
    return this.#record;
  }

  async close() {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    await writeBrowserSessionRecord(this.#metadataPath, this.#record);
    await this.#context.close();
    this.#onClose();
  }

  async #getPage() {
    return this.#context.pages()[0] ?? this.#context.newPage();
  }
}

function buildSessionPaths(workspaceRoot: string, sessionName: string) {
  const safeSessionName = sanitizeSessionName(sessionName);
  const sessionRoot = path.join(workspaceRoot, SESSION_ROOT_DIRECTORY, safeSessionName);

  return {
    metadataPath: path.join(sessionRoot, SESSION_METADATA_FILE),
    sessionRoot,
    userDataDir: path.join(sessionRoot, SESSION_PROFILE_DIRECTORY)
  };
}

function sanitizeSessionName(sessionName: string) {
  const safeSessionName = sessionName
    .trim()
    .replaceAll(/[^a-z0-9-_]+/gi, "-")
    .replaceAll(/^-+|-+$/g, "")
    .toLowerCase();

  if (!safeSessionName) {
    throw new Error("Browser session names must contain at least one alphanumeric character.");
  }

  return safeSessionName;
}

async function readBrowserSessionRecord(metadataPath: string) {
  try {
    const fileContents = await readFile(metadataPath, "utf8");
    return JSON.parse(fileContents) as BrowserSessionRecord;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeBrowserSessionRecord(
  metadataPath: string,
  record: BrowserSessionRecord
) {
  await mkdir(path.dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, JSON.stringify(record, null, 2));
}

async function resolveDownloadPath(download: Download, targetPath: string) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await download.saveAs(targetPath);
  return targetPath;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
