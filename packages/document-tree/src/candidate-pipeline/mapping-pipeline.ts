import type { DocumentRoot, RichDocument } from "../model/core/document.js";
import {
  previewOperations,
  TEMPLATE_OPERATION_SCHEMA_VERSION,
  type LlmGenerationResult,
  type LlmProvider,
} from "../llm-integration/index.js";
import type {
  LlmTemplateDocument,
  TemplateBindingMap,
  TemplateOperation,
} from "../llm-template/index.js";
import type {
  CandidateFieldPlan,
  CandidateGenerationBrief,
  CandidateGroundTruth,
  CandidateMappingResult,
} from "./model.js";
import { extractEditableTemplateSections } from "./template-section-context.js";
import { buildTemplateSectionPrompt } from "./template-section-prompt.js";
import { normalizeLlmTemplateOperationForSection } from "./operation-normalizer.js";
import { evaluateOperationLayoutFit } from "./layout-fit.js";

export interface MapCandidateOptions {
  language?: string;
  requireCompleteCoverage?: boolean;
  maxLayoutRetries?: number;
  generationBrief?: CandidateGenerationBrief;
  groupConcurrency?: number;
}

export async function mapCandidateToTemplate(
  provider: LlmProvider,
  document: RichDocument<DocumentRoot>,
  template: LlmTemplateDocument,
  bindings: TemplateBindingMap,
  groundTruth: CandidateGroundTruth,
  options: MapCandidateOptions = {},
): Promise<CandidateMappingResult> {
  const templateSections = extractEditableTemplateSections(template);
  const operations: TemplateOperation[] = [];
  const generations: LlmGenerationResult[] = [];
  const notApplicableTargetIds = new Set<string>();

  const groupConcurrency = options.groupConcurrency ?? 3;
  if (!Number.isInteger(groupConcurrency) || groupConcurrency < 1)
    throw new RangeError("groupConcurrency must be a positive integer");
  const synthesisSections = templateSections.filter(isSynthesisSection);
  const detailSections = templateSections.filter((section) => !isSynthesisSection(section));
  const waves = [
    ...chunk(detailSections, groupConcurrency),
    ...chunk(synthesisSections, groupConcurrency),
  ];

  for (const wave of waves) {
    const previousOperations = [...operations];
    const results = await Promise.all(
      wave.map(async (templateSection) => {
        let sectionOperations: TemplateOperation[] | undefined;
        let notApplicable = false;
        const sectionGenerations: LlmGenerationResult[] = [];
        let layoutFeedback: { reasons: string[]; previousOperation: TemplateOperation } | undefined;
        const maxAttempts = 1 + (options.maxLayoutRetries ?? 2);
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const messages = buildTemplateSectionPrompt({
            candidateText: groundTruth.fullText,
            templateSection,
            templateOverview: templateSections,
            documentId: template.documentId,
            baseRevision: template.revision,
            ...(options.generationBrief ? { generationBrief: options.generationBrief } : {}),
            previousOperations,
            ...(layoutFeedback ? { layoutFeedback } : {}),
          });
          const generation = await provider.generateOperations({
            template,
            userInput: {
              currentTargetId: templateSection.targetId,
              candidateId: groundTruth.candidateId,
            },
            allowedOperations: [templateSection.operationType],
            context: {
              language: options.generationBrief?.language ?? options.language ?? "en",
              ...(templateSection.purpose ? { purpose: templateSection.purpose } : {}),
            },
            messages,
          });
          sectionGenerations.push(generation);
          if (generation.operations.length === 0) {
            if (
              templateSection.emptyContentPolicy !== "allow-empty" &&
              (options.requireCompleteCoverage ?? true)
            ) {
              throw new Error(
                `LLM returned no supported content for required target ${templateSection.targetId}`,
              );
            }
            notApplicable = templateSection.emptyContentPolicy === "allow-empty";
            sectionOperations = emptySectionOperations(templateSection);
            break;
          }
          const candidateOperations = requireSectionOperations(generation, templateSection).map(
            (operation) => normalizeLlmTemplateOperationForSection(operation, templateSection),
          );
          const failedFit = candidateOperations
            .map((candidateOperation) => ({
              candidateOperation,
              fit: evaluateOperationLayoutFit(templateSection, candidateOperation),
            }))
            .find(({ fit }) => !fit.fits);
          if (!failedFit) {
            sectionOperations = candidateOperations;
            break;
          }
          if (attempt === maxAttempts) {
            throw new Error(
              `LLM content does not fit target ${templateSection.targetId} after ${maxAttempts} attempts: ${failedFit.fit.reasons.join(" ")}`,
            );
          }
          layoutFeedback = {
            reasons: failedFit.fit.reasons,
            previousOperation: failedFit.candidateOperation,
          };
        }
        if (!sectionOperations)
          throw new Error(`No operation generated for ${templateSection.targetId}`);
        return {
          targetId: templateSection.targetId,
          sectionOperations,
          sectionGenerations,
          notApplicable,
        };
      }),
    );
    for (const result of results) {
      operations.push(...result.sectionOperations);
      generations.push(...result.sectionGenerations);
      if (result.notApplicable) notApplicableTargetIds.add(result.targetId);
    }
  }

  const envelope = {
    schemaVersion: TEMPLATE_OPERATION_SCHEMA_VERSION,
    documentId: template.documentId,
    baseRevision: template.revision,
    operations,
  };
  const preview = previewOperations(document, template, bindings, envelope, [
    ...new Set(templateSections.map((section) => section.operationType)),
  ]);
  const operationsByTarget = new Map<string, TemplateOperation[]>();
  for (const operation of operations) {
    const targetOperations = operationsByTarget.get(operation.targetId) ?? [];
    targetOperations.push(operation);
    operationsByTarget.set(operation.targetId, targetOperations);
  }
  const fieldPlan: CandidateFieldPlan[] = templateSections.map((section) => {
    const targetOperations = operationsByTarget.get(section.targetId);
    return notApplicableTargetIds.has(section.targetId)
      ? {
          targetId: section.targetId,
          ...(section.label ? { label: section.label } : {}),
          nodeType:
            section.operationType === "setList"
              ? "list"
              : section.operationType === "appendCollectionItem"
                ? "collection"
                : "text",
          status: "not_applicable",
          reason: "No supported candidate facts were found; the optional section was left empty.",
          ...(targetOperations?.length
            ? { operation: targetOperations[0]!, operations: targetOperations }
            : {}),
        }
      : targetOperations?.length
        ? {
            targetId: section.targetId,
            ...(section.label ? { label: section.label } : {}),
            nodeType:
              section.operationType === "setList"
                ? "list"
                : section.operationType === "appendCollectionItem"
                  ? "collection"
                  : "text",
            status: "filled",
            operation: targetOperations[0]!,
            operations: targetOperations,
          }
        : {
            targetId: section.targetId,
            ...(section.label ? { label: section.label } : {}),
            nodeType: section.operationType === "setList" ? "list" : "text",
            status: "missing",
          };
  });
  const missingTargetIds = fieldPlan
    .filter((field) => field.status === "missing")
    .map((field) => field.targetId);
  if ((options.requireCompleteCoverage ?? true) && missingTargetIds.length) {
    throw new Error(
      `LLM did not return operations for editable targets: ${missingTargetIds.join(", ")}`,
    );
  }

  const warnings = generations.flatMap((generation) => generation.warnings ?? []);
  const lastMetadata = generations.at(-1)?.metadata;
  return {
    generation: {
      operations,
      ...(warnings.length ? { warnings } : {}),
      ...(lastMetadata ? { metadata: lastMetadata } : {}),
    },
    generations,
    operations,
    fieldPlan,
    missingTargetIds,
    notApplicableTargetIds: [...notApplicableTargetIds],
    preview,
  };
}

