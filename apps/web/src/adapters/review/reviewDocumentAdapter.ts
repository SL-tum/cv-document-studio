import type {
  ReviewDocument,
  ReviewField,
  ReviewOperationEnvelope,
} from "@cv-document-studio/review-contracts";
import type { JsonValue } from "../../types/document";

const labelId = (targetId: string) => `review-label:${encodeURIComponent(targetId)}`;
const valueId = (targetId: string) => `review-value:${encodeURIComponent(targetId)}`;
type JsonObject = { [key: string]: JsonValue };

export function reviewDocumentToBlocks(review: ReviewDocument): JsonValue {
  return review.fields.flatMap((field) => [
    {
      id: labelId(field.targetId),
      type: "heading",
      props: { level: 2 },
      content: field.label,
    },
    ...fieldBlocks(field),
  ]) as JsonValue;
}

export function blocksToOperationEnvelope(
  blocks: JsonValue,
  review: ReviewDocument,
): ReviewOperationEnvelope {
  if (!Array.isArray(blocks)) throw new TypeError("Editor document must be a block array.");
  const objects = blocks.filter(isJsonObject);
  const operations: Array<Record<string, unknown>> = [];
  for (const field of review.fields) {
    const labelIndex = objects.findIndex((block) => block.id === labelId(field.targetId));
    if (labelIndex < 0) continue;
    const nextLabel = objects.findIndex(
      (block, index) => index > labelIndex && typeof block.id === "string" && block.id.startsWith("review-label:"),
    );
    const fieldBlocks = objects.slice(labelIndex + 1, nextLabel < 0 ? undefined : nextLabel);
    if (field.type === "text") {
      const value = fieldBlocks.map(blockText).join("\n").trim();
      if (value !== (field.value ?? ""))
        operations.push({ op: "setText", targetId: field.targetId, value });
    } else if (field.type === "list") {
      const items = fieldBlocks.map(blockText).map((item) => item.trim()).filter(Boolean);
      if (JSON.stringify(items) !== JSON.stringify(field.items ?? []))
        operations.push({ op: "setList", targetId: field.targetId, items });
    } else {
      const table = fieldBlocks.find((block) => block.type === "table");
      const records = tableRows(table, field).slice(1);
      const existing = field.records ?? [];
      records.forEach((value, index) => {
        const item = existing[index];
        if (!item) operations.push({ op: "appendCollectionItem", targetId: field.targetId, value });
        else if (JSON.stringify(value) !== JSON.stringify(item.values))
          operations.push({
            op: "updateCollectionItem",
            targetId: field.targetId,
            itemId: item.itemId,
            value,
          });
      });
      existing.slice(records.length).forEach((item) =>
        operations.push({ op: "removeCollectionItem", targetId: field.targetId, itemId: item.itemId }),
      );
    }
  }
  return {
    schemaVersion: "1.0",
    documentId: review.documentId,
    baseRevision: review.revision,
    operations,
  };
}

function fieldBlocks(field: ReviewField): Array<Record<string, unknown>> {
  if (field.type === "text") {
    return [{ id: valueId(field.targetId), type: "paragraph", content: field.value ?? "" }];
  }
  if (field.type === "list") {
    const items = field.items?.length ? field.items : [""];
    return items.map((item, index) => ({
      id: `${valueId(field.targetId)}:${index}`,
      type: "bulletListItem",
      content: item,
    }));
  }
  const columns = collectionColumns(field);
  const rows = [
    { cells: columns.map((column) => [text(column.label)]) },
    ...(field.records ?? []).map((record) => ({
      cells: columns.map((column) => [text(valueText(record.values[column.key]))]),
    })),
  ];
  return [{
    id: valueId(field.targetId),
    type: "table",
    content: { type: "tableContent", columnWidths: columns.map(() => undefined), rows },
  }];
}

function tableRows(table: JsonObject | undefined, field: ReviewField) {
  if (!table || !isJsonObject(table.content) || !Array.isArray(table.content.rows)) return [];
  const columns = collectionColumns(field);
  return table.content.rows.filter(isJsonObject).map((row) => {
    const cells = Array.isArray(row.cells) ? row.cells : [];
    return Object.fromEntries(columns.map((column, index) => [column.key, blockText(cells[index])]));
  });
}

function collectionColumns(field: ReviewField) {
  if (field.collectionFields?.length) return field.collectionFields;
  const keys = Object.keys(field.records?.[0]?.values ?? {});
  return keys.map((key) => ({ key, label: key }));
}

function blockText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(blockText).join("");
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  if ("content" in value) return blockText(value.content);
  return "";
}

function valueText(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join("\n") : (value ?? "");
}

function text(value: string) {
  return { type: "text", text: value, styles: {} };
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
