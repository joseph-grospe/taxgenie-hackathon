import type { DocumentExtractionResultV3 } from "./extractionContract";
import type {
  IdentityField,
  IdentityFieldRereadResult,
  IdentityParty,
} from "./identityFieldRereadContract";
import type { PayorSignerExtractionResult } from "./payorSignerContract";

export interface DocumentExtractionRequest {
  sourceFileId: string;
  revision: string;
  mimeType: string;
  content: Buffer;
}

export interface IdentityFieldRereadRequest {
  sourceFileId: string;
  revision: string;
  party: IdentityParty;
  field: IdentityField;
  images: Array<{
    mimeType: string;
    content: Buffer;
  }>;
}

export interface DocumentExtractionUsage {
  promptTokenCount?: number;
  outputTokenCount?: number;
  thoughtTokenCount?: number;
  totalTokenCount?: number;
}

export interface DocumentExtractionMetadata {
  provider: "gemini";
  requestedModel: string;
  responseModel?: string;
  promptVersion: string;
  schemaVersion: number;
  thinkingLevel: string;
  mediaResolution: string;
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  attemptCount: number;
  usage: DocumentExtractionUsage;
}

export interface DocumentExtractionResponse {
  result: DocumentExtractionResultV3;
  metadata: DocumentExtractionMetadata;
}

export interface PayorSignerExtractionResponse {
  result: PayorSignerExtractionResult;
  metadata: DocumentExtractionMetadata;
}

export interface IdentityFieldRereadResponse {
  result: IdentityFieldRereadResult;
  metadata: DocumentExtractionMetadata;
}

export interface DocumentExtractionClient {
  extract(
    request: DocumentExtractionRequest,
  ): Promise<DocumentExtractionResponse>;
  extractPayorSigner?(
    request: DocumentExtractionRequest,
  ): Promise<PayorSignerExtractionResponse>;
  extractIdentityField?(
    request: IdentityFieldRereadRequest,
  ): Promise<IdentityFieldRereadResponse>;
}
