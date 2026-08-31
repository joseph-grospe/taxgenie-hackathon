import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import { hackathonSpec, resolveDeploymentProfile } from "./hackathon-spec";
import { productionSpec } from "./production-spec";

const config = new pulumi.Config();
const deploymentProfile = resolveDeploymentProfile(
  config.get("deploymentProfile"),
);
const isHackathon = deploymentProfile === "hackathon";
const project = gcp.config.project;
if (!project) {
  throw new Error("gcp:project must be configured for the selected stack.");
}

const activeSpec = isHackathon ? hackathonSpec : productionSpec;
const region = config.get("region") ?? activeSpec.region;
const domain = config.get("domain") ?? productionSpec.domain;
const deployServices = config.getBoolean("deployServices") ?? false;
const enableDnsCutover = config.getBoolean("enableDnsCutover") ?? false;
const configuredLangsmithApiKey = config.getSecret("langsmithApiKey");
const langsmithEnabled =
  config.getBoolean("langsmithEnabled") ??
  configuredLangsmithApiKey !== undefined;
const langsmithEndpoint =
  config.get("langsmithEndpoint") ?? "https://apac.api.smith.langchain.com";
const langsmithProject =
  config.get("langsmithProject") ?? `taxgenie-${deploymentProfile}`;
if (langsmithEnabled && !configuredLangsmithApiKey) {
  throw new Error(
    "langsmithApiKey must be configured as a Pulumi secret when langsmithEnabled=true.",
  );
}
const namePrefix = isHackathon ? hackathonSpec.namePrefix : "taxgenie-prod";
const repositoryId = isHackathon ? hackathonSpec.repositoryId : "taxgenie";
const bucketName =
  config.get("bucketName") ??
  (isHackathon
    ? `${project}-taxgenie-hackathon`
    : `${project}-taxgenie-production`);

const commonApis = [
  "artifactregistry.googleapis.com",
  "cloudbuild.googleapis.com",
  "cloudtasks.googleapis.com",
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "logging.googleapis.com",
  "run.googleapis.com",
  "secretmanager.googleapis.com",
  "storage.googleapis.com",
] as const;
const productionOnlyApis = [
  "certificatemanager.googleapis.com",
  "compute.googleapis.com",
  "dns.googleapis.com",
  "monitoring.googleapis.com",
  "sqladmin.googleapis.com",
] as const;
const requiredApis: readonly string[] = isHackathon
  ? commonApis
  : [...commonApis, ...productionOnlyApis];

const apiServices = requiredApis.map(
  (service) =>
    new gcp.projects.Service(`api-${service.split(".")[0]}`, {
      project,
      service,
      disableOnDestroy: false,
    }),
);

const repository = new gcp.artifactregistry.Repository(
  "container-repository",
  {
    project,
    location: region,
    repositoryId,
    description: isHackathon
      ? "TaxGenie hackathon judging container images"
      : "TaxGenie production container images",
    format: "DOCKER",
    cleanupPolicyDryRun: false,
    cleanupPolicies: [
      {
        id: "keep-recent",
        action: "KEEP",
        mostRecentVersions: { keepCount: isHackathon ? 1 : 20 },
      },
      ...(isHackathon
        ? [
            {
              id: "delete-old",
              action: "DELETE" as const,
              condition: {
                tagState: "ANY" as const,
                olderThan: "86400s",
              },
            },
          ]
        : []),
    ],
  },
  { dependsOn: apiServices },
);

const createDocumentBucket = (origins: pulumi.Input<string>[]) =>
  new gcp.storage.Bucket(
    "document-storage",
    {
      project,
      name: bucketName,
      location: region,
      storageClass: "STANDARD",
      forceDestroy: isHackathon,
      uniformBucketLevelAccess: activeSpec.storage.uniformAccess,
      publicAccessPrevention: activeSpec.storage.publicAccessPrevention,
      versioning: { enabled: activeSpec.storage.versioning },
      cors:
        origins.length > 0
          ? [
              {
                origins,
                methods: ["GET", "HEAD", "PUT"],
                responseHeaders: ["Content-Type", "ETag", "x-goog-generation"],
                maxAgeSeconds: activeSpec.storage.signedUrlTtlSeconds,
              },
            ]
          : [],
      lifecycleRules: isHackathon
        ? [
            {
              action: { type: "Delete" },
              condition: { age: hackathonSpec.storage.lifecycleDays },
            },
          ]
        : [],
    },
    { dependsOn: apiServices },
  );

