import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type {
  BatchGeneration,
  BatchGenerationItem,
  CandidateImportResult,
  CandidateLibraryItem,
  CandidateQualityReviewResponse,
  CreateBatchGenerationRequest,
  GenerateCandidateRequest,
  GenerationBrief,
  ReviewDocument,
  ReviewField,
  ResolveCandidateQualityReviewRequest,
  ResolveTemplateExtractionReviewRequest,
} from "@cv-document-studio/review-contracts";
import { strToU8, zipSync } from "fflate";
import {
  resolveProjectPath,
  TEMPLATE_OPERATION_SCHEMA_VERSION,
  assessGeneratedOutput,
  cleanDocxLayoutBeforeExport,
  Gemini35FlashProvider,
  executeOperationsAtomically,
  exportDocx,
  exportPptx,
  extractDocxTemplate,
  extractPptxTemplate,
  extractTextPdfBytes,
  extractTextOfficeBytes,
  importDocx,
  importPptx,
  mapCandidateToTemplate,
  mergeLlmTemplateSemanticDecisions,
  unresolvedSemanticCandidates,
  parseStructuredOutput,
  previewOperations,
  type DocumentRoot,
  type ExtractionResult,
  type LlmTemplateDocument,
  type FlowDocumentRoot,
  type PresentationDocumentRoot,
  type RichDocument,
  type TemplateNode,
  type CandidateGroundTruth,
} from "@document-tree/rdt";
import {
  LocalTemplateStore,
  type StoredTemplate,
} from "./local-template-store.js";
import { CandidateQualityReviewer } from "./candidate-quality-review.js";
import { LocalCandidateStore } from "./local-candidate-store.js";
import { TemplateSemanticReviewer } from "./template-semantic-review.js";
import {
  resolveTemplateExtractionReview,
  templateExtractionReviewItems,
} from "./template-extraction-review.js";

type TemplateReviewDocument = Omit<ReviewDocument, "sessionId">;

interface TemplateSnapshot {
  readonly filename: string;
  readonly masterBytes: Uint8Array;
  readonly document: RichDocument<DocumentRoot>;
  readonly extracted: ExtractionResult;
  readonly reviewDocument: TemplateReviewDocument;
}

interface DocumentSession {
  id: string;
  templateId?: string;
  filename: string;
  document: RichDocument<DocumentRoot>;
  extracted: ExtractionResult;
  snapshot: TemplateSnapshot;
  candidateSessionId?: string;
  pendingQualityReview?: CandidateQualityReviewResponse;
  qualityApprovalRevision?: number;
}

interface InternalBatchItem extends BatchGenerationItem {}

interface InternalBatch {
  batchId: string;
  templateLibraryId: string;
  templateFileName: string;
  outputFormat: "docx" | "pptx";
  createdAt: string;
  completedAt?: string;
  exported: boolean;
  brief?: GenerationBrief;
  items: InternalBatchItem[];
}

const sessions = new Map<string, DocumentSession>();
const candidateSessions = new Map<string, CandidateGroundTruth>();
const batches = new Map<string, InternalBatch>();
const templateSnapshots = new Map<string, TemplateSnapshot>();
const templateSnapshotPromises = new Map<string, Promise<TemplateSnapshot>>();
let templateSnapshotBuilds = 0;
let templateSemanticReviews = 0;
const llmResponseDirectory = resolveProjectPath(
  process.env.LLM_RESPONSE_DIR ?? "manual/llm-responses",
);
const templateStore = new LocalTemplateStore(resolveProjectPath(
  process.env.CV_STUDIO_TEMPLATE_DIRECTORY ?? "data/templates",
));
const candidateStore = new LocalCandidateStore(resolveProjectPath(
  process.env.CV_STUDIO_CANDIDATE_DIRECTORY ?? "data/candidates",
));
const port = Number(process.env.CV_STUDIO_API_PORT ?? 8000);
const frontendOrigin =
  process.env.CV_STUDIO_FRONTEND_ORIGIN ?? "http://localhost:5173";

