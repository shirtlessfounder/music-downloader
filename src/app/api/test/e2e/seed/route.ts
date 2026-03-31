import { NextResponse } from "next/server";

import {
  e2eFixtureScenarios,
  isE2eFixtureModeEnabled,
  seedE2eScenario,
  type E2eFixtureScenario
} from "@/features/e2e/e2e-fixtures";

const supportedScenarios = new Set<E2eFixtureScenario>(e2eFixtureScenarios);

export async function POST(request: Request) {
  if (!isE2eFixtureModeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as
    | {
        scenario?: string;
      }
    | null;

  if (!isE2eFixtureScenario(payload?.scenario)) {
    return NextResponse.json(
      {
        error:
          "scenario must be one of resume-matching, soundcloud-miss-heavy, or spotify-happy-path"
      },
      { status: 400 }
    );
  }

  const run = await seedE2eScenario(payload.scenario);

  return NextResponse.json({
    run: {
      id: run.id,
      playlistTitle: run.playlistTitle,
      playlistUrl: run.playlistUrl
    }
  });
}

function isE2eFixtureScenario(value: string | undefined): value is E2eFixtureScenario {
  return value !== undefined && supportedScenarios.has(value as E2eFixtureScenario);
}
