import type { APIGatewayProxyEventV2 } from "aws-lambda";

const REQUIRED_HEADERS = ["x-goog-channel-id", "x-goog-resource-id", "x-goog-resource-state"] as const;

export interface WebhookValidationResult {
  valid: boolean;
  statusCode?: number;
  message?: string;
}

export function verifyWebhookRequest(
  event: APIGatewayProxyEventV2,
  expectedSecret: string
): WebhookValidationResult {
  const headers = normalizeHeaders(event.headers ?? {});

  const receivedSecret = headers["x-taxtrack-webhook-secret"];
  if (!receivedSecret || receivedSecret !== expectedSecret) {
    return {
      valid: false,
      statusCode: 401,
      message: "invalid webhook secret"
    };
  }

  for (const header of REQUIRED_HEADERS) {
    if (!headers[header]) {
      return {
        valid: false,
        statusCode: 400,
        message: `missing required header: ${header}`
      };
    }
  }

  return { valid: true };
}

export function normalizeHeaders(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === "string") {
      acc[key.toLowerCase()] = value;
    }

    return acc;
  }, {});
}