const server = createServer(async (request, response) => {
  setCors(request, response);
  if (request.method === "OPTIONS") return send(response, 204, undefined);
  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json(response, 200, {
        ok: true,
        templateSessions: sessions.size,
        candidateSessions: candidateSessions.size,
        cachedTemplateSnapshots: templateSnapshots.size,
        templateSnapshotBuilds,
        templateSemanticReviews,
      });
    }
    if (request.method === "GET" && url.pathname === "/api/templates") {
      return json(response, 200, { templates: await templateStore.list() });
    }
    if (request.method === "GET" && url.pathname === "/api/candidates") {
      return json(response, 200, { candidates: await candidateStore.list() });
    }
    if (request.method === "POST" && url.pathname === "/api/documents/import") {
      const filename = url.searchParams.get("filename") ?? "document.docx";
      const bytes = await readBody(request);
      const snapshot = await createTemplateSnapshot(filename, bytes);
      const template = await templateStore.create(filename, bytes);
      templateSnapshots.set(template.templateId, snapshot);
      const session = createSessionFromSnapshot(snapshot, template.templateId);
      sessions.set(session.id, session);
      return json(response, 201, {
        reviewDocument: toReviewDocument(session),
        template,
      });
    }
    if (
      request.method === "POST" &&
      url.pathname === "/api/candidates/import"
    ) {
      const filename = url.searchParams.get("filename") ?? "candidate.pdf";
      const format = candidateFormat(filename);
      if (!format)
        return json(response, 415, {
          detail: "Candidate CV must be a PDF, DOCX, or PPTX file.",
        });
      const bytes = await readBody(request);
      const document =
        format === "pdf"
          ? await extractTextPdfBytes(bytes, filename)
          : extractTextOfficeBytes(bytes, filename, format);
      const candidateSessionId = randomUUID();
      const candidateId =
        filename.replace(/\.(?:pdf|docx|pptx)$/iu, "") || candidateSessionId;
      const groundTruth: CandidateGroundTruth = {
        schemaVersion: "1.0",
        candidateId,
        generatedAt: new Date().toISOString(),
        documents: [document],
        fullText: `===== ${filename} =====\n${document.fullText}`,
        integrity: {
          totalDocuments: 1,
          totalPages: document.pageCount,
          pagesWithText: document.pages.filter((page) => page.text.trim())
            .length,
          totalTextItems: document.pages.reduce(
            (sum, page) => sum + page.items.length,
            0,
          ),
          warnings: [],
        },
      };
      candidateSessions.set(candidateSessionId, groundTruth);
      const libraryItem = await candidateStore.create(
        filename,
        bytes,
        groundTruth,
      );
      return json(response, 201, {
        candidate: toCandidateImportResult(candidateSessionId, libraryItem),
        libraryItem,
      });
    }
    if (request.method === "POST" && url.pathname === "/api/generations") {
      const input = JSON.parse(
        (await readBody(request)).toString("utf8"),
      ) as GenerateCandidateRequest;
      const templateSession = sessions.get(input.templateSessionId);
      const candidate = candidateSessions.get(input.candidateSessionId);
      if (!templateSession)
        return json(response, 404, { detail: "Template session not found." });
      if (!candidate)
        return json(response, 404, { detail: "Candidate session not found." });
      const pendingTemplateReview = templateExtractionReviewItems(
        templateSession.extracted,
      );
      if (pendingTemplateReview.length)
        return json(response, 409, {
          detail: `Review ${pendingTemplateReview.length} ambiguous template field(s) before generation.`,
        });
      const generation = await generateCandidateDocument(
        templateSession,
        candidate,
        normalizeGenerationBrief(input.brief),
      );
      templateSession.candidateSessionId = input.candidateSessionId;
      delete templateSession.pendingQualityReview;
      delete templateSession.qualityApprovalRevision;
      return json(response, 200, generation);
    }
    if (request.method === "POST" && url.pathname === "/api/batches") {
      const input = JSON.parse(
        (await readBody(request)).toString("utf8"),
      ) as CreateBatchGenerationRequest;
      const batch = await createBatch(input);
      batches.set(batch.batchId, batch);
      void runBatch(batch);
      return json(response, 202, { batch: publicBatch(batch) });
    }
    const batchMatch = url.pathname.match(
      /^\/api\/batches\/([^/]+)(?:\/(.*))?$/u,
    );
    if (batchMatch) {
      const batch = batches.get(decodeURIComponent(batchMatch[1]!));
      if (!batch) return json(response, 404, { detail: "Batch not found." });
      const action = batchMatch[2] ?? "";
      if (request.method === "GET" && action === "") {
        return json(response, 200, { batch: publicBatch(batch) });
      }
      if (request.method === "GET" && action === "export") {
        if (
          batch.items.some((item) =>
            ["pending", "generating", "reviewing", "review_required"].includes(
              item.status,
            ),
          )
        ) {
          return json(response, 409, {
            detail:
              "Wait for generation and resolve every quality review before exporting.",
          });
        }
        const approved = batch.items.filter(
          (item) => item.status === "approved",
        );
        if (!approved.length) {
          return json(response, 409, {
            detail: "This batch has no approved documents.",
          });
        }
        const files: Record<string, Uint8Array> = {};
        for (const item of approved) {
          const session = item.documentSessionId
            ? sessions.get(item.documentSessionId)
            : undefined;
          if (!session)
            throw new Error(
              `Document session is missing for ${item.candidateName}.`,
            );
          const exported = exportSession(session);
          if (!exported.quality.valid) {
            throw new Error(
              `Export validation failed for ${item.candidateName}: ${exported.quality.errors.join("; ")}`,
            );
          }
          files[`documents/${item.outputFileName}`] = exported.bytes;
        }
        batch.exported = true;
        files["manifest.json"] = strToU8(
          `${JSON.stringify(publicBatch(batch), null, 2)}\n`,
        );
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/zip");
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="cv-batch-${batch.batchId.slice(0, 8)}.zip"`,
        );
        return response.end(zipSync(files));
      }
      const resolveMatch = action.match(
        /^items\/([^/]+)\/quality-review\/resolve$/u,
      );
      if (request.method === "POST" && resolveMatch) {
        const item = batch.items.find(
          (entry) => entry.itemId === decodeURIComponent(resolveMatch[1]!),
        );
        if (
          !item ||
          item.status !== "review_required" ||
          !item.documentSessionId
        ) {
          return json(response, 409, {
            detail: "Batch item is not awaiting quality review.",
          });
        }
        const session = sessions.get(item.documentSessionId);
        if (!session)
          return json(response, 404, { detail: "Document session not found." });
        const input = JSON.parse(
          (await readBody(request)).toString("utf8"),
        ) as ResolveCandidateQualityReviewRequest;
        const result = resolveSessionQualityReview(session, input);
        item.status = "approved";
        delete item.qualityReview;
        finishBatchIfSettled(batch);
        return json(response, 200, { batch: publicBatch(batch), ...result });
      }
      const retryMatch = action.match(/^items\/([^/]+)\/retry$/u);
      if (request.method === "POST" && retryMatch) {
        if (publicBatch(batch).status === "processing") {
          return json(response, 409, {
            detail: "Wait for the current batch work before retrying.",
          });
        }
        const item = batch.items.find(
          (entry) => entry.itemId === decodeURIComponent(retryMatch[1]!),
        );
        if (!item || item.status !== "failed") {
          return json(response, 409, {
            detail: "Only failed batch items can be retried.",
          });
        }
        delete item.error;
        delete item.documentSessionId;
        delete item.attempts;
        delete item.llmCalls;
        delete item.qualityReview;
        delete batch.completedAt;
        batch.exported = false;
        item.status = "pending";
        void runBatchItem(batch, item).then(() => finishBatchIfSettled(batch));
        return json(response, 202, { batch: publicBatch(batch) });
      }
      return json(response, 404, { detail: "Route not found." });
    }
    const templateMatch = url.pathname.match(
      /^\/api\/templates\/([^/]+)(?:\/(.*))?$/u,
    );
    if (templateMatch) {
      const templateId = decodeURIComponent(templateMatch[1]!);
      const action = templateMatch[2] ?? "";
      if (request.method === "POST" && action === "sessions") {
        const stored = await templateStore.get(templateId);
        if (!stored)
          return json(response, 404, { detail: "Template not found." });
        const snapshot = await getOrCreateTemplateSnapshot(templateId, stored);
        const session = createSessionFromSnapshot(snapshot, templateId);
        sessions.set(session.id, session);
        return json(response, 201, {
          reviewDocument: toReviewDocument(session),
        });
      }
      if (request.method === "DELETE" && action === "") {
        if (!(await templateStore.delete(templateId))) {
          return json(response, 404, { detail: "Template not found." });
        }
        templateSnapshots.delete(templateId);
        return send(response, 204, undefined);
      }
      return json(response, 404, { detail: "Route not found." });
    }
    const candidateMatch = url.pathname.match(
      /^\/api\/candidates\/([^/]+)(?:\/(.*))?$/u,
    );
    if (candidateMatch) {
      const candidateLibraryId = decodeURIComponent(candidateMatch[1]!);
      const action = candidateMatch[2] ?? "";
      if (request.method === "POST" && action === "sessions") {
        const stored = await candidateStore.get(candidateLibraryId);
        if (!stored)
          return json(response, 404, { detail: "Candidate not found." });
        const candidateSessionId = randomUUID();
        candidateSessions.set(candidateSessionId, stored.groundTruth);
        return json(response, 201, {
          candidate: toCandidateImportResult(
            candidateSessionId,
            stored.metadata,
          ),
        });
      }
      if (request.method === "DELETE" && action === "") {
        if (!(await candidateStore.delete(candidateLibraryId))) {
          return json(response, 404, { detail: "Candidate not found." });
        }
        return send(response, 204, undefined);
      }
      return json(response, 404, { detail: "Route not found." });
    }
    const match = url.pathname.match(/^\/api\/documents\/([^/]+)(?:\/(.*))?$/u);
    if (!match) return json(response, 404, { detail: "Route not found." });
    const session = sessions.get(decodeURIComponent(match[1]!));
    if (!session)
      return json(response, 404, { detail: "Document session not found." });
    const action = match[2] ?? "";
    if (request.method === "GET" && action === "review") {
      return json(response, 200, { reviewDocument: toReviewDocument(session) });
    }
    if (request.method === "POST" && action === "template-extraction-review/resolve") {
      const input = JSON.parse(
        (await readBody(request)).toString("utf8"),
      ) as ResolveTemplateExtractionReviewRequest;
      resolveTemplateExtractionReview(session.extracted, input);
      if (session.templateId) {
        const snapshot = templateSnapshots.get(session.templateId);
        if (snapshot) resolveTemplateExtractionReview(snapshot.extracted, input);
      }
      return json(response, 200, { reviewDocument: toReviewDocument(session) });
    }
    if (request.method === "POST" && action === "operations/preview") {
      const envelope = parseStructuredOutput(
        (await readBody(request)).toString("utf8"),
      );
      return json(
        response,
        200,
        previewOperations(
          session.document,
          session.extracted.template,
          session.extracted.bindings,
          envelope,
        ),
      );
    }
    if (request.method === "POST" && action === "operations") {
      const envelope = parseStructuredOutput(
        (await readBody(request)).toString("utf8"),
      );
      const result = executeOperationsAtomically(
        session.document,
        session.extracted.template,
        session.extracted.bindings,
        envelope,
      );
      session.extracted.template.revision++;
      delete session.pendingQualityReview;
      delete session.qualityApprovalRevision;
      return json(response, 200, {
        reviewDocument: toReviewDocument(session),
        preview: result.preview,
        quality: result.quality,
      });
    }
    if (request.method === "POST" && action === "quality-review") {
      const candidateSessionId = session.candidateSessionId;
      const candidate = candidateSessionId
        ? candidateSessions.get(candidateSessionId)
        : undefined;
      if (!candidate) {
        return json(response, 409, {
          detail:
            "This document session is not linked to an available candidate CV.",
        });
      }
      const report = await reviewSessionQuality(session, candidate);
      if (report.issues.length) {
        session.pendingQualityReview = report;
        delete session.qualityApprovalRevision;
      } else {
        delete session.pendingQualityReview;
        session.qualityApprovalRevision = report.revision;
      }
      return json(response, 200, report);
    }
    if (request.method === "POST" && action === "quality-review/resolve") {
      const input = JSON.parse(
        (await readBody(request)).toString("utf8"),
      ) as ResolveCandidateQualityReviewRequest;
      return json(response, 200, resolveSessionQualityReview(session, input));
    }
    if (request.method === "GET" && action === "export") {
      if (
        session.qualityApprovalRevision !== session.extracted.template.revision
      ) {
        return json(response, 409, {
          detail:
            "Run and resolve the candidate quality review before exporting this revision.",
        });
      }
      const { bytes, quality } = exportSession(session);
      if (!quality.valid)
        return json(response, 422, { detail: quality.errors, quality });
      const extension = session.document.format;
      response.statusCode = 200;
      response.setHeader(
        "Content-Type",
        extension === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="reviewed.${extension}"`,
      );
      return response.end(bytes);
    }
    return json(response, 404, { detail: "Route not found." });
  } catch (error) {
    return json(response, 400, {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`CV Document Studio API listening on http://localhost:${port}`);
});

