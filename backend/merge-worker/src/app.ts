import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  assertMinimumCertificateMergeInputCount,
  createLogger,
  MERGE_PART_SIZE_LIMIT_BYTES,
  partitionCertificateMergeInputs,
} from "@taxgenie/shared";
import { config } from "dotenv";
import pg from "pg";

const repoRoot = path.resolve(process.cwd(), "../..");
const explicitEnvFile = process.env.TAXGENIE_ENV_FILE?.trim();
config({
  path: explicitEnvFile
    ? path.isAbsolute(explicitEnvFile)
      ? explicitEnvFile
      : path.resolve(repoRoot, explicitEnvFile)
    : path.resolve(repoRoot, ".env"),
});

const execFileAsync = promisify(execFile);
const logger = createLogger({ service: "merge-worker" });

type MergeInputRow = {
  id: number;
  signed_pdf_key: string;
  size_bytes: number;
  input_order: number;
  output_part_number: number | null;
};

type MergeOutputRow = {
  id: number;
  part_number: number;
  output_key: string;
  file_name: string;
};

const requireEnv = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
};

const getStorageBucket = () => requireEnv("S3_BUCKET_NAME");

const toNodePgConnectionString = (databaseUrl: string) => {
  const connectionUrl = new URL(databaseUrl);

  connectionUrl.searchParams.delete("sslmode");
  connectionUrl.searchParams.delete("sslcert");
  connectionUrl.searchParams.delete("sslkey");
  connectionUrl.searchParams.delete("sslrootcert");

  return connectionUrl.toString();
};

const LOCAL_DATABASE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
]);

const shouldUseSsl = (databaseUrl: string) => {
  const hostname = new URL(databaseUrl).hostname;
  return !LOCAL_DATABASE_HOSTS.has(hostname);
};

const buildPool = () => {
  const databaseUrl = requireEnv("DATABASE_URL");
  return new pg.Pool({
    connectionString: toNodePgConnectionString(databaseUrl),
    max: 2,
    ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });
};

const buildS3 = () =>
  new S3Client({
    region: process.env.AWS_REGION?.trim() || "ap-southeast-1",
  });

const markJob = async (
  pool: pg.Pool,
  jobId: string,
  input: {
    status: string;
    errorMessage?: string | null;
    startedAt?: Date;
    finishedAt?: Date;
  },
) => {
  await pool.query(
    `update certificate_merge_jobs
     set status = $2,
         error_message = $3,
         started_at = coalesce(started_at, $4),
         finished_at = $5,
         updated_at = now()
     where id = $1`,
    [
      jobId,
      input.status,
      input.errorMessage ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? null,
    ],
  );
};

const markPendingOutputsFailed = async (pool: pg.Pool, jobId: string) => {
  await pool.query(
    `update certificate_merge_job_outputs
     set status = 'failed',
         updated_at = now()
     where merge_job_id = $1 and status <> 'ready'`,
    [jobId],
  );
};

const getRows = async (pool: pg.Pool, jobId: string) => {
  const [inputResult, outputResult] = await Promise.all([
    pool.query<MergeInputRow>(
      `select id, signed_pdf_key, size_bytes, input_order, output_part_number
       from certificate_merge_job_inputs
       where merge_job_id = $1
       order by input_order asc`,
      [jobId],
    ),
    pool.query<MergeOutputRow>(
      `select id, part_number, output_key, file_name
       from certificate_merge_job_outputs
       where merge_job_id = $1
       order by part_number asc`,
      [jobId],
    ),
  ]);

  return {
    inputs: inputResult.rows,
    outputs: outputResult.rows,
  };
};

