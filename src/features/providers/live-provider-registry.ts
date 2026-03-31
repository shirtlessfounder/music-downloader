import path from "node:path";

import { BrowserSessionService } from "@/features/browser/browser-session-service";

import { createBandcampProvider } from "./bandcamp";
import { createBeatportProvider } from "./beatport";
import { ProviderRegistry } from "./provider-registry";
import { createSoundCloudDirectDownloadsProvider } from "./soundcloud-direct-downloads";

type CreateLiveProviderRegistryOptions = {
  workspaceRoot?: string;
};

export function createLiveProviderRegistry(
  options: CreateLiveProviderRegistryOptions = {}
) {
  const browserSessionService = new BrowserSessionService({
    workspaceRoot: resolveWorkspaceRoot(options.workspaceRoot)
  });

  return new ProviderRegistry([
    createSoundCloudDirectDownloadsProvider({ browserSessionService }),
    createBandcampProvider({ browserSessionService }),
    createBeatportProvider()
  ]);
}

function resolveWorkspaceRoot(workspaceRoot?: string) {
  return (
    workspaceRoot ??
    process.env.MUSIC_DOWNLOADER_WORKSPACE_ROOT ??
    path.join(/* turbopackIgnore: true */ process.cwd())
  );
}