let bucket: gcp.storage.Bucket | undefined;
if (!isHackathon) {
  bucket = createDocumentBucket([`https://${domain}`]);
} else if (!deployServices) {
  // The bootstrap pass creates storage before a Cloud Run URL exists. The full
  // pass updates CORS to the generated web service origin.
  bucket = createDocumentBucket([]);
}

const createServiceAccount = (name: string, displayName: string) =>
  new gcp.serviceaccount.Account(name, {
    project,
    accountId: `${namePrefix}-${name}`.slice(0, 30),
    displayName,
  });

const webServiceAccount = createServiceAccount("web", "TaxGenie web");
const workerServiceAccount = createServiceAccount(
  "worker",
  "TaxGenie extraction worker",
);
const taskInvokerServiceAccount = createServiceAccount(
  "task-invoker",
  "TaxGenie Cloud Tasks invoker",
);
const migratorServiceAccount = createServiceAccount(
  "migrator",
  "TaxGenie schema migrator",
);

const projectRole = (
  name: string,
  role: string,
  member: pulumi.Input<string>,
) =>
  new gcp.projects.IAMMember(
    name,
    { project, role, member },
    { dependsOn: apiServices },
  );

const serviceAccountMember = (email: pulumi.Output<string>) =>
  email.apply((value) => `serviceAccount:${value}`);

const webMember = serviceAccountMember(webServiceAccount.email);
const workerMember = serviceAccountMember(workerServiceAccount.email);
const taskInvokerMember = serviceAccountMember(taskInvokerServiceAccount.email);
const migratorMember = serviceAccountMember(migratorServiceAccount.email);

projectRole("web-task-enqueuer", "roles/cloudtasks.enqueuer", webMember);
if (isHackathon) {
  const projectDetails = gcp.organizations.getProjectOutput({
    projectId: project,
  });
  const defaultCloudBuildMember = projectDetails.number.apply(
    (number) =>
      `serviceAccount:${number}-compute@developer.gserviceaccount.com`,
  );
  projectRole(
    "hackathon-cloud-build-runner",
    hackathonSpec.iam.cloudBuildProjectRole,
    defaultCloudBuildMember,
  );
}
if (!isHackathon) {
  projectRole("web-cloudsql-client", "roles/cloudsql.client", webMember);
  projectRole("worker-cloudsql-client", "roles/cloudsql.client", workerMember);
  projectRole(
    "migrator-cloudsql-client",
    "roles/cloudsql.client",
    migratorMember,
  );
}
new gcp.serviceaccount.IAMMember("web-sign-urls", {
  serviceAccountId: webServiceAccount.name,
  role: "roles/iam.serviceAccountTokenCreator",
  member: webMember,
});
new gcp.serviceaccount.IAMMember("web-act-as-task-invoker", {
  serviceAccountId: taskInvokerServiceAccount.name,
  role: "roles/iam.serviceAccountUser",
  member: webMember,
});

const commonSecretInputs = {
  geminiApiKey: config.requireSecret("geminiApiKey"),
  betterAuthSecret: config.requireSecret("betterAuthSecret"),
  seedEmail: config.requireSecret("seedEmail"),
  seedPassword: config.requireSecret("seedPassword"),
};

const createSecret = (name: string, secretData: pulumi.Input<string>) => {
  const secret = new gcp.secretmanager.Secret(
    `${name}-secret`,
    {
      project,
      secretId: `${namePrefix}-${name}`,
      replication: { auto: {} },
    },
    { dependsOn: apiServices },
  );
  const version = new gcp.secretmanager.SecretVersion(`${name}-version`, {
    secret: secret.id,
    secretData,
  });
  return { secret, version };
};

const secrets = {
  geminiApiKey: createSecret("geminiApiKey", commonSecretInputs.geminiApiKey),
  langsmithApiKey: configuredLangsmithApiKey
    ? createSecret("langsmithApiKey", configuredLangsmithApiKey)
    : undefined,
  betterAuthSecret: createSecret(
    "betterAuthSecret",
    commonSecretInputs.betterAuthSecret,
  ),
  seedEmail: createSecret("seedEmail", commonSecretInputs.seedEmail),
  seedPassword: createSecret("seedPassword", commonSecretInputs.seedPassword),
  dbPassword: isHackathon
    ? undefined
    : createSecret("dbPassword", config.requireSecret("dbPassword")),
  databaseUrl: isHackathon
    ? createSecret("databaseUrl", config.requireSecret("databaseUrl"))
    : undefined,
  migrationDatabaseUrl: isHackathon
    ? createSecret(
        "migrationDatabaseUrl",
        config.requireSecret("migrationDatabaseUrl"),
      )
    : undefined,
};