async function createTemplateSnapshot(
  filename: string,
  bytes: Uint8Array,
): Promise<TemplateSnapshot> {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".docx") && !lower.endsWith(".pptx"))
    throw new Error("Template must be a DOCX or PPTX file.");
  const extension = lower.endsWith(".pptx") ? "pptx" : "docx";
  const extractionOptions = {
    documentId: filename,
    revision: 1,
    mode: "hybrid" as const,
  };
  if (extension === "pptx") {
    const document = importPptx(bytes);
    let extracted = extractPptxTemplate(document, extractionOptions);
    extracted = await applyTemplateSemanticReview(
      filename,
      document,
      extracted,
      extractionOptions,
    );
    templateSnapshotBuilds++;
    return {
      filename,
      document,
      masterBytes: bytes.slice(),
      extracted,
      reviewDocument: createReviewDocument(document, extracted),
    };
  }
  const document = importDocx(bytes);
  let extracted = extractDocxTemplate(document, extractionOptions);
  extracted = await applyTemplateSemanticReview(
    filename,
    document,
    extracted,
    extractionOptions,
  );
  templateSnapshotBuilds++;
  return {
    filename,
    document,
    masterBytes: bytes.slice(),
    extracted,
    reviewDocument: createReviewDocument(document, extracted),
  };
}

