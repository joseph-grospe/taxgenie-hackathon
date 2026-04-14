/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "taxtrack-backend",
      removal: input?.stage === "prod" ? "retain" : "remove",
      protect: input?.stage === "prod" ? true : false,
      home: "aws",
      providers: {
        aws: {
          region: (process.env.AWS_REGION ?? "ap-southeast-1") as any,
        },
      },
    };
  },
  async run() {
    const { buildInfrastructure } = await import("./backend/infra/index");
    return buildInfrastructure();
  },
});