const grantSecretAccess = (
  name: string,
  secret: gcp.secretmanager.Secret,
  member: pulumi.Input<string>,
) =>
  new gcp.secretmanager.SecretIamMember(name, {
    project,
    secretId: secret.secretId,
    role: "roles/secretmanager.secretAccessor",
    member,
  });

grantSecretAccess(
  "web-auth-secret",
  secrets.betterAuthSecret.secret,
  webMember,
);
grantSecretAccess(
  "web-db-secret",
  isHackathon ? secrets.databaseUrl!.secret : secrets.dbPassword!.secret,
  webMember,
);
grantSecretAccess(
  "worker-gemini-secret",
  secrets.geminiApiKey.secret,
  workerMember,
);
const workerLangsmithSecretAccess = langsmithEnabled
  ? grantSecretAccess(
      "worker-langsmith-secret",
      secrets.langsmithApiKey!.secret,
      workerMember,
    )
  : undefined;
grantSecretAccess(
  "worker-db-secret",
  isHackathon ? secrets.databaseUrl!.secret : secrets.dbPassword!.secret,
  workerMember,
);
grantSecretAccess(
  "migrator-db-secret",
  isHackathon
    ? secrets.migrationDatabaseUrl!.secret
    : secrets.dbPassword!.secret,
  migratorMember,
);
grantSecretAccess(
  "migrator-auth-secret",
  secrets.betterAuthSecret.secret,
  migratorMember,
);
grantSecretAccess(
  "migrator-seed-email",
  secrets.seedEmail.secret,
  migratorMember,
);
grantSecretAccess(
  "migrator-seed-password",
  secrets.seedPassword.secret,
  migratorMember,
);

let databaseInstance: gcp.sql.DatabaseInstance | undefined;
let database: gcp.sql.Database | undefined;
let databaseUser: gcp.sql.User | undefined;

if (!isHackathon) {
  databaseInstance = new gcp.sql.DatabaseInstance(
    "postgres",
    {
      project,
      name: `${namePrefix}-postgres`,
      region,
      databaseVersion: productionSpec.sql.version,
      deletionProtection: productionSpec.sql.deletionProtection,
      settings: {
        tier: productionSpec.sql.tier,
        availabilityType: "ZONAL",
        diskType: "PD_SSD",
        diskSize: productionSpec.sql.diskGb,
        diskAutoresize: true,
        ipConfiguration: {
          ipv4Enabled: true,
          sslMode: "ENCRYPTED_ONLY",
        },
        backupConfiguration: {
          enabled: true,
          pointInTimeRecoveryEnabled: productionSpec.sql.pointInTimeRecovery,
          transactionLogRetentionDays: 7,
          backupRetentionSettings: {
            retainedBackups: productionSpec.sql.retainedBackups,
            retentionUnit: "COUNT",
          },
        },
        maintenanceWindow: {
          day: 7,
          hour: 18,
          updateTrack: "stable",
        },
        insightsConfig: {
          queryInsightsEnabled: true,
          queryPlansPerMinute: 5,
          queryStringLength: 1024,
        },
      },
    },
    { dependsOn: apiServices, protect: true },
  );

  database = new gcp.sql.Database("application-database", {
    project,
    instance: databaseInstance.name,
    name: "taxgenie",
  });
  databaseUser = new gcp.sql.User("application-user", {
    project,
    instance: databaseInstance.name,
    name: "taxgenie_app",
    password: config.requireSecret("dbPassword"),
  });
}