async function getOrCreateTemplateSnapshot(
  templateId: string,
  stored: StoredTemplate,
): Promise<TemplateSnapshot> {
  const cached = templateSnapshots.get(templateId);
  if (cached) return cached;
  const pending = templateSnapshotPromises.get(templateId);
  if (pending) return pending;
  const building = createTemplateSnapshot(
    stored.metadata.fileName,
    stored.bytes,
  )
    .then((snapshot) => {
      templateSnapshots.set(templateId, snapshot);
      return snapshot;
    })
    .finally(() => templateSnapshotPromises.delete(templateId));
  templateSnapshotPromises.set(templateId, building);
  return building;
}

async function applyTemplateSemanticReview(
  filename: string,
  document: RichDocument<DocumentRoot>,
  extracted: ExtractionResult,
  extractionOptions: { documentId: string; revision: number; mode: "hybrid" },
): Promise<ExtractionResult> {
  if (!extracted.extraction) return extracted;
  if (!unresolvedSemanticCandidates(extracted).length) return extracted;
  try {
    const reviewer = new TemplateSemanticReviewer({
      responseLogDirectory: llmResponseDirectory,
    });
    templateSemanticReviews++;
    const decisions = await reviewer.review(filename, extracted);
    if (!decisions.length) return extracted;
    return mergeLlmTemplateSemanticDecisions(
      document,
      extracted,
      decisions,
      extractionOptions,
    );
  } catch (error) {
    extracted.warnings.push(
      `Template semantic review was skipped: ${error instanceof Error ? error.message : String(error)}`,
    );
    return extracted;
  }
}

