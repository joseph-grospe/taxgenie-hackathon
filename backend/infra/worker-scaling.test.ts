import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildWorkerInstanceSpecs } from "./compute-worker";
import { collectScheduledEc2Instances } from "./power-schedule";
import { infraSizingOutputs, resolveInfraSizing } from "./sizing";

const originalWorkerCount = process.env.TAXTRACK_WORKER_COUNT;

beforeEach(() => {
  delete process.env.TAXTRACK_WORKER_COUNT;
});

afterEach(() => {
  if (originalWorkerCount === undefined) {
    delete process.env.TAXTRACK_WORKER_COUNT;
  } else {
    process.env.TAXTRACK_WORKER_COUNT = originalWorkerCount;
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
    process.env.TAXTRACK_WORKER_COUNT = "2";
    expect(resolveInfraSizing("dev").worker.count).toBe(2);

    process.env.TAXTRACK_WORKER_COUNT = "1";
    expect(resolveInfraSizing("uat").worker.count).toBe(1);
  });

  test.each(["0", "3", "1.5", "not-a-number"])(
    "rejects invalid worker count %s",
    (workerCount) => {
      process.env.TAXTRACK_WORKER_COUNT = workerCount;
      expect(() => resolveInfraSizing("dev")).toThrow(/TAXTRACK_WORKER_COUNT/);
    },
  );

  test("publishes worker count with the existing sizing outputs", () => {
    const sizing = resolveInfraSizing("uat");
    expect(infraSizingOutputs(sizing)).toMatchObject({
      workerCount: 2,
      workerConcurrency: 3,
      workerInstanceType: "m7i.large",
    });
  });
});

describe("fixed worker instance definitions", () => {
  test("keeps the primary logical name stable and places worker two in the secondary subnet", () => {
    expect(
      buildWorkerInstanceSpecs("taxtrack-dev", 2, [
        "subnet-primary",
        "subnet-secondary",
      ]),
    ).toEqual([
      {
        logicalName: "taxtrack-dev-worker-ec2",
        nameTag: "taxtrack-dev-worker-1",
        ordinal: 1,
        subnetId: "subnet-primary",
      },
      {
        logicalName: "taxtrack-dev-worker-ec2-2",
        nameTag: "taxtrack-dev-worker-2",
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
        langfuseInstance: "langfuse",
      }),
    ).toEqual(["nat", "worker-1", "worker-2", "langfuse"]);
  });
});