const extractionQueue = new gcp.cloudtasks.Queue(
  "document-extraction-queue",
  {
    project,
    location: region,
    name: activeSpec.queue.id,
    rateLimits: {
      maxConcurrentDispatches: activeSpec.queue.maxConcurrentDispatches,
      maxDispatchesPerSecond: isHackathon ? 1 : 3,
    },
    retryConfig: {
      maxAttempts: activeSpec.queue.maxAttempts,
      maxRetryDuration: `${activeSpec.queue.maxRetrySeconds}s`,
      minBackoff: `${activeSpec.queue.minBackoffSeconds}s`,
      maxBackoff: `${activeSpec.queue.maxBackoffSeconds}s`,
      maxDoublings: 5,
    },
  },
  { dependsOn: apiServices },
);

let dnsZone: gcp.dns.ManagedZone | undefined;
if (!isHackathon) {
  dnsZone = new gcp.dns.ManagedZone(
    "production-zone",
    {
      project,
      name: `${namePrefix}-zone`,
      dnsName: `${domain}.`,
      description: "TaxGenie production DNS zone",
      visibility: "public",
    },
    { dependsOn: apiServices },
  );
}

let webService: gcp.cloudrunv2.Service | undefined;
let workerService: gcp.cloudrunv2.Service | undefined;
let migrationJob: gcp.cloudrunv2.Job | undefined;
let loadBalancerAddress: gcp.compute.GlobalAddress | undefined;

const secretEnv = (
  name: string,
  secret: gcp.secretmanager.Secret,
  version: pulumi.Input<string> = "latest",
) => ({
  name,
  valueSource: {
    secretKeyRef: { secret: secret.secretId, version },
  },
});