function createSessionFromSnapshot(
  snapshot: TemplateSnapshot,
  templateId?: string,
): DocumentSession {
  return {
    id: randomUUID(),
    ...(templateId ? { templateId } : {}),
    filename: snapshot.filename,
    snapshot,
    document: structuredClone(snapshot.document),
    extracted: structuredClone(snapshot.extracted),
  };
}

function candidateFormat(
  fileName: string,
): "pdf" | "docx" | "pptx" | undefined {
  const extension = fileName.toLowerCase().match(/\.([^.]+)$/u)?.[1];
  return extension === "pdf" || extension === "docx" || extension === "pptx"
    ? extension
    : undefined;
}

function normalizeGenerationBrief(
  value: GenerationBrief | undefined,
): GenerationBrief | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object")
    throw new Error("Generation brief must be an object.");
  const targetRole = briefText(value.targetRole, "targetRole", 200, true);
  const projectBackground = briefText(
    value.projectBackground,
    "projectBackground",
    10_000,
    true,
  );
  const language = briefText(value.language, "language", 50, true);
  const requiredSkills = briefList(value.requiredSkills, "requiredSkills");
  const emphasis = briefList(value.emphasis, "emphasis");
  const additionalInstructions = briefText(
    value.additionalInstructions,
    "additionalInstructions",
    4_000,
    false,
  );
  return {
    targetRole,
    projectBackground,
    requiredSkills,
    emphasis,
    language,
    ...(additionalInstructions ? { additionalInstructions } : {}),
  };
}

function briefText(
  value: unknown,
  name: string,
  maxLength: number,
  required: boolean,
): string {
  if (value === undefined && !required) return "";
  if (typeof value !== "string")
    throw new Error(`Generation brief ${name} must be text.`);
  const normalized = value.trim();
  if (required && !normalized)
    throw new Error(`Generation brief ${name} is required.`);
  if (normalized.length > maxLength) {
    throw new Error(
      `Generation brief ${name} exceeds ${maxLength} characters.`,
    );
  }
  return normalized;
}

function briefList(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`Generation brief ${name} must be a list of text values.`);
  }
  const normalized = [
    ...new Set(value.map((item) => item.trim()).filter(Boolean)),
  ];
  if (normalized.length > 30 || normalized.some((item) => item.length > 200)) {
    throw new Error(`Generation brief ${name} exceeds its size limit.`);
  }
  return normalized;
}

async function createBatch(
  input: CreateBatchGenerationRequest,
): Promise<InternalBatch> {
  if (!input || typeof input.templateLibraryId !== "string") {
    throw new Error("templateLibraryId is required.");
  }
  if (
    !Array.isArray(input.candidateLibraryIds) ||
    !input.candidateLibraryIds.length
  ) {
    throw new Error("Select at least one candidate.");
  }
  const candidateIds = [...new Set(input.candidateLibraryIds)];
  if (candidateIds.length > 10)
    throw new Error("A batch can contain at most 10 candidates.");
  const template = await templateStore.get(input.templateLibraryId);
  if (!template) throw new Error("Template not found.");
  await getOrCreateTemplateSnapshot(input.templateLibraryId, template);
  const candidates = await Promise.all(
    candidateIds.map((id) => candidateStore.get(id)),
  );
  if (candidates.some((candidate) => !candidate))
    throw new Error("One or more candidates were not found.");
  const format = template.metadata.format;
  const templateName = template.metadata.name;
  const brief = normalizeGenerationBrief(input.brief);
  const usedNames = new Set<string>();
  const items = candidates.map((stored, index): InternalBatchItem => {
    const candidate = stored!;
    const baseName = `${safeFileName(candidate.metadata.name)}_${safeFileName(templateName)}`;
    let outputFileName = `${baseName}.${format}`;
    if (usedNames.has(outputFileName.toLowerCase()))
      outputFileName = `${baseName}_${index + 1}.${format}`;
    usedNames.add(outputFileName.toLowerCase());
    return {
      itemId: randomUUID(),
      candidateLibraryId: candidateIds[index]!,
      candidateId: candidate.metadata.candidateId,
      candidateName: candidate.metadata.name,
      candidateFileName: candidate.metadata.fileName,
      status: "pending",
      outputFileName,
    };
  });
  return {
    batchId: randomUUID(),
    templateLibraryId: input.templateLibraryId,
    templateFileName: template.metadata.fileName,
    outputFormat: format,
    createdAt: new Date().toISOString(),
    exported: false,
    ...(brief ? { brief } : {}),
    items,
  };
}

