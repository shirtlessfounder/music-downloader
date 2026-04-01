import { NextResponse } from "next/server";

import {
  getSharedOperatorBrowserSessionManager,
  UnsupportedOperatorBrowserSessionProviderError
} from "@/features/browser/operator-browser-session-manager";

export async function GET() {
  const manager = getSharedOperatorBrowserSessionManager();

  return NextResponse.json({
    providers: await manager.listSessions()
  });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | {
        action?: string;
        providerId?: string;
        subjectHint?: string;
      }
    | null;

  if (!payload?.providerId?.trim()) {
    return NextResponse.json(
      { error: "providerId is required" },
      { status: 400 }
    );
  }

  const action = payload.action?.trim();
  const providerId = payload.providerId.trim();
  const manager = getSharedOperatorBrowserSessionManager();

  try {
    if (action === "launch") {
      return NextResponse.json({
        provider: await manager.launchSetup(providerId)
      });
    }

    if (action === "mark-authenticated") {
      return NextResponse.json({
        provider: await manager.markAuthenticated(providerId, {
          subjectHint: payload.subjectHint
        })
      });
    }

    return NextResponse.json(
      { error: "action must be one of: launch, mark-authenticated." },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof UnsupportedOperatorBrowserSessionProviderError) {
      return NextResponse.json(
        { error: error.message },
        { status: 404 }
      );
    }

    throw error;
  }
}
