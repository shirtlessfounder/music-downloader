import { NextResponse } from "next/server";

import {
  isE2eFixtureModeEnabled,
  resetE2eFixtureState
} from "@/features/e2e/e2e-fixtures";

export async function POST() {
  if (!isE2eFixtureModeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  resetE2eFixtureState();

  return NextResponse.json({ ok: true });
}