async function runBatch(batch: InternalBatch): Promise<void> {
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < batch.items.length) {
      const item = batch.items[nextIndex++]!;
      await runBatchItem(batch, item);
    }
  }
  await Promise.all([worker(), worker()]);
  finishBatchIfSettled(batch);
}

async function runBatchItem(
  batch: InternalBatch,
  item: InternalBatchItem,
): Promise<void> {
  item.status = "generating";
  try {
    const [template, candidate] = await Promise.all([
      templateStore.get(batch.templateLibraryId),
      candidateStore.get(item.candidateLibraryId),
    ]);
    if (!template || !candidate)
      throw new Error("Saved template or candidate is no longer available.");
    const snapshot = await getOrCreateTemplateSnapshot(
      batch.templateLibraryId,
      template,
    );
    const session = createSessionFromSnapshot(snapshot, batch.templateLibraryId);
    const candidateSessionId = randomUUID();
    sessions.set(session.id, session);
    candidateSessions.set(candidateSessionId, candidate.groundTruth);
    const generation = await generateCandidateDocument(
      session,
      candidate.groundTruth,
      batch.brief,
    );
    session.candidateSessionId = candidateSessionId;
    item.documentSessionId = session.id;
    item.attempts = generation.attempts;
    item.llmCalls = generation.llmCalls;
    item.performance = generation.performance;
    item.notApplicableFields = generation.notApplicableFields;
    item.status = "reviewing";
    const report = await reviewSessionQuality(session, candidate.groundTruth);
    if (report.issues.length) {
      session.pendingQualityReview = report;
      item.qualityReview = report;
      item.status = "review_required";
    } else {
      session.qualityApprovalRevision = report.revision;
      item.status = "approved";
    }
  } catch (error) {
    item.status = "failed";
    item.error = error instanceof Error ? error.message : String(error);
  }
}

function finishBatchIfSettled(batch: InternalBatch): void {
  if (
    batch.items.every(
      (item) => !["pending", "generating", "reviewing"].includes(item.status),
    )
  ) {
    batch.completedAt ??= new Date().toISOString();
  }
}

function publicBatch(batch: InternalBatch): BatchGeneration {
  const failed = batch.items.filter((item) => item.status === "failed").length;
  const approved = batch.items.filter(
    (item) => item.status === "approved",
  ).length;
  const reviewRequired = batch.items.filter(
    (item) => item.status === "review_required",
  ).length;
  const processing = batch.items.some((item) =>
    ["pending", "generating", "reviewing"].includes(item.status),
  );
  return {
    batchId: batch.batchId,
    templateLibraryId: batch.templateLibraryId,
    templateFileName: batch.templateFileName,
    outputFormat: batch.outputFormat,
    status: processing
      ? "processing"
      : reviewRequired
        ? "review_required"
        : batch.exported
          ? "completed"
          : "ready",
    createdAt: batch.createdAt,
    ...(batch.completedAt ? { completedAt: batch.completedAt } : {}),
    total: batch.items.length,
    completed: batch.items.filter(
      (item) => !["pending", "generating", "reviewing"].includes(item.status),
    ).length,
    approved,
    failed,
    reviewRequired,
    ...(batch.brief ? { brief: batch.brief } : {}),
    items: batch.items.map((item) => ({ ...item })),
  };
}

function safeFileName(value: string): string {
  return (
    value
      .normalize("NFKC")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "_")
      .trim() || "candidate"
  );
}

function resolveSessionQualityReview(
  session: DocumentSession,
  input: ResolveCandidateQualityReviewRequest,
): { reviewDocument: ReviewDocument; appliedCorrections: number } {
  const pending = session.pendingQualityReview;
  if (!pending || pending.reviewId !== input.reviewId) {
    throw new Error("Quality review is missing, stale, or already resolved.");
  }
  if (pending.revision !== session.extracted.template.revision) {
    throw new Error("Document changed after quality review. Run review again.");
  }
  const decisions = new Map(
    input.decisions.map((item) => [item.issueId, item.decision]),
  );
  if (
    decisions.size !== pending.issues.length ||
    pending.issues.some((issue) => !decisions.has(issue.issueId)) ||
    [...decisions.values()].some(
      (decision) => decision !== "apply" && decision !== "keep",
    )
  ) {
    throw new Error("Every quality review issue requires one valid decision.");
  }
  const operations = pending.issues
    .filter((issue) => decisions.get(issue.issueId) === "apply")
    .map((issue) => issue.suggestedOperation);
  if (operations.length) {
    const envelope = parseStructuredOutput(
      JSON.stringify({
        schemaVersion: TEMPLATE_OPERATION_SCHEMA_VERSION,
        documentId: pending.documentId,
        baseRevision: pending.revision,
        operations,
      }),
    );
    executeOperationsAtomically(
      session.document,
      session.extracted.template,
      session.extracted.bindings,
      envelope,
    );
    session.extracted.template.revision++;
  }
  delete session.pendingQualityReview;
  session.qualityApprovalRevision = session.extracted.template.revision;
  return {
    reviewDocument: toReviewDocument(session),
    appliedCorrections: operations.length,
  };
}

