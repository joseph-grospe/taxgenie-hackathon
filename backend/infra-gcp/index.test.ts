import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { hackathonSpec, resolveDeploymentProfile } from "./hackathon-spec";
import { productionSpec } from "./production-spec";

const pulumiProgram = readFileSync(
  new URL("./index.ts", import.meta.url),
  "utf8",
);

describe("minimum GCP production specification", () => {
  it("pins the production database, queue, and service sizing", () => {
    expect(productionSpec.sql).toMatchObject({
      version: "POSTGRES_17",
      tier: "db-custom-1-3840",
      diskGb: 20,
      retainedBackups: 7,
      pointInTimeRecovery: true,
      deletionProtection: true,
    });
    expect(productionSpec.queue).toMatchObject({
      id: "document-extraction",
      maxAttempts: 5,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 600,
      maxRetrySeconds: 86_400,
      maxConcurrentDispatches: 3,
      dispatchDeadlineSeconds: 1_800,
    });
    expect(productionSpec.web).toMatchObject({
      cpu: "1",
      memory: "1Gi",
      concurrency: 20,
      maxInstances: 3,
      timeoutSeconds: 300,
    });
    expect(productionSpec.worker).toMatchObject({
      cpu: "2",
      memory: "4Gi",
      concurrency: 1,
      maxInstances: 3,
      timeoutSeconds: 1_800,
    });
  });

  it("uses least-privilege roles and private service ingress", () => {
    expect(productionSpec.iam.webProjectRoles).toEqual([
      "roles/cloudsql.client",
      "roles/cloudtasks.enqueuer",
    ]);
    expect(productionSpec.iam.workerProjectRoles).toEqual([
      "roles/cloudsql.client",
    ]);
    expect(productionSpec.iam.taskInvokerRole).toBe("roles/run.invoker");
    expect(productionSpec.web.ingress).toBe(
      "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER",
    );
    expect(productionSpec.worker.ingress).toBe("INGRESS_TRAFFIC_INTERNAL_ONLY");
  });

  it("mounts optional LangSmith tracing configuration only into the worker", () => {
    expect(pulumiProgram).toContain('config.getSecret("langsmithApiKey")');
    expect(pulumiProgram).toContain('"worker-langsmith-secret"');
    expect(pulumiProgram).toContain('"TAXGENIE_LANGSMITH_ENABLED"');
    expect(pulumiProgram).toContain('"LANGSMITH_ENDPOINT"');
    expect(pulumiProgram).toContain('"LANGSMITH_PROJECT"');
    expect(pulumiProgram).toContain('"LANGSMITH_API_KEY"');
    expect(pulumiProgram).toContain("secrets.langsmithApiKey!.version.version");
  });

  it("keeps destructive services deferred and protects persistent data", () => {
    expect(productionSpec.featureFlags).toEqual({
      merge: false,
      outboundEmail: false,
      purge: false,
    });
    expect(productionSpec.deferredResources).toEqual([
      "merge",
      "outbound-email",
      "retention-purge",
    ]);
    expect(pulumiProgram).not.toMatch(/new gcp\.(cloudfunctions|pubsub)\./u);
    expect(pulumiProgram).toContain("protect: true");
    expect(pulumiProgram).toContain("publicAccessPrevention");
  });
});

describe("near-zero hackathon profile", () => {
  it("keeps production as the default and validates explicit profiles", () => {
    expect(resolveDeploymentProfile(undefined)).toBe("production");
    expect(resolveDeploymentProfile("production")).toBe("production");
    expect(resolveDeploymentProfile("hackathon")).toBe("hackathon");
    expect(() => resolveDeploymentProfile("staging")).toThrow(
      /deploymentProfile must be production or hackathon/u,
    );
  });

  it("uses unique low-cost names and scale-to-zero service limits", () => {
    expect(hackathonSpec.namePrefix).toBe("taxgenie-hack");
    expect(hackathonSpec.repositoryId).toBe("taxgenie-hackathon");
    expect(hackathonSpec.queue.id).toBe("taxgenie-hack-document-extraction");
    expect(hackathonSpec.web).toMatchObject({
      cpu: "1",
      memory: "1Gi",
      concurrency: 20,
      minInstances: 0,
      maxInstances: 1,
      ingress: "INGRESS_TRAFFIC_ALL",
    });
    expect(hackathonSpec.worker).toMatchObject({
      cpu: "2",
      memory: "4Gi",
      concurrency: 1,
      minInstances: 0,
      maxInstances: 1,
      timeoutSeconds: 1_800,
      ingress: "INGRESS_TRAFFIC_INTERNAL_ONLY",
    });
  });

  it("limits queue concurrency and expires judging objects", () => {
    expect(hackathonSpec.queue).toMatchObject({
      maxConcurrentDispatches: 1,
      maxAttempts: 5,
      minBackoffSeconds: 10,
      maxBackoffSeconds: 600,
      maxRetrySeconds: 86_400,
      dispatchDeadlineSeconds: 1_800,
    });
    expect(hackathonSpec.storage).toMatchObject({
      uniformAccess: true,
      publicAccessPrevention: "enforced",
      versioning: true,
      lifecycleDays: 40,
    });
  });

  it("has no fixed-cost GCP families or Cloud SQL permissions", () => {
    expect(hackathonSpec.excludedResourceFamilies).toEqual([
      "cloudsql",
      "load-balancer",
      "cloud-dns",
      "certificate-manager",
      "monitoring-alerts",
    ]);
    expect(hackathonSpec.iam.webProjectRoles).toEqual([
      "roles/cloudtasks.enqueuer",
    ]);
    expect(hackathonSpec.iam.workerProjectRoles).toEqual([]);
    expect(hackathonSpec.iam.migratorProjectRoles).toEqual([]);
    expect(hackathonSpec.iam.cloudBuildProjectRole).toBe(
      "roles/cloudbuild.builds.builder",
    );
    expect(pulumiProgram).toContain("if (!isHackathon)");
    expect(pulumiProgram).toContain(
      'secretEnv("DATABASE_URL", secrets.databaseUrl!.secret)',
    );
  });

  it("uses a two-connection Neon pool and keeps optional features disabled", () => {
    expect(hackathonSpec.database).toMatchObject({
      runtimePoolMax: 2,
      connectionTimeoutMs: 10_000,
    });
    expect(hackathonSpec.featureFlags).toEqual({
      merge: false,
      outboundEmail: false,
      purge: false,
    });
  });

  it("exports unavailable profile resources as explicit null values", () => {
    expect(pulumiProgram).toContain("databaseInstance?.connectionName ?? null");
    expect(pulumiProgram).toContain("webService?.uri ?? null");
    expect(pulumiProgram).toContain("migrationJob?.name ?? null");
  });
});
