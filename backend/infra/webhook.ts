import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { existsSync } from "node:fs";
import { optionalString, requiredSecret } from "./config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DataResources,
  InfraContext,
  NetworkResources,
  QueueResources,
} from "./types";

const lambdaArchivePath = (() => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const isSstPlatformDir = dir.includes(path.join(".sst", "platform"));
  return path.resolve(
    dir,
    isSstPlatformDir ? "../../../../backend/lambda/dist" : "../../backend/lambda/dist"
  );
})();

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
  const langfuseHost = optionalString("langfuseHost", "TAXTRACK_LANGFUSE_HOST");
  const langfusePublicKey = requiredSecret("langfusePublicKey", "TAXTRACK_LANGFUSE_PUBLIC_KEY");
  const langfuseSecretKey = requiredSecret("langfuseSecretKey", "TAXTRACK_LANGFUSE_SECRET_KEY");
  const lambdaCodePath = resolveLambdaCodePath();
  const webhookSecret = pulumi
    .output(input.data.webhookSecretVersion.secretString)
    .apply((value) => value ?? "");
  const lambdaEnvironment: Record<string, pulumi.Input<string>> = {
    SQS_QUEUE_URL: input.queue.queue.url,
    DRIVE_WEBHOOK_SECRET: webhookSecret,
    DATABASE_URL: input.data.databaseUrl,
    PGSSLMODE: "require",
    LANGFUSE_ENABLED: "true",
    LANGFUSE_PUBLIC_KEY: langfusePublicKey,
    LANGFUSE_SECRET_KEY: langfuseSecretKey,
  };
  if (langfuseHost) {
    lambdaEnvironment.LANGFUSE_HOST = langfuseHost;
  }
  const workspaceLambdaEnvironment: Record<string, pulumi.Input<string>> = {
    ...lambdaEnvironment,
    S3_BUCKET: input.data.sourceFilesBucket.bucket
  };

  const lambdaRole = new aws.iam.Role(`${ctx.namePrefix}-webhook-role`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "lambda.amazonaws.com",
    }),
  });

  new aws.iam.RolePolicyAttachment(
    `${ctx.namePrefix}-webhook-basic-execution`,
    {
      role: lambdaRole.name,
      policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
    }
  );

  new aws.iam.RolePolicyAttachment(`${ctx.namePrefix}-webhook-vpc-execution`, {
    role: lambdaRole.name,
    policyArn: aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole,
  });

  new aws.iam.RolePolicy(`${ctx.namePrefix}-webhook-policy`, {
    role: lambdaRole.id,
    policy: pulumi
      .all([
        input.queue.queue.arn,
        input.data.webhookSecret.arn,
        input.data.artifactsBucket.arn,
      ])
      .apply(([queueArn, secretArn, bucketArn]) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["sqs:SendMessage", "sqs:SendMessageBatch"],
              Resource: queueArn,
            },
            {
              Effect: "Allow",
              Action: ["secretsmanager:GetSecretValue"],
              Resource: secretArn,
            },
            {
              Effect: "Allow",
              Action: ["s3:PutObject"],
              Resource: `${bucketArn}/*`,
            },
          ],
        })
      ),
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
      variables: lambdaEnvironment
    }
  });

  const workspaceWebhookLambda = new aws.lambda.Function(
    `${ctx.namePrefix}-workspace-webhook-fn`,
    {
      role: lambdaRole.arn,
      runtime: "nodejs22.x",
      handler: "workspaceEvents.handler",
      timeout: 30,
      memorySize: 512,
      code: new pulumi.asset.AssetArchive({
        ".": new pulumi.asset.FileArchive(lambdaArchivePath),
      }),
      vpcConfig: {
        subnetIds: [input.network.privateSubnet.id],
        securityGroupIds: [input.network.lambdaSg.id],
      },
      environment: { variables: workspaceLambdaEnvironment },
    }
  );

  const api = new aws.apigatewayv2.Api(`${ctx.namePrefix}-webhook-api`, {
    protocolType: "HTTP",
    name: `${ctx.namePrefix}-webhook-api`,
  });

  const integration = new aws.apigatewayv2.Integration(
    `${ctx.namePrefix}-webhook-integration`,
    {
      apiId: api.id,
      integrationType: "AWS_PROXY",
      integrationUri: webhookLambda.arn,
      payloadFormatVersion: "2.0",
    }
  );

  const workspaceIntegration = new aws.apigatewayv2.Integration(
    `${ctx.namePrefix}-workspace-webhook-integration`,
    {
      apiId: api.id,
      integrationType: "AWS_PROXY",
      integrationUri: workspaceWebhookLambda.arn,
      payloadFormatVersion: "2.0",
    }
  );

  new aws.apigatewayv2.Route(`${ctx.namePrefix}-webhook-route`, {
    apiId: api.id,
    routeKey: "POST /webhooks/google-drive",
    target: pulumi.interpolate`integrations/${integration.id}`,
  });

  new aws.apigatewayv2.Route(`${ctx.namePrefix}-webhook-workspace-route`, {
    apiId: api.id,
    routeKey: "POST /webhooks/google-workspace",
    target: pulumi.interpolate`integrations/${workspaceIntegration.id}`,
  });

  new aws.apigatewayv2.Stage(`${ctx.namePrefix}-webhook-stage`, {
    apiId: api.id,
    name: "$default",
    autoDeploy: true,
  });

  new aws.lambda.Permission(`${ctx.namePrefix}-webhook-api-permission`, {
    action: "lambda:InvokeFunction",
    function: webhookLambda.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: pulumi.interpolate`${api.executionArn}/*/*`,
  });

  new aws.lambda.Permission(
    `${ctx.namePrefix}-workspace-webhook-api-permission`,
    {
      action: "lambda:InvokeFunction",
      function: workspaceWebhookLambda.name,
      principal: "apigateway.amazonaws.com",
      sourceArn: pulumi.interpolate`${api.executionArn}/*/*`,
    }
  );

  return {
    lambda: webhookLambda,
    workspaceLambda: workspaceWebhookLambda,
    api,
  };
}