function toReviewDocument(session: DocumentSession): ReviewDocument {
  return {
    sessionId: session.id,
    ...createReviewDocument(session.document, session.extracted),
  };
}

function createReviewDocument(
  document: RichDocument<DocumentRoot>,
  extracted: ExtractionResult,
): TemplateReviewDocument {
  const templateExtractionReview = templateExtractionReviewItems(extracted);
  return {
    documentId: extracted.template.documentId,
    revision: extracted.template.revision,
    format: document.format,
    fields: flatten(extracted.template.root).flatMap(toReviewField),
    warnings: structuredClone(extracted.warnings),
    ...(templateExtractionReview.length ? { templateExtractionReview } : {}),
  };
}

function toReviewField(node: TemplateNode): ReviewField[] {
  if (!node.editable) return [];
  const constraints = node.constraints?.soft
    ? {
        ...(node.constraints.soft.recommendedCharacters !== undefined
          ? {
              recommendedCharacters:
                node.constraints.soft.recommendedCharacters,
            }
          : {}),
        ...(node.constraints.soft.recommendedItems !== undefined
          ? { recommendedItems: node.constraints.soft.recommendedItems }
          : {}),
        ...(node.constraints.soft.maxLines !== undefined
          ? { maxLines: node.constraints.soft.maxLines }
          : {}),
      }
    : undefined;
  if (node.type === "text") {
    return [
      {
        targetId: node.id,
        label: node.label ?? node.id,
        type: "text",
        editable: true,
        operationType: "setText",
        value: node.value,
        ...(constraints ? { constraints } : {}),
      },
    ];
  }
  if (node.type === "list") {
    return [
      {
        targetId: node.id,
        label: node.label ?? node.id,
        type: "list",
        editable: true,
        operationType: "setList",
        items: node.items.map((item) => item.value),
        ...(constraints ? { constraints } : {}),
      },
    ];
  }
  if (node.type === "collection") {
    const itemSchema = Array.isArray(node.metadata?.itemSchema)
      ? (node.metadata.itemSchema as Array<{ key: string; label?: string }>)
      : [];
    return [
      {
        targetId: node.id,
        label: node.label ?? node.id,
        type: "collection",
        editable: true,
        operationType: "appendCollectionItem",
        collectionFields: itemSchema.map((field) => ({
          key: field.key,
          label: field.label ?? field.key,
        })),
        records: node.items.map((item) => ({
          itemId: item.id,
          values: Object.fromEntries(
            item.fields.map((field) => [
              field.key,
              field.type === "list"
                ? (field.items?.map((entry) => entry.value) ?? [])
                : (field.value ?? ""),
            ]),
          ),
        })),
        ...(constraints ? { constraints } : {}),
      },
    ];
  }
  return [];
}

function flatten(root: TemplateNode): TemplateNode[] {
  const result = [root];
  if (root.type === "container")
    root.children.forEach((child) => result.push(...flatten(child)));
  else if (root.type === "collection")
    root.items.forEach((item) => result.push(...flatten(item)));
  return result;
}

function exportSession(session: DocumentSession) {
  const document = structuredClone(session.document);
  let bytes: Uint8Array;
  if (document.format === "docx") {
    const docx = document as RichDocument<FlowDocumentRoot>;
    cleanDocxLayoutBeforeExport(docx);
    bytes = exportDocx(docx);
  } else {
    bytes = exportPptx(document as RichDocument<PresentationDocumentRoot>);
  }
  const quality = assessGeneratedOutput(bytes, document.format, []);
  return { bytes, quality };
}

async function generateCandidateDocument(
  session: DocumentSession,
  candidate: CandidateGroundTruth,
  brief?: GenerationBrief,
) {
  const startedAt = performance.now();
  const baseDocument = session.snapshot.document;
  const baseExtracted = session.snapshot.extracted;
  const provider = new Gemini35FlashProvider({
    responseLogDirectory: llmResponseDirectory,
  });
  const document = structuredClone(baseDocument);
  const extracted = structuredClone(baseExtracted);
  const mappingStartedAt = performance.now();
  const mapping = await mapCandidateToTemplate(
    provider,
    document,
    extracted.template,
    extracted.bindings,
    candidate,
    brief
      ? { generationBrief: brief, groupConcurrency: 3 }
      : { groupConcurrency: 3 },
  );
  const mappingMs = performance.now() - mappingStartedAt;
  const executionStartedAt = performance.now();
  executeOperationsAtomically(
    document,
    extracted.template,
    extracted.bindings,
    {
      schemaVersion: TEMPLATE_OPERATION_SCHEMA_VERSION,
      documentId: extracted.template.documentId,
      baseRevision: extracted.template.revision,
      operations: mapping.operations,
    },
  );
  extracted.template.revision++;
  const operationExecutionMs = performance.now() - executionStartedAt;
  const exportStartedAt = performance.now();
  const exported = exportGeneratedDocument(document);
  const quality = assessGeneratedOutput(
    exported,
    document.format,
    mapping.operations,
  );
  const exportAndValidationMs = performance.now() - exportStartedAt;
  if (!quality.valid) {
    throw new Error(
      `Generated output failed deterministic quality validation: ${quality.errors.join("; ")}`,
    );
  }
  session.document = document;
  session.extracted = extracted;
  const sectionCount = extractEditableTemplateSectionsCount(baseExtracted);
  return {
    reviewDocument: toReviewDocument(session),
    attempts: 1,
    llmCalls: mapping.generations.length,
    notApplicableFields: mapping.fieldPlan
      .filter((field) => field.status === "not_applicable")
      .map((field) => ({
        targetId: field.targetId,
        ...(field.label ? { label: field.label } : {}),
      })),
    quality,
    performance: {
      totalMs: elapsedMs(startedAt),
      mappingMs: roundedMs(mappingMs),
      operationExecutionMs: roundedMs(operationExecutionMs),
      exportAndValidationMs: roundedMs(exportAndValidationMs),
      mappingCalls: mapping.generations.length,
      layoutRetries: Math.max(0, mapping.generations.length - sectionCount),
      fullDocumentRetries: 0,
      mappingConcurrency: 3,
    },
  };
}

