import type { RichDocument } from "../../model/core/document.js";
import type { PresentationDocumentRoot } from "../../model/presentation/index.js";
import { validateBindingMap } from "../bindings/binding-validator.js";
import type { ExtractionDecision, ExtractionProposal } from "./candidate.js";
import type { ExtractionOptions, ExtractionResult } from "./extractor.js";
import { mergeHybridExtraction } from "./hybrid-extractor.js";
import { applyPptxLayoutCapacities } from "./pptx-layout-capacity.js";

export interface LlmTemplateSemanticDecision {
  candidateIds: string[];
  decision: "editable" | "fixed" | "needs_review" | "ignore";
  targetId?: string;
  label?: string;
  sectionType?: string;
  fieldType?: "text" | "list";
  generationAction?: "replace" | "fill_if_supported" | "clear_if_unsupported" | "preserve";
  required?: boolean;
  confidence: number;
  explanation: string;
}

export function unresolvedSemanticCandidates(result: ExtractionResult) {
  const extraction = result.extraction;
  if (!extraction) return [];
  const consumed = new Set(
    extraction.decisions
      .filter((item) => item.status !== "rejected")
      .flatMap((item) => item.proposal.candidateIds),
  );
  const boundSourceIds = new Set(
    Object.values(result.bindings.bindings).flatMap((binding) => binding.sourceNodeIds),
  );
  return extraction.candidates.filter(
    (candidate) =>
      !consumed.has(candidate.id) && !candidate.sourceNodeIds.some((id) => boundSourceIds.has(id)),
  );
}

export function mergeLlmTemplateSemanticDecisions(
  document: RichDocument,
  result: ExtractionResult,
  decisions: LlmTemplateSemanticDecision[],
  options: ExtractionOptions = {},
): ExtractionResult {
  result.semanticReview = { decisions: structuredClone(decisions) };
  const candidates = unresolvedSemanticCandidates(result);
  const available = new Set(candidates.map((candidate) => candidate.id));
  const claimed = new Set<string>();
  const proposals: ExtractionDecision[] = [];
  for (const item of decisions) {
    if (
      item.decision === "fixed" ||
      item.decision === "ignore" ||
      item.generationAction === "preserve"
    )
      continue;
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) continue;
    const candidateIds = [...new Set(item.candidateIds)].filter((id) => available.has(id));
    if (!candidateIds.length || candidateIds.some((id) => claimed.has(id))) continue;
    if (!item.targetId || !item.label || !item.fieldType) continue;
    candidateIds.forEach((id) => claimed.add(id));
    const proposal: ExtractionProposal = {
      id: semanticTargetId(item.targetId),
      type: item.fieldType,
      label: item.label.trim() || semanticTargetId(item.targetId),
      candidateIds,
      valueCandidateIds: candidateIds,
      confidence: item.confidence,
      source: "llmInference",
      evidence: [
        {
          signal: "llm",
          description: item.explanation.trim() || "LLM template semantic review",
        },
      ],
    };
    proposals.push({
      proposal,
      status:
        item.decision === "editable" && item.confidence >= (options.acceptConfidence ?? 0.9)
          ? "accepted"
          : item.confidence >= (options.reviewConfidence ?? 0.7)
            ? "needsReview"
            : "rejected",
    });
  }
  if (!proposals.length) return result;
  const previousExtraction = result.extraction;
  const merged = mergeHybridExtraction(result, candidates, proposals, [], options);
  if (previousExtraction && merged.extraction) {
    merged.extraction = {
      candidates: previousExtraction.candidates,
      proposals: [...previousExtraction.proposals, ...merged.extraction.proposals],
      decisions: [...previousExtraction.decisions, ...merged.extraction.decisions],
    };
  }
  for (const item of decisions) {
    const included = merged.extraction?.decisions.find(
      (decision) =>
        decision.proposal.source === "llmInference" &&
        decision.proposal.candidateIds.length === item.candidateIds.length &&
        decision.proposal.candidateIds.every((id) => item.candidateIds.includes(id)),
    );
    const node = included ? findNode(merged, included.proposal.id) : undefined;
    if (!node) continue;
    node.metadata = {
      ...node.metadata,
      semanticReview: {
        sectionType: item.sectionType,
        generationAction: item.generationAction,
        explanation: item.explanation,
      },
    };
    if (item.required !== undefined) node.required = item.required;
  }
  const issues = validateBindingMap(merged.template, merged.bindings, document);
  if (issues.length) {
    throw new Error(
      `LLM semantic bindings failed validation: ${issues.map((item) => item.message).join("; ")}`,
    );
  }
  return document.format === "pptx"
    ? applyPptxLayoutCapacities(document as RichDocument<PresentationDocumentRoot>, merged)
    : merged;
}

function semanticTargetId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "semantic-field"
  );
}

function findNode(result: ExtractionResult, id: string) {
  const queue = [...result.template.root.children];
  while (queue.length) {
    const node = queue.shift()!;
    if (node.id === id) return node;
    if (node.type === "container") queue.push(...node.children);
  }
  return undefined;
}
