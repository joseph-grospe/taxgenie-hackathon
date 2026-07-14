import type { DocumentIngestEventV1 } from "@taxtrack/shared";
import type { documentResults } from "../db/schema";
import type {
  CertificateMatchMetadata,
  CertificateMetadataFields,
} from "../langgraph/utils/certificateMetadata";
import type {
  ArtifactKeys,
  WorkflowDecision,
  WorkflowOutcome,
} from "../langgraph/types";

export type PersistenceOperationState =
  | "pending_artifacts"
  | "ready_to_finalize"
  | "retryable_error"
  | "completed"
  | "blocked";

export type PersistenceArtifactRole =
  | "raw_json"
  | "final_json"
  | "unsigned_pdf";

export type PersistenceArtifactState = "pending" | "verified" | "blocked";

export type PreparedDocumentResult = Omit<
  typeof documentResults.$inferInsert,
  "id" | "jobId" | "createdAt"
>;

export interface PreparedTextArtifact {
  role: Extract<PersistenceArtifactRole, "raw_json" | "final_json">;
  bucket: string;
  key: string;
  contentType: "application/json";
  body: {
    kind: "text";
    text: string;
  };
}

export interface PreparedSourcePageArtifact {
  role: "unsigned_pdf";
  bucket: string;
  key: string;
  contentType: "application/pdf";
  body: {
    kind: "source_page";
    sourceBucket: string;
    sourceKey: string;
    sourcePageNumber: number;
    sourceSha256?: string;
    inlineBody: Buffer;
  };
}

export type PreparedArtifact =
  | PreparedTextArtifact
  | PreparedSourcePageArtifact;

export interface PersistenceReservation {
  documentResultId: number;
  processedNumber: number;
  preparedAt: string;
}

export interface PreparedResultIntent {
  documentResult: PreparedDocumentResult;
  certificateMetadata: CertificateMetadataFields;
  reconciliationInput?: {
    batchId: string;
    uploadId: string;
    sourceFileId: string;
    originalFileName: string;
    normalized: Record<string, unknown>;
    metadata: CertificateMatchMetadata | null;
  };
  artifacts: PreparedArtifact[];
}

export interface PrepareResultPersistenceInput {
  event: DocumentIngestEventV1;
  outcome: WorkflowOutcome;
  payorShortName?: string | null;
  uploadedAt?: string | null;
  build: (reservation: PersistenceReservation) => PreparedResultIntent;
}

export interface PersistenceResumeResult {
  operationId: string;
  documentResultId: number;
  outcome: WorkflowOutcome;
  artifactKey?: string;
  artifactKeys: ArtifactKeys;
  decision: WorkflowDecision;
}
