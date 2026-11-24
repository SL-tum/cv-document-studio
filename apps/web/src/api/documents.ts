import type {
  BatchGeneration,
  BatchGenerationResponse,
  CreateBatchGenerationRequest,
  CreateBatchGenerationResponse,
  ImportDocumentResponse,
  ImportCandidateResponse,
  CandidateImportResult,
  CandidateQualityReviewResponse,
  CandidateLibraryItem,
  CandidateLibraryResponse,
  GenerateCandidateRequest,
  GenerateCandidateResponse,
  OperationPreviewResponse,
  ReviewDocument,
  ReviewOperationEnvelope,
  ResolveCandidateQualityReviewRequest,
  ResolveCandidateQualityReviewResponse,
  ResolveTemplateExtractionReviewRequest,
  ResolveTemplateExtractionReviewResponse,
  TemplateLibraryItem,
  TemplateLibraryResponse,
} from "@cv-document-studio/review-contracts";

const backendUrl = (
  import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000"
).replace(/\/$/, "");

interface ApiError {
  detail?: string | string[];
}

export async function importOfficeDocument(
  file: File,
  signal?: AbortSignal,
): Promise<ReviewDocument> {
  const response = await fetch(
    `${backendUrl}/api/documents/import?filename=${encodeURIComponent(file.name)}`,
    { method: "POST", body: file, signal },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw apiError(result, "The document could not be imported.");
  return (result as ImportDocumentResponse).reviewDocument;
}

export async function importCandidateCv(
  file: File,
  signal?: AbortSignal,
): Promise<CandidateImportResult> {
  const response = await fetch(
    `${backendUrl}/api/candidates/import?filename=${encodeURIComponent(file.name)}`,
    { method: "POST", body: file, signal },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw apiError(result, "The candidate CV could not be imported.");
  return (result as ImportCandidateResponse).candidate;
}

export async function listCandidates(): Promise<CandidateLibraryItem[]> {
  const response = await fetch(`${backendUrl}/api/candidates`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(result, "Candidates could not be loaded.");
  return (result as CandidateLibraryResponse).candidates;
}

export async function createCandidateSession(
  candidateLibraryId: string,
): Promise<CandidateImportResult> {
  const response = await fetch(
    `${backendUrl}/api/candidates/${encodeURIComponent(candidateLibraryId)}/sessions`,
    { method: "POST" },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw apiError(result, "The candidate could not be opened.");
  return (result as { candidate: CandidateImportResult }).candidate;
}

export async function deleteCandidate(
  candidateLibraryId: string,
): Promise<void> {
  const response = await fetch(
    `${backendUrl}/api/candidates/${encodeURIComponent(candidateLibraryId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw apiError(result, "The candidate could not be deleted.");
  }
}

export async function generateCandidatePreview(
  input: GenerateCandidateRequest,
): Promise<GenerateCandidateResponse> {
  return postJson<GenerateCandidateResponse>("/api/generations", input);
}

export async function listTemplates(): Promise<TemplateLibraryItem[]> {
  const response = await fetch(`${backendUrl}/api/templates`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(result, "Templates could not be loaded.");
  return (result as TemplateLibraryResponse).templates;
}

export async function createTemplateSession(
  templateId: string,
): Promise<ReviewDocument> {
  const response = await fetch(
    `${backendUrl}/api/templates/${encodeURIComponent(templateId)}/sessions`,
    { method: "POST" },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(result, "The template could not be opened.");
  return (result as { reviewDocument: ReviewDocument }).reviewDocument;
}

export async function deleteTemplate(templateId: string): Promise<void> {
  const response = await fetch(
    `${backendUrl}/api/templates/${encodeURIComponent(templateId)}`,
    {
      method: "DELETE",
    },
  );
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw apiError(result, "The template could not be deleted.");
  }
}

export async function previewDocumentOperations(
  sessionId: string,
  envelope: ReviewOperationEnvelope,
): Promise<OperationPreviewResponse> {
  return postJson(
    `/api/documents/${encodeURIComponent(sessionId)}/operations/preview`,
    envelope,
  );
}

export async function applyDocumentOperations(
  sessionId: string,
  envelope: ReviewOperationEnvelope,
): Promise<ReviewDocument> {
  const result = await postJson<{ reviewDocument: ReviewDocument }>(
    `/api/documents/${encodeURIComponent(sessionId)}/operations`,
    envelope,
  );
  return result.reviewDocument;
}

export async function resolveTemplateExtractionReview(
  sessionId: string,
  input: ResolveTemplateExtractionReviewRequest,
): Promise<ReviewDocument> {
  const result = await postJson<ResolveTemplateExtractionReviewResponse>(
    `/api/documents/${encodeURIComponent(sessionId)}/template-extraction-review/resolve`,
    input,
  );
  return result.reviewDocument;
}

export async function downloadReviewedDocument(
  sessionId: string,
): Promise<Blob> {
  const response = await fetch(
    `${backendUrl}/api/documents/${encodeURIComponent(sessionId)}/export`,
  );
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw apiError(result, "The reviewed document could not be exported.");
  }
  return response.blob();
}

export async function reviewCandidateQuality(
  sessionId: string,
): Promise<CandidateQualityReviewResponse> {
  return postJson(
    `/api/documents/${encodeURIComponent(sessionId)}/quality-review`,
    {},
  );
}

export async function resolveCandidateQualityReview(
  sessionId: string,
  input: ResolveCandidateQualityReviewRequest,
): Promise<ResolveCandidateQualityReviewResponse> {
  return postJson(
    `/api/documents/${encodeURIComponent(sessionId)}/quality-review/resolve`,
    input,
  );
}

export async function createBatchGeneration(
  input: CreateBatchGenerationRequest,
): Promise<BatchGeneration> {
  return (await postJson<CreateBatchGenerationResponse>("/api/batches", input))
    .batch;
}

export async function getBatchGeneration(
  batchId: string,
): Promise<BatchGeneration> {
  const response = await fetch(
    `${backendUrl}/api/batches/${encodeURIComponent(batchId)}`,
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(result, "The batch could not be loaded.");
  return (result as BatchGenerationResponse).batch;
}

export async function resolveBatchQualityReview(
  batchId: string,
  itemId: string,
  input: ResolveCandidateQualityReviewRequest,
): Promise<BatchGeneration> {
  const result = await postJson<BatchGenerationResponse>(
    `/api/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/quality-review/resolve`,
    input,
  );
  return result.batch;
}

export async function downloadBatchGeneration(batchId: string): Promise<Blob> {
  const response = await fetch(
    `${backendUrl}/api/batches/${encodeURIComponent(batchId)}/export`,
  );
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw apiError(result, "The batch could not be exported.");
  }
  return response.blob();
}

export async function retryBatchGenerationItem(
  batchId: string,
  itemId: string,
): Promise<BatchGeneration> {
  const result = await postJson<BatchGenerationResponse>(
    `/api/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/retry`,
    {},
  );
  return result.batch;
}

async function postJson<T>(path: string, value: unknown): Promise<T> {
  const response = await fetch(`${backendUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(result, "The document operation failed.");
  return result as T;
}

function apiError(value: unknown, fallback: string): Error {
  const detail = (value as ApiError)?.detail;
  return new Error(
    Array.isArray(detail) ? detail.join("; ") : (detail ?? fallback),
  );
}
