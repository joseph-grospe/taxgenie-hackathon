import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildWorkerInstanceSpecs } from "./compute-worker";
import { collectScheduledEc2Instances } from "./power-schedule";
import { infraSizingOutputs, resolveInfraSizing } from "./sizing";

const originalWorkerCount = process.env.TAXGENIE_WORKER_COUNT;

beforeEach(() => {
  delete process.env.TAXGENIE_WORKER_COUNT;
});

afterEach(() => {
  if (originalWorkerCount === undefined) {
    delete process.env.TAXGENIE_WORKER_COUNT;
  } else {
    process.env.TAXGENIE_WORKER_COUNT = originalWorkerCount;
  }
});

describe("worker count sizing", () => {
  test("defaults Dev to one worker and UAT stages to two workers", () => {
    expect(resolveInfraSizing("dev").worker).toMatchObject({
      count: 1,
      concurrency: 3,
    });
    expect(resolveInfraSizing("uat").worker).toMatchObject({
      count: 2,
      concurrency: 3,
    });
    expect(resolveInfraSizing("uat-app").worker.count).toBe(2);
  });

  test("allows one or two workers as explicit stage overrides", () => {
    process.env.TAXGENIE_WORKER_COUNT = "2";
    expect(resolveInfraSizing("dev").worker.count).toBe(2);

    process.env.TAXGENIE_WORKER_COUNT = "1";
    expect(resolveInfraSizing("uat").worker.count).toBe(1);
  });

  test.each(["0", "3", "1.5", "not-a-number"])(
    "rejects invalid worker count %s",
    (workerCount) => {
      process.env.TAXGENIE_WORKER_COUNT = workerCount;
      expect(() => resolveInfraSizing("dev")).toThrow(/TAXGENIE_WORKER_COUNT/);
    },
  );

  test("publishes worker count with the existing sizing outputs", () => {
    const sizing = resolveInfraSizing("uat");
    const outputs = infraSizingOutputs(sizing);
    expect(outputs).toMatchObject({
      workerCount: 2,
      workerConcurrency: 3,
      workerInstanceType: "m7i.large",
    });
    expect(Object.keys(outputs)).not.toContain("langfuseInstanceType");
    expect(Object.keys(outputs)).not.toContain("langfuseRootVolumeGb");
  });
});

describe("fixed worker instance definitions", () => {
  test("keeps the primary logical name stable and places worker two in the secondary subnet", () => {
    expect(
      buildWorkerInstanceSpecs("taxgenie-dev", 2, [
        "subnet-primary",
        "subnet-secondary",
      ]),
    ).toEqual([
      {
        logicalName: "taxgenie-dev-worker-ec2",
        nameTag: "taxgenie-dev-worker-1",
        ordinal: 1,
        subnetId: "subnet-primary",
      },
      {
        logicalName: "taxgenie-dev-worker-ec2-2",
        nameTag: "taxgenie-dev-worker-2",
        ordinal: 2,
        subnetId: "subnet-secondary",
      },
    ]);
  });

  test("includes every worker in the scheduled EC2 list", () => {
    expect(
      collectScheduledEc2Instances({
        natInstance: "nat",
        workerInstances: ["worker-1", "worker-2"],
      }),
    ).toEqual(["nat", "worker-1", "worker-2"]);
  });

  test("contains no self-hosted Langfuse network, schedule, or stack resources", () => {
    for (const sourceFile of [
      "network.ts",
      "power-schedule.ts",
      "index.ts",
    ]) {
      const source = readFileSync(new URL(sourceFile, import.meta.url), "utf8");
      expect(source.toLowerCase()).not.toContain("langfuse");
    }
  });

  test("defers ECR access to the retrying worker service", () => {
    const source = readFileSync(
      new URL("compute-worker.ts", import.meta.url),
      "utf8",
    );
    const userDataStart = source.indexOf("return `#!/bin/bash");
    const serviceUnitStart = source.indexOf(
      "cat >/etc/systemd/system/taxgenie-worker.service",
      userDataStart,
    );
    const preServiceBootstrap = source.slice(userDataStart, serviceUnitStart);

    expect(userDataStart).toBeGreaterThanOrEqual(0);
    expect(serviceUnitStart).toBeGreaterThan(userDataStart);
    expect(preServiceBootstrap).not.toContain("ecr get-login-password");
    expect(source).toContain("After=docker.service network-online.target");
    expect(source).toContain("Wants=network-online.target");
    expect(source).toContain("StartLimitIntervalSec=0");
    expect(source).toContain("Restart=always");
    expect(source).toContain("RestartSec=10");
    expect(source).toContain(
      "ExecStartPre=/bin/sh -c '/usr/bin/aws ecr get-login-password",
    );
    expect(source).toContain("ExecStartPre=/usr/bin/docker pull");
    expect(source).toContain("systemctl start --no-block taxgenie-worker");
    expect(source).not.toContain("systemctl restart taxgenie-worker");
  });
});
