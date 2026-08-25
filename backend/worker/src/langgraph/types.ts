import type { DocumentIngestEventV1 } from "@taxtrack/shared";
import type { DocumentExtractionMetadata } from "./services/documentExtractionClient";
import type {
  DocumentExtractionResultV3,
  ExtractedCertificate,
} from "./services/extractionContract";
import type { SignatureVisualDetectionResult } from "./utils/signatureVisualDetector";

export const MULTIPLE_CERTIFICATES_REASON_CODE =
  "multiple_certificates_detected";

export type WorkflowOutcome = "Done" | "Error" | "Duplicate";
export type WorkflowPhase = "extract" | "validate" | "persist";
export type DocumentResultStatus =
  | "accepted"
  | "manual_review"
  | "error"
  | "duplicate";
export type CertificateStatus = DocumentResultStatus;
export type TinParty = "payee" | "payor";

export type IdentityParty = "payee" | "payor";
export type IdentityField = "name" | "tin";
export type IdentityFieldPath = `${IdentityParty}.${IdentityField}`;
export type IdentityFieldVisibility = "readable" | "blank" | "unreadable";

export interface IdentityFieldCropAudit {
  preset: "tight_v1" | "expanded_v1" | "name_row_v1";
  dpi: 300 | 400;
  normalizedBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface IdentityFieldDecisionAudit {
  party: IdentityParty;
  field: IdentityField;
  fieldPath: IdentityFieldPath;
  status:
    | "accepted_first_read"
    | "confirmed_blank"
    | "reread_confirmed"
    | "reread_corrected"
    | "manual_review";
  decisionReason:
    | "first_confidence_accepted"
    | "first_read_blank"
    | "first_field_unreadable"
    | "first_confidence_below_reread_minimum"
    | "reread_confidence_accepted"
    | "reread_blank"
    | "reread_confidence_below_acceptance"
    | "reread_failed";
  pageNumber?: number;
  initialValue: string | null;
  initialConfidence: number;
  initialVisibility: IdentityFieldVisibility;
  rereadValue?: string | null;
  rereadConfidence?: number;
  rereadVisibility?: IdentityFieldVisibility;
  effectiveValue: string | null;
  effectiveConfidence: number;
  effectiveVisibility: IdentityFieldVisibility;
  crops: IdentityFieldCropAudit[];
  metadata?: DocumentExtractionMetadata;
  errorCode?: string;
  reference: "selected_entity" | "masterlist";
  referenceStatus?: "matched" | "mismatched" | "skipped" | "error";
}

export interface PageWarning {
  code: "unassigned_nonblank_page" | "unassigned_page_detection_failed";
  pageNumber: number;
}

export interface TinVerificationReadAudit {
  cropPreset: "tight_v1" | "expanded_v1";
  dpi: 300 | 400;
  normalizedBounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  tin: string | null;
  metadata?: DocumentExtractionMetadata;
  errorCode?: string;
}

export interface TinVerificationAudit {
  party: TinParty;
  status: "not_run" | "confirmed" | "corrected" | "rejected" | "failed";
  decisionReason: string;
  pageNumber?: number;
  originalTin: string | null;
  candidateTin?: string;
  effectiveTin: string | null;
  reads: TinVerificationReadAudit[];
}

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

export type ValidationCheck = {
  code: string;
  passed: boolean | null;
  message: string;
};

export interface ReconciliationTotals {
  taxBase: string | null;
  taxWithheld: string | null;
}

export interface TaxRowValidationResult {
  lineNumber: number;
  pageNumber: number;
  atcCode?: string;
  taxType?: string;
  atcRate?: number;
  computedTaxBase?: number;
  reportedTaxBase?: number;
  variance?: number;
  status: "valid" | "invalid";
  reasons: string[];
  checks: ValidationCheck[];
}

export interface ValidationResult {
  status: "valid" | "manual_review" | "invalid";
  reasons: string[];
  checks: ValidationCheck[];
  taxRows?: TaxRowValidationResult[];
  reconciliationTotals?: ReconciliationTotals;
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
  documentStatus?: DocumentResultStatus;
}

export interface MasterlistMatch {
  region: string | null;
  entity: string | null;
  shortName: string | null;
  customerName: string | null;
  tin: string | null;
  address: string | null;
  emailAddress: string | null;
  isGovernment: boolean;
}

export interface MasterlistFieldLookupResult {
  status: "matched" | "not_found" | "skipped" | "error";
  query?: string;
  matchCount: number;
  matches: MasterlistMatch[];
  error?: string;
}

export interface MasterlistLookupResult {
  status: "matched" | "not_found" | "skipped" | "error";
  payeeName?: string | null;
  payorName?: string | null;
  payorTin?: string | null;
  query?: string;
  matchCount: number;
  matches: MasterlistMatch[];
  error?: string;
  tinLookup: MasterlistFieldLookupResult;
  nameLookup: MasterlistFieldLookupResult;
}

export interface SignatureFallbackAudit {
  status: "not_run" | "detected" | "not_detected" | "failed";
  promoted: boolean;
  pageNumber?: number;
  minimumConfidence: number;
  providerSignaturePresent: boolean;
  disagreement?: boolean;
  detection?: SignatureVisualDetectionResult;
  errorCode?: string;
  textLayerRecovery?: {
    status: "not_run" | "completed" | "failed";
    recoveredFields: Array<"printedName" | "title" | "tin">;
    extractor?: "pdftotext";
    elapsedMs?: number;
    errorCode?: string;
  };
  payorSignerVerification?: {
    status:
      | "not_run"
      | "confirmed"
      | "corrected"
      | "missing"
      | "unverifiable"
      | "failed";
    source?: "text_layout" | "gemini_crop";
    pageNumber?: number;
    disagreement?: boolean;
    recoveredFields: Array<"printedName" | "title" | "tin" | "companyName">;
    latencyMs?: number;
    errorCode?: string;
  };
}

export type EffectiveCertificate = Omit<ExtractedCertificate, "signer"> & {
  signer: Omit<ExtractedCertificate["signer"], "signature"> & {
    signature: Omit<ExtractedCertificate["signer"]["signature"], "source"> & {
      source: "gemini" | "visual_fallback";
    };
  };
};

export interface WorkflowCertificateState {
  ordinal: number;
  extracted: ExtractedCertificate;
  effective: EffectiveCertificate;
  status: CertificateStatus;
  reasonCodes: string[];
  validation?: ValidationResult;
  reconciliationTotals?: ReconciliationTotals;
  masterlistLookup?: MasterlistLookupResult;
  payeeShortName?: string | null;
  payorShortName?: string | null;
  fingerprint?: string;
  duplicateOfCertificateId?: number;
  signatureFallback: SignatureFallbackAudit;
  tinVerifications?: TinVerificationAudit[];
  identityFieldDecisions?: IdentityFieldDecisionAudit[];
  certificatePdfBase64?: string;
  artifactKey?: string;
}

export interface DocumentExtractionAudit {
  metadata: DocumentExtractionMetadata;
  pageValidationIssues: Array<{
    certificateOrdinal?: number;
    code: string;
  }>;
  ignoredBlankPageNumbers: number[];
  pageWarnings: PageWarning[];
  tinVerifications: Array<
    TinVerificationAudit & { certificateOrdinal: number }
  >;
  identityFieldDecisions: Array<
    IdentityFieldDecisionAudit & { certificateOrdinal: number }
  >;
  fallbacks: Array<{
    certificateOrdinal: number;
    signature: SignatureFallbackAudit;
  }>;
  certificateSelection?: CertificateSelectionAudit;
}

export interface CertificateSelectionAudit {
  strategy: "lowest_page_then_response_order";
  detectedCount: number;
  selectedResponseOrdinal: number;
  selectedLowestPageNumber: number;
  discardedCertificates: Array<{
    responseOrdinal: number;
    pageNumbers: number[];
  }>;
}

export interface PersistedDocumentExtractionPayload {
  schemaVersion: 3;
  extraction: DocumentExtractionResultV3;
  processing: DocumentExtractionAudit & {
    sourceHash: string;
    extractedAt: string;
  };
}

export interface WorkflowState {
  event: DocumentIngestEventV1;
  jobId: string;
  extractionAttemptId: number;
  source?: WorkflowSourceInfo;
  sourceContentBase64?: string;
  extractionResult?: DocumentExtractionResultV3;
  extractionMetadata?: DocumentExtractionMetadata;
  extractionPageIssues?: Array<{
    certificateOrdinal?: number;
    code: string;
  }>;
  ignoredBlankPageNumbers?: number[];
  pageWarnings?: PageWarning[];
  certificateSelection?: CertificateSelectionAudit;
  extractionFailureTelemetry?: Record<string, unknown>;
  pageCount?: number;
  certificates?: WorkflowCertificateState[];
  documentStatus?: DocumentResultStatus;
  reasonCodes?: string[];
  decision?: WorkflowDecision;
  documentResultId?: number;
  workflowStartedAt?: string;
  workflowFinishedAt?: string;
}
