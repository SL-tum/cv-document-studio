export type ReviewFormat = "docx" | "pptx";
export type ReviewFieldType = "text" | "list" | "collection";
export type ReviewOperationType =
  "setText" | "setList" | "appendCollectionItem";

export interface ReviewConstraints {
  recommendedCharacters?: number;
  recommendedItems?: number;
  maxLines?: number;
}

export interface ReviewField {
  targetId: string;
  label: string;
  type: ReviewFieldType;
  editable: boolean;
  operationType: ReviewOperationType;
  value?: string;
  items?: string[];
  records?: ReviewCollectionRecord[];
  collectionFields?: Array<{ key: string; label: string }>;
  constraints?: ReviewConstraints;
}

export interface ReviewCollectionRecord {
  itemId: string;
  values: Record<string, string | string[]>;
}

export interface ReviewDocument {
  sessionId: string;
  documentId: string;
  revision: number;
  format: ReviewFormat;
  fields: ReviewField[];
  warnings: string[];
  templateExtractionReview?: TemplateExtractionReviewItem[];
}

export interface TemplateExtractionReviewItem {
  targetId: string;
  label: string;
  fieldType: "text" | "list";
  confidence: number;
  explanation: string;
  sourceText: string;
  nativeRole?: string;
  slideIndex?: number;
}

export type TemplateExtractionReviewAction = "accept" | "fixed" | "ignore";

export interface ResolveTemplateExtractionReviewRequest {
  decisions: Array<{
    targetId: string;
    action: TemplateExtractionReviewAction;
  }>;
}

export interface ResolveTemplateExtractionReviewResponse {
  reviewDocument: ReviewDocument;
}

export interface ImportDocumentResponse {
  reviewDocument: ReviewDocument;
  template: TemplateLibraryItem;
}

export interface TemplateLibraryItem {
  templateId: string;
  name: string;
  fileName: string;
  format: ReviewFormat;
  createdAt: string;
  size: number;
}

export interface TemplateLibraryResponse {
  templates: TemplateLibraryItem[];
}

export interface CreateTemplateSessionResponse {
  reviewDocument: ReviewDocument;
}

export interface CandidateImportResult {
  candidateSessionId: string;
  candidateId: string;
  fileName: string;
  pageCount: number;
  characterCount: number;
  textItems: number;
  warnings: string[];
}

export interface ImportCandidateResponse {
  candidate: CandidateImportResult;
  libraryItem: CandidateLibraryItem;
}

export interface CandidateLibraryItem {
  candidateLibraryId: string;
  candidateId: string;
  name: string;
  fileName: string;
  createdAt: string;
  size: number;
  pageCount: number;
  characterCount: number;
  textItems: number;
  warnings: string[];
}

export interface CandidateLibraryResponse {
  candidates: CandidateLibraryItem[];
}

export interface CreateCandidateSessionResponse {
  candidate: CandidateImportResult;
}

export interface GenerationBrief {
  targetRole: string;
  projectBackground: string;
  requiredSkills: string[];
  emphasis: string[];
  language: string;
  additionalInstructions?: string;
}

export interface GenerateCandidateRequest {
  templateSessionId: string;
  candidateSessionId: string;
  brief?: GenerationBrief;
}

export interface GenerateCandidateResponse {
  reviewDocument: ReviewDocument;
  attempts: number;
  llmCalls: number;
  performance: GenerationPerformance;
  notApplicableFields: Array<{ targetId: string; label?: string }>;
  quality: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}

export interface GenerationPerformance {
  totalMs: number;
  mappingMs: number;
  operationExecutionMs: number;
  exportAndValidationMs: number;
  mappingCalls: number;
  layoutRetries: number;
  fullDocumentRetries: number;
  mappingConcurrency: number;
}

export interface ReviewOperationEnvelope {
  schemaVersion: "1.0";
  documentId: string;
  baseRevision: number;
  operations: Array<Record<string, unknown>>;
}

export interface OperationPreviewResponse {
  valid: boolean;
  errors: string[];
  warnings: Array<Record<string, unknown>>;
  affectedTemplateNodes: string[];
}

export type CandidateReviewIssueType =
  "grammar" | "unsupported_fact" | "contradiction";
export type CandidateReviewDecision = "apply" | "keep";

export interface CandidateReviewIssue {
  issueId: string;
  targetId: string;
  fieldLabel: string;
  type: CandidateReviewIssueType;
  severity: "warning" | "error";
  originalText: string;
  explanation: string;
  evidence?: string;
  suggestedText: string;
  suggestedOperation: Record<string, unknown>;
}

export interface CandidateQualityReviewResponse {
  reviewId: string;
  documentId: string;
  revision: number;
  candidateId: string;
  checkedFields: number;
  issues: CandidateReviewIssue[];
  metadata: {
    provider: string;
    model: string;
    llmCalls: number;
    totalMs: number;
    maxConcurrency: number;
  };
}

export interface ResolveCandidateQualityReviewRequest {
  reviewId: string;
  decisions: Array<{
    issueId: string;
    decision: CandidateReviewDecision;
  }>;
}

export interface ResolveCandidateQualityReviewResponse {
  reviewDocument: ReviewDocument;
  appliedCorrections: number;
}

export type BatchGenerationStatus =
  "processing" | "review_required" | "ready" | "completed";
export type BatchGenerationItemStatus =
  | "pending"
  | "generating"
  | "reviewing"
  | "review_required"
  | "approved"
  | "failed";

export interface CreateBatchGenerationRequest {
  templateLibraryId: string;
  candidateLibraryIds: string[];
  brief?: GenerationBrief;
}

export interface BatchGenerationItem {
  itemId: string;
  candidateLibraryId: string;
  candidateId: string;
  candidateName: string;
  candidateFileName: string;
  status: BatchGenerationItemStatus;
  documentSessionId?: string;
  outputFileName?: string;
  attempts?: number;
  llmCalls?: number;
  performance?: GenerationPerformance;
  notApplicableFields?: Array<{ targetId: string; label?: string }>;
  qualityReview?: CandidateQualityReviewResponse;
  error?: string;
}

export interface BatchGeneration {
  batchId: string;
  templateLibraryId: string;
  templateFileName: string;
  outputFormat: ReviewFormat;
  status: BatchGenerationStatus;
  createdAt: string;
  completedAt?: string;
  total: number;
  completed: number;
  approved: number;
  failed: number;
  reviewRequired: number;
  brief?: GenerationBrief;
  items: BatchGenerationItem[];
}

export interface CreateBatchGenerationResponse {
  batch: BatchGeneration;
}

export interface BatchGenerationResponse {
  batch: BatchGeneration;
}
