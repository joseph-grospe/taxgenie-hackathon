import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { optionalString, requiredSecret } from "./config";
import type { DataResources, InfraContext, NetworkResources, QueueResources } from "./types";

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

export function createWebhook(
  ctx: InfraContext,
  input: {
    network: NetworkResources;
    queue: QueueResources;
    data: DataResources;
  }
) {
  const dbPassword = requiredSecret("dbPassword", "TAXTRACK_DB_PASSWORD");
  const langfuseHost = optionalString("langfuseHost", "TAXTRACK_LANGFUSE_HOST");
  const langfusePublicKey = requiredSecret("langfusePublicKey", "TAXTRACK_LANGFUSE_PUBLIC_KEY");
  const langfuseSecretKey = requiredSecret("langfuseSecretKey", "TAXTRACK_LANGFUSE_SECRET_KEY");
  const lambdaCodePath = resolveLambdaCodePath();

  const lambdaRole = new aws.iam.Role(`${ctx.namePrefix}-webhook-role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "lambda.amazonaws.com"
    })
  });

  new aws.iam.RolePolicyAttachment(`${ctx.namePrefix}-webhook-basic-execution`, {
    role: lambdaRole.name,
    policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole
  });

  new aws.iam.RolePolicyAttachment(`${ctx.namePrefix}-webhook-vpc-execution`, {
    role: lambdaRole.name,
    policyArn: aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole
  });

  new aws.iam.RolePolicy(`${ctx.namePrefix}-webhook-policy`, {
    role: lambdaRole.id,
    policy: pulumi
      .all([input.queue.queue.arn, input.data.webhookSecret.arn])
      .apply(([queueArn, secretArn]) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["sqs:SendMessage", "sqs:SendMessageBatch"],
              Resource: queueArn
            },
            {
              Effect: "Allow",
              Action: ["secretsmanager:GetSecretValue"],
              Resource: secretArn
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
    vpcConfig: {
      subnetIds: [input.network.privateSubnet.id],
      securityGroupIds: [input.network.lambdaSg.id]
    },
    environment: {
      variables: {
        SQS_QUEUE_URL: input.queue.queue.url,
        DRIVE_WEBHOOK_SECRET: input.data.webhookSecretVersion.secretString,
        DATABASE_URL: pulumi.interpolate`postgresql://${input.data.db.username}:${dbPassword}@${input.data.db.address}:${input.data.db.port}/${input.data.db.dbName}`,
        LANGFUSE_ENABLED: "true",
        LANGFUSE_PUBLIC_KEY: langfusePublicKey,
        LANGFUSE_SECRET_KEY: langfuseSecretKey,
        ...(langfuseHost ? { LANGFUSE_HOST: langfuseHost } : {})
      }
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