function extractEditableTemplateSectionsCount(
  extracted: ExtractionResult,
): number {
  return flatten(extracted.template.root).filter(
    (node) =>
      node.editable &&
      (node.type === "text" ||
        node.type === "list" ||
        (node.type === "collection" && Boolean(node.prototypeId))),
  ).length;
}

function roundedMs(value: number): number {
  return Math.round(value * 10) / 10;
}

function elapsedMs(startedAt: number): number {
  return roundedMs(performance.now() - startedAt);
}

function toCandidateImportResult(
  candidateSessionId: string,
  candidate: CandidateLibraryItem,
): CandidateImportResult {
  return {
    candidateSessionId,
    candidateId: candidate.candidateId,
    fileName: candidate.fileName,
    pageCount: candidate.pageCount,
    characterCount: candidate.characterCount,
    textItems: candidate.textItems,
    warnings: candidate.warnings,
  };
}

function exportGeneratedDocument(
  document: RichDocument<DocumentRoot>,
): Uint8Array {
  const clone = structuredClone(document);
  if (clone.format === "docx") {
    const docx = clone as RichDocument<FlowDocumentRoot>;
    cleanDocxLayoutBeforeExport(docx);
    return exportDocx(docx);
  }
  return exportPptx(clone as RichDocument<PresentationDocumentRoot>);
}

async function reviewSessionQuality(
  session: DocumentSession,
  candidate: CandidateGroundTruth,
): Promise<CandidateQualityReviewResponse> {
  const startedAt = performance.now();
  const reviewDocument = toReviewDocument(session);
  const chunks = reviewDocument.fields
    .flatMap(reviewChunks)
    .filter(fieldHasContent);
  const reviewer = new CandidateQualityReviewer({
    responseLogDirectory: llmResponseDirectory,
  });
  const maxConcurrency = 3;
  const reviewed = await mapWithConcurrency(
    chunks,
    maxConcurrency,
    async (field) =>
      reviewer.reviewField({
        documentId: reviewDocument.documentId,
        revision: reviewDocument.revision,
        candidateText: candidate.fullText,
        field,
      }),
  );
  const issues = reviewed.flat();
  return {
    reviewId: randomUUID(),
    documentId: reviewDocument.documentId,
    revision: reviewDocument.revision,
    candidateId: candidate.candidateId,
    checkedFields: chunks.length,
    issues,
    metadata: {
      provider: "google-gemini",
      model: reviewer.model,
      llmCalls: chunks.length,
      totalMs: elapsedMs(startedAt),
      maxConcurrency,
    },
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]!, index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  );
  return results;
}

function reviewChunks(field: ReviewField): ReviewField[] {
  if (field.type !== "collection") return [field];
  return (field.records ?? []).map((record, index) => ({
    ...field,
    label: `${field.label} · item ${index + 1}`,
    records: [record],
  }));
}

function fieldHasContent(field: ReviewField): boolean {
  if (field.type === "text") return Boolean(field.value?.trim());
  if (field.type === "list")
    return Boolean(field.items?.some((item) => item.trim()));
  return Boolean(
    field.records?.some((item) =>
      Object.values(item.values).some((value) =>
        Array.isArray(value)
          ? value.some((entry) => entry.trim())
          : value.trim(),
      ),
    ),
  );
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 50 * 1024 * 1024)
      throw new Error("Request exceeds the 50 MB limit.");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function setCors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  const allowedOrigins = new Set([
    frontendOrigin,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  if (origin && allowedOrigins.has(origin))
    response.setHeader("Access-Control-Allow-Origin", origin);
  else response.setHeader("Access-Control-Allow-Origin", frontendOrigin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function send(
  response: ServerResponse,
  status: number,
  value: string | undefined,
): void {
  response.statusCode = status;
  response.end(value);
}
