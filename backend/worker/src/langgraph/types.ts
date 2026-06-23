import type { DocumentIngestEventV1 } from "@taxtrack/shared";

export type WorkflowOutcome = "Done" | "Error" | "Duplicate";

export type WorkflowPhase = "extract" | "normalize" | "validate" | "persist";

export type WorkflowDocumentKind = "upload" | "certificate";

export type PageClassification = "certificate" | "non_certificate";

export interface WorkflowSourceInfo {
  uri: string;
  bucket: string;
  key: string;
  mimeType: string;
  contentType?: string;
  size?: number;
  etag?: string;
  hash?: string;
}

export interface WorkflowArtifactPointers {
  source: string;
  rawResultJson: string;
  finalResultJson: string;
  renamedPdf?: string;
}

export interface ExtractionPayload {
  provider: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  raw: Record<string, unknown>;
  parsedText?: string;
  metadata: Record<string, unknown>;
}

export interface NormalizedField {
  value: string | number | null | boolean;
  confidence?: number;
}

export interface NormalizedFields {
  periodStart?: string;
  periodCovered?: string;
  periodEnd?: string;
  monthOfQuarter?: "first" | "second" | "third";
  payeeName?: string;
  payeeTin?: string;
  payeeAddress?: string;
  payeeZip?: string;
  payorName?: string;
  payorTin?: string;
  payorAddress?: string;
  payorZip?: string;
  atcCode?: string;
  taxBase?: number;
  taxWithheld?: number;
  printedName?: string;
  signatoryTitle?: string;
  signatoryTin?: string;
  signaturePresent?: boolean;
  signature?: string | boolean;
  companyName?: string;
  confidenceMap?: Record<string, number>;
  [key: string]: unknown;
}

export type ValidationCheck = {
  code: string;
  passed: boolean;
  message: string;
};

export interface ValidationResult {
  status: "valid" | "invalid";
  reasons: string[];
  checks: ValidationCheck[];
  atcCode?: string;
  atcRate?: number;
  computedTaxBase?: number;
  reportedTaxBase?: number;
  variance?: number;
  threshold?: number;
}

export interface WorkflowDecision {
  terminalStatus: WorkflowOutcome;
  route: "continue" | "error" | "duplicate";
  reasonCodes: string[];
  phase?: WorkflowPhase;
  startedAt?: string;
  finishedAt?: string;
  sourceFileId?: string;
  revision?: string;
}

export interface ArtifactKeys {
  source?: string;
  rawResultJson?: string;
  finalResultJson?: string;
  renamedPdf?: string;
}

export interface MasterlistMatch {
  region: string | null;
  entity: string | null;
  shortName: string | null;
  customerName: string | null;
  tin: string | null;
  address: string | null;
  emailAddress: string | null;
}

export interface MasterlistLookupResult {
  status: "matched" | "not_found" | "skipped" | "error";
  payeeName?: string;
  payorName?: string;
  payorTin?: string;
  query?: string;
  matchCount: number;
  matches: MasterlistMatch[];
  error?: string;
}

export interface WorkflowPageState {
  pageNumber: number;
  classification: PageClassification;
  sourceContentBase64?: string;
  extraction?: ExtractionPayload;
  extracted?: Record<string, unknown>;
  normalized?: Record<string, unknown>;
  validation?: ValidationResult;
  decision?: WorkflowDecision;
  artifactKeys?: ArtifactKeys;
  masterlistLookup?: MasterlistLookupResult;
}

export interface WorkflowBatchSummary {
  totalPages: number;
  certificatePageNumbers: number[];
  ignoredPageNumbers: number[];
  validPageNumbers: number[];
  failedPageNumbers: number[];
  duplicatePageNumbers: number[];
  duplicateMatches?: Array<{
    currentPageNumber: number;
    existingPageNumber: number | null;
    existingFileName: string | null;
    matchedVia: "certificate" | "upload";
  }>;
}

export interface WorkflowState {
  event: DocumentIngestEventV1;
  jobId: string;
  source?: WorkflowSourceInfo;
  extracted?: Record<string, unknown>;
  extraction?: ExtractionPayload;
  normalized?: Record<string, unknown>;
  validation?: ValidationResult;
  artifactPointers?: WorkflowArtifactPointers;
  decision?: WorkflowDecision;
  artifactKeys?: ArtifactKeys;
  sourceContentBase64?: string;
  masterlistLookup?: MasterlistLookupResult;
  pages?: WorkflowPageState[];
  batchSummary?: WorkflowBatchSummary;
  artifactKey?: string;
  workflowStartedAt?: string;
  workflowFinishedAt?: string;
}
