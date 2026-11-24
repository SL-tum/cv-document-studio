import type { TemplateOperation } from "../llm-template/index.js";

export interface OperationNormalizationContext {
  sectionType?: string;
}

export function normalizeLlmTemplateOperation(operation: TemplateOperation): TemplateOperation {
  if (operation.op === "setText") {
    return { ...operation, value: normalizeTemplateText(operation.value) };
  }
  if (operation.op === "setList") {
    return { ...operation, items: operation.items.map(normalizeTemplateText) };
  }
  if (operation.op === "appendListItem") {
    return { ...operation, value: normalizeTemplateText(operation.value) };
  }
  if (operation.op === "appendCollectionItem" || operation.op === "updateCollectionItem") {
    return {
      ...operation,
      value: Object.fromEntries(
        Object.entries(operation.value).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.map(normalizeTemplateText) : normalizeTemplateText(value),
        ]),
      ),
    };
  }
  return operation;
}

export function normalizeLlmTemplateOperationForSection(
  operation: TemplateOperation,
  context: OperationNormalizationContext,
): TemplateOperation {
  const normalized = normalizeLlmTemplateOperation(operation);
  if (normalized.op !== "setText" || context.sectionType !== "education") return normalized;

  return {
    ...normalized,
    value: normalizeTemplateText(splitJoinedEducationEntries(normalized.value)),
  };
}

export function normalizeTemplateText(value: string): string {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\v", "\n")
    .replaceAll("\f", "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
}

function splitJoinedEducationEntries(value: string): string {
  return value.replace(
    /;\s+(?=(?:M\.?Sc\.?|B\.?Sc\.?|M\.?A\.?|B\.?A\.?|MBA|PhD|MEng|BEng|LLM|Master(?:'s)?|Bachelor(?:'s)?|Doctorate|Diploma)\b)/giu,
    "\n",
  );
}