function emptySectionOperations(
  section: ReturnType<typeof extractEditableTemplateSections>[number],
): TemplateOperation[] {
  if (section.operationType === "setText") {
    return [{ op: "setText", targetId: section.targetId, value: "" }];
  }
  if (section.operationType === "setList") {
    return [{ op: "setList", targetId: section.targetId, items: [] }];
  }
  return [];
}

function isSynthesisSection(
  section: ReturnType<typeof extractEditableTemplateSections>[number],
): boolean {
  return section.sectionType === "professional-summary";
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

function requireSectionOperations(
  generation: LlmGenerationResult,
  section: ReturnType<typeof extractEditableTemplateSections>[number],
): TemplateOperation[] {
  const expectedCount = section.operationType === "appendCollectionItem" ? "one or more" : "one";
  if (
    generation.operations.length < 1 ||
    (section.operationType !== "appendCollectionItem" && generation.operations.length !== 1)
  ) {
    throw new Error(
      `LLM must return ${expectedCount} operation for ${section.targetId}; received ${generation.operations.length}`,
    );
  }
  for (const operation of generation.operations) {
    if (operation.targetId !== section.targetId) {
      throw new Error(
        `LLM returned target ${operation.targetId}; expected current target ${section.targetId}`,
      );
    }
    if (operation.op !== section.operationType) {
      throw new Error(
        `LLM returned operation ${operation.op}; expected ${section.operationType} for ${section.targetId}`,
      );
    }
  }
  return generation.operations;
}
