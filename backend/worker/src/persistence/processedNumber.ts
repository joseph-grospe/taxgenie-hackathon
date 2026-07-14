import { sql } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { certificateProcessedNumberCounters } from "../db/schema";

type DbTransaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

export function getUploadMonthKey(
  uploadedAt: string | Date | null | undefined,
): string | null {
  if (!uploadedAt) {
    return null;
  }

  const date = uploadedAt instanceof Date ? uploadedAt : new Date(uploadedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function reserveCertificateProcessedNumber(
  tx: DbTransaction,
  input: {
    payorShortName?: string | null;
    uploadedAt?: string | Date | null;
  },
): Promise<number> {
  const payorShortName = input.payorShortName?.trim();
  const uploadMonth = getUploadMonthKey(input.uploadedAt);
  if (!payorShortName || !uploadMonth) {
    return 1;
  }

  const reserved = await tx
    .insert(certificateProcessedNumberCounters)
    .values({
      payorShortName,
      uploadMonth,
      lastValue: 1,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        certificateProcessedNumberCounters.payorShortName,
        certificateProcessedNumberCounters.uploadMonth,
      ],
      set: {
        lastValue: sql`${certificateProcessedNumberCounters.lastValue} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ value: certificateProcessedNumberCounters.lastValue });

  const value = reserved[0]?.value;
  if (!value) {
    throw new Error("Unable to reserve a certificate processed number.");
  }

  return value;
}
