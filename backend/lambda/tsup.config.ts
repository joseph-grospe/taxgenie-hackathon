import { defineConfig } from "tsup";

export default defineConfig({
  skipNodeModulesBundle: false,
  noExternal: ["@taxtrack/shared", "@aws-sdk/client-sqs", "pg"]
});
