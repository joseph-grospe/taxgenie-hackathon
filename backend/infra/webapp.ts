/// <reference path="./.sst/platform/config.d.ts" />

export function createWebTrackFrontend() {
  return new sst.aws.TanStackStart("TaxTrackWeb", {
    path: "../../webapp/tax-track",
    buildCommand: "pnpm build",
    dev: {
      command: "pnpm dev",
      directory: "../../webapp/tax-track",
      title: "TaxTrack web"
    },
  });
}
