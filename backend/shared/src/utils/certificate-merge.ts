import { buildMergeOutputKey } from "./storage-keys";

export const MERGE_PART_SIZE_LIMIT_BYTES = 4_800_000_000;
export const MERGE_MAX_PARTS = 3;
export const MERGE_TOTAL_SIZE_LIMIT_BYTES =
  MERGE_PART_SIZE_LIMIT_BYTES * MERGE_MAX_PARTS;

export type CertificateMergePeriod =
  | {
      type: "annual";
      year: number;
    }
  | {
      type: "quarterly";
      year: number;
      quarter: 1 | 2 | 3 | 4;
    };

export type CertificateMergeInput = {
  id: string;
  sizeBytes: number;
};

export type CertificateMergePayorSortableInput = {
  id?: string | number;
  certificateId?: number;
  payorName?: string | null;
  payorTin?: string | null;
  originalFileName?: string | null;
};

export type CertificateMergePart<T extends CertificateMergeInput> = {
  partNumber: number;
  sizeBytes: number;
  inputs: T[];
};

const payorNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
  ignorePunctuation: true,
});

const normalizeSortText = (value: string | null | undefined) =>
  value?.trim() ?? "";

const compareOptionalText = (
  left: string | null | undefined,
  right: string | null | undefined,
) => {
  const normalizedLeft = normalizeSortText(left);
  const normalizedRight = normalizeSortText(right);
  const leftMissing = normalizedLeft.length === 0;
  const rightMissing = normalizedRight.length === 0;

  if (leftMissing || rightMissing) {
    if (leftMissing === rightMissing) {
      return 0;
    }

    return leftMissing ? 1 : -1;
  }

  return payorNameCollator.compare(normalizedLeft, normalizedRight);
};

export function compareCertificateMergePayorOrder(
  left: CertificateMergePayorSortableInput,
  right: CertificateMergePayorSortableInput,
) {
  const payorNameCompare = compareOptionalText(left.payorName, right.payorName);
  if (payorNameCompare !== 0) {
    return payorNameCompare;
  }

  const payorTinCompare = compareOptionalText(left.payorTin, right.payorTin);
  if (payorTinCompare !== 0) {
    return payorTinCompare;
  }

  const fileNameCompare = compareOptionalText(
    left.originalFileName,
    right.originalFileName,
  );
  if (fileNameCompare !== 0) {
    return fileNameCompare;
  }

  return payorNameCollator.compare(
    String(left.certificateId ?? left.id ?? ""),
    String(right.certificateId ?? right.id ?? ""),
  );
}

export function sortCertificateMergeInputsByPayorName<
  T extends CertificateMergePayorSortableInput,
>(inputs: T[]): T[] {
  return [...inputs].sort(compareCertificateMergePayorOrder);
}

export function normalizeTin9(value: string): string {
  const digits = value.replace(/\D/gu, "");
  if (digits.length < 9) {
    throw new Error("Entity TIN must contain at least 9 digits.");
  }

  return digits.slice(0, 9);
}

export function buildCertificateMergeFileName(
  tin: string,
  period: CertificateMergePeriod,
  partNumber: number,
): string {
  const tin9 = normalizeTin9(tin);
  if (
    !Number.isInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > MERGE_MAX_PARTS
  ) {
    throw new Error("Merge output part number must be between 1 and 3.");
  }

  const partToken = String(partNumber).padStart(2, "0");
  const periodToken = period.type === "annual" ? "TY" : `${period.quarter}Q`;

  return `EAFS${tin9}TCR${periodToken}12${period.year}-${partToken}.pdf`;
}

export function getCertificateMergePeriodRange(period: CertificateMergePeriod) {
  if (period.type === "annual") {
    return {
      startDate: `${period.year}-01-01`,
      endDate: `${period.year + 1}-01-01`,
    };
  }

  const startMonth = (period.quarter - 1) * 3 + 1;
  const endMonth = startMonth + 3;
  const endYear = endMonth > 12 ? period.year + 1 : period.year;
  const normalizedEndMonth = endMonth > 12 ? endMonth - 12 : endMonth;

  return {
    startDate: `${period.year}-${String(startMonth).padStart(2, "0")}-01`,
    endDate: `${endYear}-${String(normalizedEndMonth).padStart(2, "0")}-01`,
  };
}

export function partitionCertificateMergeInputs<
  T extends CertificateMergeInput,
>(
  inputs: T[],
  partSizeLimitBytes = MERGE_PART_SIZE_LIMIT_BYTES,
  maxParts = MERGE_MAX_PARTS,
): Array<CertificateMergePart<T>> {
  if (inputs.length === 0) {
    return [];
  }

  const parts: Array<CertificateMergePart<T>> = [];
  let current: CertificateMergePart<T> = {
    partNumber: 1,
    sizeBytes: 0,
    inputs: [],
  };

  for (const input of inputs) {
    if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
      throw new Error("Signed PDF size must be a positive number.");
    }

    if (input.sizeBytes > partSizeLimitBytes) {
      throw new Error("A signed PDF exceeds the 4.8 GB merge file limit.");
    }

    const wouldExceed =
      current.inputs.length > 0 &&
      current.sizeBytes + input.sizeBytes > partSizeLimitBytes;

    if (wouldExceed) {
      parts.push(current);
      current = {
        partNumber: parts.length + 1,
        sizeBytes: 0,
        inputs: [],
      };
    }

    if (current.partNumber > maxParts) {
      throw new Error(
        "Selected signed PDFs exceed the three-file merge limit.",
      );
    }

    current.inputs.push(input);
    current.sizeBytes += input.sizeBytes;
  }

  if (current.inputs.length > 0) {
    parts.push(current);
  }

  if (parts.length > maxParts) {
    throw new Error("Selected signed PDFs exceed the three-file merge limit.");
  }

  return parts;
}

export function buildCertificateMergeOutputKey(input: {
  prefix?: string;
  entityKey?: string;
  jobId: string;
  partNumber?: number;
  fileName: string;
}): string {
  if (input.entityKey && input.partNumber) {
    return buildMergeOutputKey({
      prefix: input.prefix,
      entityKey: input.entityKey,
      mergeJobId: input.jobId,
      partNumber: input.partNumber,
      fileName: input.fileName,
    });
  }

  const safeFileName = input.fileName.replace(/[^A-Za-z0-9._-]/gu, "_");
  return `merged-certificates/${input.jobId}/${safeFileName}`;
}
