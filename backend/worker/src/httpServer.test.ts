import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type { Logger } from "@taxgenie/shared";
import type { MessageDisposition } from "./consumer/messageDisposition";
import { createWorkerHttpServer } from "./httpServer";

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

async function requestWorker(input: {
  disposition?: MessageDisposition;
  error?: Error;
  body?: string;
}) {
  const app = createWorkerHttpServer({
    processTask: async () => {
      if (input.error) throw input.error;
      return input.disposition ?? { kind: "acknowledge" };
    },
    pool: { query: async () => ({ rows: [], rowCount: 1 }) } as never,
    logger,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    return await fetch(
      `http://127.0.0.1:${port}/tasks/document-extraction`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body:
          input.body ?? JSON.stringify({ event: { eventId: "event-1" } }),
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("worker HTTP task handler acknowledges successful and poison work", async () => {
  const success = await requestWorker({ disposition: { kind: "acknowledge" } });
  assert.equal(success.status, 204);

  const poison = await requestWorker({
    disposition: { kind: "poison", reason: "invalid payload" },
    body: "{",
  });
  assert.equal(poison.status, 204);
});

test("worker HTTP task handler returns 503 for retryable and busy work", async () => {
  const response = await requestWorker({
    disposition: { kind: "retry", reason: "claim is busy" },
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "retryable",
    reason: "claim is busy",
  });
});

test("worker HTTP task handler returns 500 for unexpected failures", async () => {
  const response = await requestWorker({ error: new Error("unexpected") });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "internal_error" });
});
