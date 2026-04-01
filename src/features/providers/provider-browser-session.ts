import {
  BrowserSessionOwnershipConflictError,
  ExpiredBrowserSessionAuthStateError,
  MissingBrowserSessionAuthStateError,
  MissingBrowserSessionStateError,
  type BrowserSessionService
} from "@/features/browser/browser-session-service";

import {
  buildProviderRejectedResult,
  type ProviderCandidate
} from "./provider-registry";

type BackgroundProviderBrowserSessionService = Pick<
  BrowserSessionService,
  "openSession"
>;

type AuthenticatedBackgroundProviderBrowserSessionService = Pick<
  BrowserSessionService,
  "openSession" | "requireAuthenticatedSession"
>;

type ProviderSessionContext = {
  candidate?: ProviderCandidate;
  providerId: string;
  providerName: string;
  sessionName: string;
};

export async function openBackgroundProviderSession(
  input: ProviderSessionContext & {
    browserSessionService: BackgroundProviderBrowserSessionService;
  }
) {
  try {
    return await input.browserSessionService.openSession({
      owner: "background",
      sessionName: input.sessionName
    });
  } catch (error) {
    if (error instanceof BrowserSessionOwnershipConflictError) {
      return buildProviderRejectedResult({
        candidate: input.candidate,
        detail: buildOwnershipConflictDetail({
          activeOwner: error.activeOwner,
          providerName: input.providerName
        }),
        providerId: input.providerId,
        providerName: input.providerName,
        reason: "provider-session-active"
      });
    }

    throw error;
  }
}

export async function openAuthenticatedBackgroundProviderSession(
  input: ProviderSessionContext & {
    authRequiredDetail: string;
    browserSessionService: AuthenticatedBackgroundProviderBrowserSessionService;
    expiredDetail: string;
  }
) {
  try {
    await input.browserSessionService.requireAuthenticatedSession(input.sessionName);
  } catch (error) {
    if (
      error instanceof MissingBrowserSessionStateError ||
      error instanceof MissingBrowserSessionAuthStateError
    ) {
      return buildProviderRejectedResult({
        candidate: input.candidate,
        detail: input.authRequiredDetail,
        providerId: input.providerId,
        providerName: input.providerName,
        reason: "auth-required"
      });
    }

    if (error instanceof ExpiredBrowserSessionAuthStateError) {
      return buildProviderRejectedResult({
        candidate: input.candidate,
        detail: input.expiredDetail,
        providerId: input.providerId,
        providerName: input.providerName,
        reason: "provider-session-expired"
      });
    }

    throw error;
  }

  return openBackgroundProviderSession(input);
}

function buildOwnershipConflictDetail(input: {
  activeOwner: "background" | "operator";
  providerName: string;
}) {
  if (input.activeOwner === "operator") {
    return `An operator-owned browser session is already open for ${input.providerName}. Finish or close it before background provider work can run.`;
  }

  return `Another background browser session is already active for ${input.providerName}. Wait for it to finish before retrying provider work.`;
}
