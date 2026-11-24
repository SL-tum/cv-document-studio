import type { TemplateOperation } from "../llm-template/index.js";
import type { LlmGenerationResult } from "../llm-integration/index.js";
import type { OperationPreview } from "../llm-integration/execution-adapter.js";

export interface CandidatePdfTextItem {
  index: number;
  text: string;
  direction: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  hasEol: boolean;
}

export interface CandidatePdfPage {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  items: CandidatePdfTextItem[];
}

export interface CandidatePdfDocument {
  sourceFormat?: "pdf" | "docx" | "pptx";
  fileName: string;
  relativePath: string;
  sha256: string;
  byteLength: number;
  pageCount: number;
  pages: CandidatePdfPage[];
  fullText: string;
}

export interface CandidateGroundTruth {
  schemaVersion: "1.0";
  candidateId: string;
  generatedAt: string;
  documents: CandidatePdfDocument[];
  fullText: string;
  integrity: {
    totalDocuments: number;
    totalPages: number;
    pagesWithText: number;
    totalTextItems: number;
    warnings: string[];
  };
}

export interface CandidateGenerationBrief {
  targetRole: string;
  projectBackground: string;
  requiredSkills: string[];
  emphasis: string[];
  language: string;
  additionalInstructions?: string;
}

export interface CandidateFieldPlan {
  targetId: string;
  label?: string;
  nodeType: string;
  status: "filled" | "not_applicable" | "missing";
  reason?: string;
  operation?: TemplateOperation;
  operations?: TemplateOperation[];
}

export interface CandidateMappingResult {
  generation: LlmGenerationResult;
  generations: LlmGenerationResult[];
  operations: TemplateOperation[];
  fieldPlan: CandidateFieldPlan[];
  missingTargetIds: string[];
  notApplicableTargetIds: string[];
  preview: OperationPreview;
}
