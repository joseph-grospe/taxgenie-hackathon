import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { optionalString } from "./config";
import type { InfraContext, QueueResources } from "./types";

function resolveLambdaCodePath() {
  const candidates = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "lambda", "dist"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "lambda", "dist"),
    path.resolve(process.cwd(), "backend", "lambda", "dist"),
    path.resolve(process.cwd(), "..", "backend", "lambda", "dist"),
    path.resolve(process.cwd(), "lambda", "dist")
  ];

  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error("Could not locate webhook lambda build output in any expected location.");
  }

  return resolved;
}

export function createWebhookLocalDev(
  ctx: InfraContext,
  input: {
    queue: QueueResources;
  }
) {
  const webhookSecret = optionalString("webhookSecret", "TAXTRACK_WEBHOOK_SECRET") ?? "taxtrack-local-dev-secret";
  const databaseUrl =
    optionalString("localDatabaseUrl", "TAXTRACK_LOCAL_DATABASE_URL") ??
    "postgresql://taxtrack:taxtrack@localhost:5432/taxtrack";
  const langfuseEnabled = optionalString("langfuseEnabled", "TAXTRACK_LANGFUSE_ENABLED") ?? "true";
  const langfuseHost = optionalString("langfuseHost", "TAXTRACK_LANGFUSE_HOST");
  const langfusePublicKey = optionalString("langfusePublicKey", "TAXTRACK_LANGFUSE_PUBLIC_KEY") ?? "";
  const langfuseSecretKey = optionalString("langfuseSecretKey", "TAXTRACK_LANGFUSE_SECRET_KEY") ?? "";
  const lambdaCodePath = resolveLambdaCodePath();

  const lambdaEnv: Record<string, string> = {
    SQS_QUEUE_URL: input.queue.queue.url,
    DRIVE_WEBHOOK_SECRET: webhookSecret,
    DATABASE_URL: databaseUrl,
    LANGFUSE_ENABLED: langfuseEnabled,
    LANGFUSE_PUBLIC_KEY: langfusePublicKey,
    LANGFUSE_SECRET_KEY: langfuseSecretKey
  };

  if (langfuseHost) {
    lambdaEnv.LANGFUSE_HOST = langfuseHost;
  }

  const lambdaRole = new aws.iam.Role(`${ctx.namePrefix}-webhook-role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "lambda.amazonaws.com"
    })
  });

  new aws.iam.RolePolicyAttachment(`${ctx.namePrefix}-webhook-basic-execution`, {
    role: lambdaRole.name,
    policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole
  });

  new aws.iam.RolePolicy(`${ctx.namePrefix}-webhook-policy`, {
    role: lambdaRole.id,
    policy: input.queue.queue.arn.apply((queueArn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["sqs:SendMessage", "sqs:SendMessageBatch"],
            Resource: queueArn
          }
        ]
      })
    )
  });

  const webhookLambda = new aws.lambda.Function(`${ctx.namePrefix}-webhook-fn`, {
    role: lambdaRole.arn,
    runtime: "nodejs22.x",
    handler: "handler.handler",
    timeout: 30,
    memorySize: 512,
    code: new pulumi.asset.AssetArchive({
      ".": new pulumi.asset.FileArchive(lambdaCodePath)
    }),
    environment: {
      variables: lambdaEnv
    }
  });

  const api = new aws.apigatewayv2.Api(`${ctx.namePrefix}-webhook-api`, {
    protocolType: "HTTP",
    name: `${ctx.namePrefix}-webhook-api`
  });

  const integration = new aws.apigatewayv2.Integration(`${ctx.namePrefix}-webhook-integration`, {
    apiId: api.id,
    integrationType: "AWS_PROXY",
    integrationUri: webhookLambda.arn,
    payloadFormatVersion: "2.0"
  });

  new aws.apigatewayv2.Route(`${ctx.namePrefix}-webhook-route`, {
    apiId: api.id,
    routeKey: "POST /webhooks/google-drive",
    target: pulumi.interpolate`integrations/${integration.id}`
  });

  new aws.apigatewayv2.Stage(`${ctx.namePrefix}-webhook-stage`, {
    apiId: api.id,
    name: "$default",
    autoDeploy: true
  });

  new aws.lambda.Permission(`${ctx.namePrefix}-webhook-api-permission`, {
    action: "lambda:InvokeFunction",
    function: webhookLambda.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: pulumi.interpolate`${api.executionArn}/*/*`
  });

  return {
    lambda: webhookLambda,
    api
  };
}