const validateAndPersistPartitions = async (
  pool: pg.Pool,
  jobId: string,
  inputs: MergeInputRow[],
  outputs: MergeOutputRow[],
) => {
  const parts = partitionCertificateMergeInputs(
    inputs.map((input) => ({
      id: String(input.id),
      sizeBytes: Number(input.size_bytes),
      inputId: input.id,
    })),
  );

  if (parts.length !== outputs.length) {
    throw new Error(
      `Merge manifest expected ${parts.length} outputs but found ${outputs.length}.`,
    );
  }

  logger.info("merge partitions validated", {
    jobId,
    inputCount: inputs.length,
    outputCount: outputs.length,
    partCount: parts.length,
    parts: parts.map((part) => ({
      partNumber: part.partNumber,
      inputCount: part.inputs.length,
      sizeBytes: part.sizeBytes,
    })),
  });

  const outputParts = new Set(outputs.map((output) => output.part_number));
  const partByInputId = new Map<number, number>();
  for (const part of parts) {
    if (!outputParts.has(part.partNumber)) {
      throw new Error(`Merge output part ${part.partNumber} is missing.`);
    }

    await pool.query(
      `update certificate_merge_job_outputs
       set input_count = $3,
           updated_at = now()
       where merge_job_id = $1 and part_number = $2`,
      [jobId, part.partNumber, part.inputs.length],
    );

    for (const item of part.inputs) {
      partByInputId.set(item.inputId, part.partNumber);
      await pool.query(
        `update certificate_merge_job_inputs
         set output_part_number = $3
         where merge_job_id = $1 and id = $2`,
        [jobId, item.inputId, part.partNumber],
      );
    }
  }

  return partByInputId;
};

const downloadInput = async (input: {
  s3: S3Client;
  bucket: string;
  key: string;
  targetPath: string;
}) => {
  const response = await input.s3.send(
    new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
    }),
  );

  if (!response.Body) {
    throw new Error(`S3 object body was empty: ${input.key}`);
  }

  await pipeline(
    response.Body as NodeJS.ReadableStream,
    createWriteStream(input.targetPath),
  );
};

const uploadOutput = async (input: {
  s3: S3Client;
  bucket: string;
  key: string;
  filePath: string;
}) => {
  const fileStats = await stat(input.filePath);
  const response = await input.s3.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: createReadStream(input.filePath),
      ContentLength: fileStats.size,
      ContentType: "application/pdf",
      CacheControl: "private, max-age=0, no-cache, no-store, must-revalidate",
    }),
  );

  return {
    sizeBytes: fileStats.size,
    etag: response.ETag?.replace(/"/gu, "") ?? null,
  };
};

const mergePart = async (input: {
  pool: pg.Pool;
  s3: S3Client;
  bucket: string;
  workspace: string;
  jobId: string;
  output: MergeOutputRow;
  inputs: MergeInputRow[];
}) => {
  if (input.inputs.length === 0) {
    throw new Error(`Merge output ${input.output.part_number} has no inputs.`);
  }

  const partDir = path.join(
    input.workspace,
    `part-${String(input.output.part_number).padStart(2, "0")}`,
  );
  await mkdir(partDir, { recursive: true });
  await input.pool.query(
    `update certificate_merge_job_outputs
     set status = 'processing',
         updated_at = now()
     where merge_job_id = $1 and part_number = $2`,
    [input.jobId, input.output.part_number],
  );

  logger.info("merge part started", {
    jobId: input.jobId,
    partNumber: input.output.part_number,
    outputId: input.output.id,
    outputKey: input.output.output_key,
    outputFileName: input.output.file_name,
    inputCount: input.inputs.length,
    totalInputSizeBytes: input.inputs.reduce(
      (total, row) => total + Number(row.size_bytes),
      0,
    ),
  });

  const inputPaths: string[] = [];
  for (const row of input.inputs) {
    const inputPath = path.join(
      partDir,
      `${String(row.input_order).padStart(6, "0")}.pdf`,
    );
    logger.info("merge input download started", {
      jobId: input.jobId,
      partNumber: input.output.part_number,
      inputId: row.id,
      inputOrder: row.input_order,
      s3Key: row.signed_pdf_key,
      targetPath: inputPath,
      sizeBytes: Number(row.size_bytes),
    });
    await downloadInput({
      s3: input.s3,
      bucket: input.bucket,
      key: row.signed_pdf_key,
      targetPath: inputPath,
    });
    logger.info("merge input ready", {
      jobId: input.jobId,
      partNumber: input.output.part_number,
      inputId: row.id,
      inputOrder: row.input_order,
      s3Key: row.signed_pdf_key,
      localPath: inputPath,
      sizeBytes: Number(row.size_bytes),
    });
    inputPaths.push(inputPath);
  }

  const outputPath = path.join(partDir, input.output.file_name);
  logger.info("merge qpdf started", {
    jobId: input.jobId,
    partNumber: input.output.part_number,
    outputFileName: input.output.file_name,
    outputPath,
    inputCount: inputPaths.length,
  });
  await execFileAsync("qpdf", [
    "--empty",
    "--pages",
    ...inputPaths,
    "--",
    outputPath,
  ]);

  const outputStats = await stat(outputPath);
  logger.info("merge qpdf finished", {
    jobId: input.jobId,
    partNumber: input.output.part_number,
    outputFileName: input.output.file_name,
    outputPath,
    sizeBytes: outputStats.size,
  });
  if (outputStats.size > MERGE_PART_SIZE_LIMIT_BYTES) {
    throw new Error(
      `Merged output ${input.output.file_name} exceeds the 4.8 GB limit.`,
    );
  }

  logger.info("merge output upload started", {
    jobId: input.jobId,
    partNumber: input.output.part_number,
    outputKey: input.output.output_key,
    outputFileName: input.output.file_name,
    outputPath,
    sizeBytes: outputStats.size,
  });
  const uploaded = await uploadOutput({
    s3: input.s3,
    bucket: input.bucket,
    key: input.output.output_key,
    filePath: outputPath,
  });
  logger.info("merge output uploaded", {
    jobId: input.jobId,
    partNumber: input.output.part_number,
    outputKey: input.output.output_key,
    outputFileName: input.output.file_name,
    sizeBytes: uploaded.sizeBytes,
    etag: uploaded.etag,
  });

  await input.pool.query(
    `update certificate_merge_job_outputs
     set status = 'ready',
         size_bytes = $3,
         etag = $4,
         updated_at = now()
     where merge_job_id = $1 and part_number = $2`,
    [input.jobId, input.output.part_number, uploaded.sizeBytes, uploaded.etag],
  );

  logger.info("merge part finished", {
    jobId: input.jobId,
    partNumber: input.output.part_number,
    outputId: input.output.id,
    outputKey: input.output.output_key,
    outputFileName: input.output.file_name,
    inputCount: input.inputs.length,
    sizeBytes: uploaded.sizeBytes,
  });
};