if (deployServices) {
  const webImage = config.require("webImage");
  const workerImage = config.require("workerImage");
  const migratorImage = config.require("migratorImage");
  const productionDatabaseInstance = databaseInstance!;
  const productionDatabase = database!;
  const productionDatabaseUser = databaseUser!;
  const productionDatabaseDependencies: pulumi.Resource[] = isHackathon
    ? []
    : [productionDatabase, productionDatabaseUser];
  const commonDatabaseEnv = isHackathon
    ? [
        secretEnv("DATABASE_URL", secrets.databaseUrl!.secret),
        {
          name: "PG_POOL_MAX",
          value: String(hackathonSpec.database.runtimePoolMax),
        },
        {
          name: "PG_CONNECTION_TIMEOUT_MS",
          value: String(hackathonSpec.database.connectionTimeoutMs),
        },
        {
          name: "PG_IDLE_TIMEOUT_MS",
          value: String(hackathonSpec.database.idleTimeoutMs),
        },
        {
          name: "PG_MAX_LIFETIME_SECONDS",
          value: String(hackathonSpec.database.maxLifetimeSeconds),
        },
      ]
    : [
        {
          name: "INSTANCE_UNIX_SOCKET",
          value: pulumi.interpolate`/cloudsql/${productionDatabaseInstance.connectionName}`,
        },
        { name: "DB_NAME", value: productionDatabase.name },
        { name: "DB_USER", value: productionDatabaseUser.name },
        secretEnv("DB_PASSWORD", secrets.dbPassword!.secret),
      ];
  const serviceVolumes = isHackathon
    ? []
    : [
        {
          name: "cloudsql",
          cloudSqlInstance: {
            instances: [productionDatabaseInstance.connectionName],
          },
        },
      ];
  const serviceVolumeMounts = isHackathon
    ? []
    : [{ name: "cloudsql", mountPath: "/cloudsql" }];

  workerService = new gcp.cloudrunv2.Service(
    "worker-service",
    {
      project,
      name: `${namePrefix}-worker`,
      location: region,
      ingress: activeSpec.worker.ingress,
      deletionProtection: !isHackathon,
      template: {
        serviceAccount: workerServiceAccount.email,
        timeout: `${activeSpec.worker.timeoutSeconds}s`,
        maxInstanceRequestConcurrency: activeSpec.worker.concurrency,
        scaling: {
          minInstanceCount: activeSpec.worker.minInstances,
          maxInstanceCount: activeSpec.worker.maxInstances,
        },
        annotations: { "run.googleapis.com/startup-cpu-boost": "true" },
        volumes: serviceVolumes,
        containers: [
          {
            image: workerImage,
            resources: {
              limits: {
                cpu: activeSpec.worker.cpu,
                memory: activeSpec.worker.memory,
              },
              cpuIdle: true,
            },
            ports: { containerPort: 8080 },
            volumeMounts: serviceVolumeMounts,
            envs: [
              ...commonDatabaseEnv,
              { name: "NODE_ENV", value: "production" },
              { name: "GCP_REGION", value: region },
              { name: "STORAGE_BUCKET_NAME", value: bucketName },
              { name: "STORAGE_OBJECT_PREFIX", value: "v2" },
              {
                name: "WORKER_CLAIM_LEASE_SECONDS",
                value: String(activeSpec.worker.claimLeaseSeconds),
              },
              { name: "GEMINI_MODEL", value: "gemini-3.5-flash" },
              { name: "GEMINI_THINKING_LEVEL", value: "high" },
              { name: "GEMINI_MEDIA_RESOLUTION", value: "medium" },
              secretEnv("GEMINI_API_KEY", secrets.geminiApiKey.secret),
              ...(langsmithEnabled
                ? [
                    { name: "TAXGENIE_LANGSMITH_ENABLED", value: "true" },
                    { name: "LANGSMITH_ENDPOINT", value: langsmithEndpoint },
                    { name: "LANGSMITH_PROJECT", value: langsmithProject },
                    secretEnv(
                      "LANGSMITH_API_KEY",
                      secrets.langsmithApiKey!.secret,
                      secrets.langsmithApiKey!.version.version,
                    ),
                  ]
                : [
                    {
                      name: "TAXGENIE_LANGSMITH_ENABLED",
                      value: "false",
                    },
                  ]),
            ],
            startupProbe: {
              failureThreshold: 12,
              periodSeconds: 10,
              timeoutSeconds: 2,
              tcpSocket: { port: 8080 },
            },
          },
        ],
      },
    },
    {
      dependsOn: [
        ...productionDatabaseDependencies,
        extractionQueue,
        ...(workerLangsmithSecretAccess ? [workerLangsmithSecretAccess] : []),
        ...apiServices,
      ],
    },
  );

  webService = new gcp.cloudrunv2.Service(
    "web-service",
    {
      project,
      name: `${namePrefix}-web`,
      location: region,
      ingress: activeSpec.web.ingress,
      deletionProtection: !isHackathon,
      template: {
        serviceAccount: webServiceAccount.email,
        timeout: `${activeSpec.web.timeoutSeconds}s`,
        maxInstanceRequestConcurrency: activeSpec.web.concurrency,
        scaling: {
          minInstanceCount: activeSpec.web.minInstances,
          maxInstanceCount: activeSpec.web.maxInstances,
        },
        volumes: serviceVolumes,
        containers: [
          {
            image: webImage,
            resources: {
              limits: {
                cpu: activeSpec.web.cpu,
                memory: activeSpec.web.memory,
              },
              cpuIdle: true,
            },
            ports: { containerPort: 8080 },
            volumeMounts: serviceVolumeMounts,
            envs: [
              ...commonDatabaseEnv,
              { name: "NODE_ENV", value: "production" },
              { name: "GCP_PROJECT_ID", value: project },
              { name: "GCP_REGION", value: region },
              { name: "STORAGE_BUCKET_NAME", value: bucketName },
              { name: "STORAGE_OBJECT_PREFIX", value: "v2" },
              { name: "CLOUD_TASKS_QUEUE_ID", value: extractionQueue.name },
              { name: "WORKER_SERVICE_URL", value: workerService.uri },
              {
                name: "TASK_INVOKER_SERVICE_ACCOUNT",
                value: taskInvokerServiceAccount.email,
              },
              ...(isHackathon
                ? []
                : [{ name: "BETTER_AUTH_URL", value: `https://${domain}` }]),
              { name: "TAXGENIE_ENABLE_MERGE", value: "false" },
              { name: "TAXGENIE_ENABLE_OUTBOUND_EMAIL", value: "false" },
              { name: "TAXGENIE_ENABLE_PURGE", value: "false" },
              secretEnv("BETTER_AUTH_SECRET", secrets.betterAuthSecret.secret),
            ],
            startupProbe: {
              failureThreshold: 12,
              periodSeconds: 10,
              timeoutSeconds: 2,
              tcpSocket: { port: 8080 },
            },
          },
        ],
      },
    },
    {
      dependsOn: [
        workerService,
        ...productionDatabaseDependencies,
        ...apiServices,
      ],
    },
  );

  if (isHackathon) {
    bucket = createDocumentBucket([webService.uri]);
  }

  migrationJob = new gcp.cloudrunv2.Job(
    "database-migration-job",
    {
      project,
      name: `${namePrefix}-migrate`,
      location: region,
      deletionProtection: !isHackathon,
      template: {
        taskCount: 1,
        parallelism: 1,
        template: {
          serviceAccount: migratorServiceAccount.email,
          timeout: "900s",
          maxRetries: 1,
          volumes: serviceVolumes,
          containers: [
            {
              image: migratorImage,
              volumeMounts: serviceVolumeMounts,
              envs: [
                ...(isHackathon
                  ? [
                      secretEnv(
                        "DATABASE_URL",
                        secrets.migrationDatabaseUrl!.secret,
                      ),
                    ]
                  : commonDatabaseEnv),
                { name: "NODE_ENV", value: "production" },
                secretEnv(
                  "BETTER_AUTH_SECRET",
                  secrets.betterAuthSecret.secret,
                ),
                secretEnv("TAXGENIE_SEED_EMAIL", secrets.seedEmail.secret),
                secretEnv(
                  "TAXGENIE_SEED_PASSWORD",
                  secrets.seedPassword.secret,
                ),
                { name: "TAXGENIE_SEED_NAME", value: "TaxGenie Admin" },
                { name: "TAXGENIE_ENABLE_OUTBOUND_EMAIL", value: "false" },
              ],
              resources: { limits: { cpu: "1", memory: "1Gi" } },
            },
          ],
        },
      },
    },
    { dependsOn: [...productionDatabaseDependencies, ...apiServices] },
  );

  new gcp.cloudrunv2.ServiceIamMember("public-web-invoker", {
    project,
    location: region,
    name: webService.name,
    role: "roles/run.invoker",
    member: "allUsers",
  });
  new gcp.cloudrunv2.ServiceIamMember("tasks-worker-invoker", {
    project,
    location: region,
    name: workerService.name,
    role: "roles/run.invoker",
    member: taskInvokerMember,
  });

  if (!isHackathon) {
    const productionDnsZone = dnsZone!;
    const serverlessNeg = new gcp.compute.RegionNetworkEndpointGroup(
      "web-serverless-neg",
      {
        project,
        region,
        name: `${namePrefix}-web-neg`,
        networkEndpointType: "SERVERLESS",
        cloudRun: { service: webService.name },
      },
      { dependsOn: webService },
    );
    const backend = new gcp.compute.BackendService("web-backend", {
      project,
      name: `${namePrefix}-web-backend`,
      protocol: "HTTPS",
      loadBalancingScheme: "EXTERNAL_MANAGED",
      timeoutSec: 300,
      backends: [{ group: serverlessNeg.id }],
      logConfig: { enable: true, sampleRate: 1 },
    });
    const httpsUrlMap = new gcp.compute.URLMap("https-url-map", {
      project,
      name: `${namePrefix}-https-map`,
      defaultService: backend.id,
    });
    const dnsAuthorization = new gcp.certificatemanager.DnsAuthorization(
      "domain-authorization",
      { project, name: `${namePrefix}-domain-auth`, domain },
    );
    const dnsAuthorizationRecord = new gcp.dns.RecordSet(
      "certificate-authorization-record",
      {
        project,
        managedZone: productionDnsZone.name,
        name: dnsAuthorization.dnsResourceRecords.apply(
          ([record]) => record.name,
        ),
        type: dnsAuthorization.dnsResourceRecords.apply(
          ([record]) => record.type,
        ),
        ttl: 300,
        rrdatas: [
          dnsAuthorization.dnsResourceRecords.apply(([record]) => record.data),
        ],
      },
    );
    const certificate = new gcp.certificatemanager.Certificate(
      "domain-certificate",
      {
        project,
        name: `${namePrefix}-certificate`,
        managed: {
          domains: [domain],
          dnsAuthorizations: [dnsAuthorization.id],
        },
      },
      { dependsOn: dnsAuthorizationRecord },
    );
    const certificateMap = new gcp.certificatemanager.CertificateMap(
      "certificate-map",
      { project, name: `${namePrefix}-certificate-map` },
    );
    new gcp.certificatemanager.CertificateMapEntry("certificate-map-entry", {
      project,
      name: `${namePrefix}-certificate-entry`,
      map: certificateMap.name,
      hostname: domain,
      certificates: [certificate.id],
    });
    const httpsProxy = new gcp.compute.TargetHttpsProxy("https-proxy", {
      project,
      name: `${namePrefix}-https-proxy`,
      urlMap: httpsUrlMap.id,
      certificateMap: pulumi.interpolate`//certificatemanager.googleapis.com/${certificateMap.id}`,
    });
    loadBalancerAddress = new gcp.compute.GlobalAddress("load-balancer-ip", {
      project,
      name: `${namePrefix}-ip`,
    });
    new gcp.compute.GlobalForwardingRule("https-forwarding-rule", {
      project,
      name: `${namePrefix}-https`,
      ipAddress: loadBalancerAddress.address,
      portRange: "443",
      loadBalancingScheme: "EXTERNAL_MANAGED",
      target: httpsProxy.id,
    });

    const httpRedirectMap = new gcp.compute.URLMap("http-redirect-map", {
      project,
      name: `${namePrefix}-http-redirect`,
      defaultUrlRedirect: { httpsRedirect: true, stripQuery: false },
    });
    const httpProxy = new gcp.compute.TargetHttpProxy("http-proxy", {
      project,
      name: `${namePrefix}-http-proxy`,
      urlMap: httpRedirectMap.id,
    });
    new gcp.compute.GlobalForwardingRule("http-forwarding-rule", {
      project,
      name: `${namePrefix}-http`,
      ipAddress: loadBalancerAddress.address,
      portRange: "80",
      loadBalancingScheme: "EXTERNAL_MANAGED",
      target: httpProxy.id,
    });

    if (enableDnsCutover) {
      new gcp.dns.RecordSet("production-apex", {
        project,
        managedZone: productionDnsZone.name,
        name: `${domain}.`,
        type: "A",
        ttl: 300,
        rrdatas: [loadBalancerAddress.address],
      });
    }

    new gcp.monitoring.AlertPolicy("worker-server-errors", {
      project,
      displayName: "TaxGenie worker 5xx responses",
      combiner: "OR",
      conditions: [
        {
          displayName: "Worker 5xx count",
          conditionThreshold: {
            filter: pulumi.interpolate`resource.type="cloud_run_revision" AND resource.label.service_name="${workerService.name}" AND metric.type="run.googleapis.com/request_count" AND metric.label.response_code_class="5xx"`,
            comparison: "COMPARISON_GT",
            thresholdValue: 3,
            duration: "300s",
            aggregations: [
              {
                alignmentPeriod: "300s",
                perSeriesAligner: "ALIGN_SUM",
              },
            ],
          },
        },
      ],
    });
    new gcp.monitoring.AlertPolicy("task-queue-depth", {
      project,
      displayName: "TaxGenie extraction queue depth",
      combiner: "OR",
      conditions: [
        {
          displayName: "More than 20 queued tasks",
          conditionThreshold: {
            filter: pulumi.interpolate`resource.type="cloud_tasks_queue" AND resource.label.queue_id="${extractionQueue.name}" AND metric.type="cloudtasks.googleapis.com/queue/depth"`,
            comparison: "COMPARISON_GT",
            thresholdValue: 20,
            duration: "600s",
            aggregations: [
              {
                alignmentPeriod: "300s",
                perSeriesAligner: "ALIGN_MAX",
              },
            ],
          },
        },
      ],
    });
  }
}

if (!bucket) {
  throw new Error("Document storage bucket was not created.");
}

new gcp.storage.BucketIAMMember("web-object-access", {
  bucket: bucket.name,
  role: "roles/storage.objectUser",
  member: webMember,
});
new gcp.storage.BucketIAMMember("worker-object-access", {
  bucket: bucket.name,
  role: "roles/storage.objectUser",
  member: workerMember,
});

export const selectedDeploymentProfile = deploymentProfile;
export const artifactRepository = repository.name;
export const artifactRepositoryId = repository.repositoryId;
export const storageBucket = bucket.name;
export const cloudSqlConnectionName = databaseInstance?.connectionName ?? null;
export const cloudTasksQueue = extractionQueue.id;
export const cloudTasksQueueName = extractionQueue.name;
export const cloudDnsNameServers = dnsZone?.nameServers ?? null;
export const webServiceUrl = webService?.uri ?? null;
export const workerServiceUrl = workerService?.uri ?? null;
export const migrationJobName = migrationJob?.name ?? null;
export const productionIpAddress = loadBalancerAddress?.address ?? null;
export const dnsCutoverEnabled = enableDnsCutover;
