export const hackathonSpec = {
  region: "asia-southeast1",
  namePrefix: "taxgenie-hack",
  repositoryId: "taxgenie-hackathon",
  storage: {
    versioning: true,
    uniformAccess: true,
    publicAccessPrevention: "enforced",
    signedUrlTtlSeconds: 900,
    lifecycleDays: 40,
  },
  queue: {
    id: "taxgenie-hack-document-extraction",
    maxAttempts: 5,
    minBackoffSeconds: 10,
    maxBackoffSeconds: 600,
    maxRetrySeconds: 86_400,
    maxConcurrentDispatches: 1,
    dispatchDeadlineSeconds: 1_800,
  },
  web: {
    cpu: "1",
    memory: "1Gi",
    concurrency: 20,
    minInstances: 0,
    maxInstances: 1,
    timeoutSeconds: 300,
    ingress: "INGRESS_TRAFFIC_ALL",
  },
  worker: {
    cpu: "2",
    memory: "4Gi",
    concurrency: 1,
    minInstances: 0,
    maxInstances: 1,
    timeoutSeconds: 1_800,
    claimLeaseSeconds: 600,
    ingress: "INGRESS_TRAFFIC_INTERNAL_ONLY",
  },
  database: {
    runtimePoolMax: 2,
    connectionTimeoutMs: 10_000,
    idleTimeoutMs: 10_000,
    maxLifetimeSeconds: 60,
  },
  iam: {
    webProjectRoles: ["roles/cloudtasks.enqueuer"],
    workerProjectRoles: [],
    migratorProjectRoles: [],
    cloudBuildProjectRole: "roles/cloudbuild.builds.builder",
    taskInvokerRole: "roles/run.invoker",
  },
  featureFlags: {
    merge: false,
    outboundEmail: false,
    purge: false,
  },
  excludedResourceFamilies: [
    "cloudsql",
    "load-balancer",
    "cloud-dns",
    "certificate-manager",
    "monitoring-alerts",
  ],
} as const;

export type DeploymentProfile = "production" | "hackathon";

export function resolveDeploymentProfile(
  configuredProfile: string | undefined,
): DeploymentProfile {
  const profile = configuredProfile?.trim() || "production";
  if (profile !== "production" && profile !== "hackathon") {
    throw new Error(
      `deploymentProfile must be production or hackathon; received ${profile}`,
    );
  }
  return profile;
}