const run = async () => {
  const jobId = requireEnv("MERGE_JOB_ID");
  const bucket = getStorageBucket();
  const pool = buildPool();
  const s3 = buildS3();
  const workspace = path.join("/tmp", "taxgenie-merge", jobId);

  await mkdir(workspace, { recursive: true });
  logger.info("merge job started", {
    jobId,
    bucket,
    workspace,
  });

  try {
    await markJob(pool, jobId, {
      status: "running",
      startedAt: new Date(),
      errorMessage: null,
    });

    const { inputs, outputs } = await getRows(pool, jobId);
    logger.info("merge manifest loaded", {
      jobId,
      inputCount: inputs.length,
      outputCount: outputs.length,
      totalInputSizeBytes: inputs.reduce(
        (total, row) => total + Number(row.size_bytes),
        0,
      ),
    });
    if (inputs.length === 0 || outputs.length === 0) {
      throw new Error("Merge job manifest is empty.");
    }
    assertMinimumCertificateMergeInputCount(inputs.length);

    const partByInputId = await validateAndPersistPartitions(
      pool,
      jobId,
      inputs,
      outputs,
    );

    for (const output of outputs) {
      const partInputs = inputs.filter(
        (item) => partByInputId.get(item.id) === output.part_number,
      );
      await mergePart({
        pool,
        s3,
        bucket,
        workspace,
        jobId,
        output,
        inputs: partInputs,
      });
    }

    await markJob(pool, jobId, {
      status: "succeeded",
      errorMessage: null,
      finishedAt: new Date(),
    });
    logger.info("merge job succeeded", {
      jobId,
      inputCount: inputs.length,
      outputCount: outputs.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markPendingOutputsFailed(pool, jobId).catch(() => undefined);
    await markJob(pool, jobId, {
      status: "failed",
      errorMessage: message,
      finishedAt: new Date(),
    }).catch(() => undefined);
    logger.error("merge job failed", {
      jobId,
      errorMessage: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(
      () => undefined,
    );
    logger.info("merge job cleanup finished", {
      jobId,
      workspace,
    });
    await pool.end();
  }
};

run().catch(() => {
  process.exitCode = 1;
});
