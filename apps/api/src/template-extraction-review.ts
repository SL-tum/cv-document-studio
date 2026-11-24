import type {
  ResolveTemplateExtractionReviewRequest,
  ReviewDocument,
} from "@cv-document-studio/review-contracts";
import type { ExtractionResult, TemplateNode } from "@document-tree/rdt";

export function templateExtractionReviewItems(
  extracted: ExtractionResult,
): NonNullable<ReviewDocument["templateExtractionReview"]> {
  const candidates = new Map(
    extracted.extraction?.candidates.map((candidate) => [candidate.id, candidate]) ?? [],
  );
  return (extracted.extraction?.decisions ?? []).flatMap((decision) => {
    if (decision.status !== "needsReview") return [];
    const node = flattenNodes(extracted.template.root).find(
      (candidate) => candidate.id === decision.proposal.id,
    );
    if (!node) return [];
    const sources = (decision.proposal.valueCandidateIds ?? decision.proposal.candidateIds)
      .map((id) => candidates.get(id))
      .filter((candidate) => Boolean(candidate));
    const sourceText = sources
      .map((candidate) => candidate?.text ?? "")
      .filter(Boolean)
      .join("\n");
    const first = sources[0];
    return [
      {
        targetId: node.id,
        label: node.label ?? node.id,
        fieldType: decision.proposal.type === "list" ? "list" : "text",
        confidence: decision.proposal.confidence,
        explanation:
          decision.proposal.evidence.find((evidence) => evidence.signal === "llm")
            ?.description ?? "This template field needs confirmation.",
        sourceText,
        ...(first?.nativeRole ? { nativeRole: first.nativeRole } : {}),
        ...(first?.layoutFeatures?.slideIndex !== undefined
          ? { slideIndex: first.layoutFeatures.slideIndex }
          : {}),
      },
    ];
  });
}

export function resolveTemplateExtractionReview(
  extracted: ExtractionResult,
  input: ResolveTemplateExtractionReviewRequest,
): void {
  if (!Array.isArray(input?.decisions) || !input.decisions.length)
    throw new Error("At least one template extraction decision is required.");
  const pending = new Map(
    (extracted.extraction?.decisions ?? [])
      .filter((decision) => decision.status === "needsReview")
      .map((decision) => [decision.proposal.id, decision]),
  );
  for (const resolution of input.decisions) {
    if (!resolution || typeof resolution.targetId !== "string")
      throw new Error("Each template extraction decision requires a targetId.");
    if (!["accept", "fixed", "ignore"].includes(resolution.action))
      throw new Error(`Invalid template extraction action for ${resolution.targetId}.`);
    const decision = pending.get(resolution.targetId);
    if (!decision)
      throw new Error(`Template extraction target is not pending review: ${resolution.targetId}`);
    const node = flattenNodes(extracted.template.root).find(
      (candidate) => candidate.id === resolution.targetId,
    );
    if (!node)
      throw new Error(`Template extraction target was not found: ${resolution.targetId}`);
    const accepted = resolution.action === "accept";
    decision.status = accepted ? "accepted" : "rejected";
    node.editable = accepted;
    node.metadata = {
      ...node.metadata,
      templateExtractionReview: { resolvedBy: "user", action: resolution.action },
    };
    extracted.warnings = extracted.warnings.filter(
      (warning) => !warning.includes(`Inferred field ${resolution.targetId} needs review`),
    );
    pending.delete(resolution.targetId);
  }
}

function flattenNodes(root: TemplateNode): TemplateNode[] {
  const result = [root];
  if (root.type === "container")
    root.children.forEach((child) => result.push(...flattenNodes(child)));
  else if (root.type === "collection")
    root.items.forEach((item) => result.push(...flattenNodes(item)));
  return result;
}
