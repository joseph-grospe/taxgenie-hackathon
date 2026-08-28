import { describe, expect, it } from "vitest";

import { resolveDefaultWebDomain } from "./webapp";

describe("TaxGenie web domain defaults", () => {
  it.each([
    ["dev", "dev.taxgenie.online"],
    ["dev-web", "dev.taxgenie.online"],
    ["dev-app", "dev.taxgenie.online"],
    ["uat", "uat.taxgenie.online"],
    ["uat-web", "uat.taxgenie.online"],
    ["prod", "taxgenie.online"],
    ["prod-app", "taxgenie.online"],
  ])("maps %s to %s", (stage, domain) => {
    expect(resolveDefaultWebDomain(stage)).toBe(domain);
  });

  it("does not assign a domain to unrecognized stages", () => {
    expect(resolveDefaultWebDomain("preview-123")).toBeUndefined();
    expect(resolveDefaultWebDomain()).toBeUndefined();
  });
});
