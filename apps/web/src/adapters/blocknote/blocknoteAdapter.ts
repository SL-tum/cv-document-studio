import {
  BlockNoteSchema,
  COLORS_DEFAULT,
  createStyleSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  withPageBreak,
} from "@blocknote/core";
import type { PartialBlock } from "@blocknote/core";

import type {
  DocumentExportResult,
  DocumentImportResult,
  DocumentAsset,
  DocumentMetadata,
  IntermediateDocument,
  IntermediateDocumentBlock,
  IntermediateTextRun,
  JsonValue,
} from "../../types/document";

/**
 * BlockNote is intentionally contained behind this adapter. Today the adapter
 * performs a lossless JSON pass-through; later it can translate between a
 * custom rich document model and BlockNote without changing application code.
 */

function createCssStyle(
  type: "fontFamily" | "fontSize",
  property: "fontFamily" | "fontSize",
) {
  return createStyleSpec(
    { type, propSchema: "string" },
    {
      render: (value) => {
        const span = window.document.createElement("span");
        span.style[property] = value;
        return { dom: span, contentDOM: span };
      },
      parse: (element) => element.style[property] || undefined,
    },
  );
}

export const blockNoteSchema = withPageBreak(
  BlockNoteSchema.create({
    blockSpecs: defaultBlockSpecs,
    inlineContentSpecs: defaultInlineContentSpecs,
    styleSpecs: {
      ...defaultStyleSpecs,
      fontFamily: createCssStyle("fontFamily", "fontFamily"),
      fontSize: createCssStyle("fontSize", "fontSize"),
    },
  }),
);

type AdapterBlock = PartialBlock<
  typeof blockNoteSchema.blockSchema,
  typeof blockNoteSchema.inlineContentSchema,
  typeof blockNoteSchema.styleSchema
>;

const emptyDocument: AdapterBlock[] = [{ type: "paragraph" }];

function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

function convertRun(run: IntermediateTextRun) {
  const { color, fontFamily, fontSize, ...booleanStyles } = run.styles;

  return {
    type: "text" as const,
    text: run.text,
    styles: {
      ...booleanStyles,
      ...(color ? { textColor: `#${color.replace(/^#/, "")}` } : {}),
      ...(fontFamily ? { fontFamily } : {}),
      ...(fontSize ? { fontSize: `${fontSize}pt` } : {}),
    },
  };
}

function convertTextBlock(block: IntermediateDocumentBlock): AdapterBlock {
  const content = block.content.map(convertRun);
  const textAlignment = block.alignment;

  if (block.type === "heading") {
    const level = Math.min(3, Math.max(1, block.level ?? 1)) as 1 | 2 | 3;
    return { type: "heading", props: { level, textAlignment }, content };
  }

  if (block.type === "bullet_list_item") {
    return { type: "bulletListItem", props: { textAlignment }, content };
  }

  if (block.type === "numbered_list_item") {
    return { type: "numberedListItem", props: { textAlignment }, content };
  }

  return { type: "paragraph", props: { textAlignment }, content };
}

function flattenCellText(blocks: IntermediateDocumentBlock[]) {
  return blocks.flatMap((block, index) => {
    const prefix = index > 0 ? [{ type: "text" as const, text: " · ", styles: {} }] : [];
    if (block.type === "table") {
      return [
        ...prefix,
        { type: "text" as const, text: "[Nested table]", styles: {} },
      ];
    }
    if (block.type === "image") {
      return [
        ...prefix,
        { type: "text" as const, text: block.alt || "[Image]", styles: {} },
      ];
    }
    return [...prefix, ...block.content.map(convertRun)];
  });
}

function nestedImages(block: IntermediateDocumentBlock): IntermediateDocumentBlock[] {
  if (block.type !== "table") return [];
  return (block.rows ?? []).flatMap((row) =>
    row.cells.flatMap((cell) =>
      cell.blocks.flatMap((child) =>
        child.type === "image" ? [child] : nestedImages(child),
      ),
    ),
  );
}

function convertBlock(
  block: IntermediateDocumentBlock,
  assets: Map<string, DocumentAsset>,
): AdapterBlock[] {
  if (
    block.type === "paragraph" ||
    block.type === "heading" ||
    block.type === "bullet_list_item" ||
    block.type === "numbered_list_item"
  ) {
    return [convertTextBlock(block)];
  }

  if (block.type === "page_break") return [{ type: "pageBreak" }];

  if (block.type === "image") {
    const asset = block.assetId ? assets.get(block.assetId) : undefined;
    if (!asset) return [];
    return [
      {
        type: "image",
        props: {
          url: `data:${asset.mimeType};base64,${asset.data}`,
          name: asset.filename,
          caption: block.alt ?? "",
          previewWidth: block.width,
        },
      },
    ];
  }

  const rows = (block.rows ?? []).map((row) => ({
    cells: row.cells.map((cell) => flattenCellText(cell.blocks)),
  }));
  if (rows.length === 0 || rows.every((row) => row.cells.length === 0)) return [];
  const columnCount = Math.max(...rows.map((row) => row.cells.length));
  const normalizedRows = rows.map((row) => ({
    cells: [
      ...row.cells,
      ...Array.from({ length: columnCount - row.cells.length }, () => []),
    ],
  }));
  const table = {
    type: "table" as const,
    content: {
      type: "tableContent" as const,
      columnWidths: Array.from({ length: columnCount }, () => undefined),
      rows: normalizedRows,
    },
  } as AdapterBlock;

  // BlockNote table cells cannot contain image blocks, so extracted cell
  // images are displayed immediately after the editable table.
  return [
    table,
    ...nestedImages(block).flatMap((image) => convertBlock(image, assets)),
  ];
}

function convertBlocks(
  blocks: IntermediateDocumentBlock[],
  assets: Map<string, DocumentAsset>,
): AdapterBlock[] {
  const result: AdapterBlock[] = [];
  const listStack: Array<{ level: number; block: AdapterBlock }> = [];

  for (const sourceBlock of blocks) {
    const isListItem =
      sourceBlock.type === "bullet_list_item" ||
      sourceBlock.type === "numbered_list_item";
    if (!isListItem) {
      listStack.length = 0;
      result.push(...convertBlock(sourceBlock, assets));
      continue;
    }

    const level = sourceBlock.listLevel ?? 0;
    const block = convertTextBlock(sourceBlock);
    block.children = [];
    while (listStack.length > 0 && listStack.at(-1)!.level >= level) {
      listStack.pop();
    }
    const parent = listStack.at(-1)?.block;
    if (level > 0 && parent) {
      parent.children = [...(parent.children ?? []), block];
    } else {
      result.push(block);
    }
    listStack.push({ level, block });
  }

  return result;
}

function isJsonObject(value: JsonValue | undefined): value is {
  [key: string]: JsonValue;
} {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeColor(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const cssColor = COLORS_DEFAULT[value]?.text ?? value;
  const hex = cssColor.replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : undefined;
}

function readStyles(value: JsonValue | undefined) {
  if (!isJsonObject(value)) return {};

  const fontSize =
    typeof value.fontSize === "string" || typeof value.fontSize === "number"
      ? Number.parseFloat(String(value.fontSize))
      : undefined;

  return {
    ...(value.bold === true ? { bold: true } : {}),
    ...(value.italic === true ? { italic: true } : {}),
    ...(value.underline === true ? { underline: true } : {}),
    ...(typeof value.fontFamily === "string"
      ? { fontFamily: value.fontFamily }
      : {}),
    ...(fontSize !== undefined && Number.isFinite(fontSize) && fontSize > 0
      ? { fontSize }
      : {}),
    ...(typeof value.textColor === "string" &&
    normalizeColor(value.textColor) !== undefined
      ? { color: normalizeColor(value.textColor) }
      : {}),
  };
}

function contentToRuns(content: JsonValue | undefined): IntermediateTextRun[] {
  if (typeof content === "string") {
    return [{ text: content, styles: {} }];
  }

  if (!Array.isArray(content)) return [];

  return content.flatMap((item): IntermediateTextRun[] => {
    if (typeof item === "string") return [{ text: item, styles: {} }];
    if (!isJsonObject(item)) return [];

    if (item.type === "text" && typeof item.text === "string") {
      return [{ text: item.text, styles: readStyles(item.styles) }];
    }

    // BlockNote links contain styled text items. The intermediate model does
    // not represent links yet, but their visible runs should not be lost.
    return contentToRuns(item.content);
  });
}

function toIntermediateBlock(
  value: JsonValue,
  assets: DocumentAsset[],
): IntermediateDocumentBlock | undefined {
  if (!isJsonObject(value)) return undefined;

  const props = isJsonObject(value.props) ? value.props : {};
  const alignment =
    props.textAlignment === "center" ||
    props.textAlignment === "right" ||
    props.textAlignment === "justify"
      ? props.textAlignment
      : "left";

  if (value.type === "pageBreak") {
    return { type: "page_break", alignment: "left", content: [] };
  }

  if (value.type === "image") {
    if (typeof props.url !== "string") return undefined;
    const match = props.url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if (!match) return undefined;
    const assetId = `image-${assets.length + 1}`;
    assets.push({
      id: assetId,
      filename: typeof props.name === "string" && props.name ? props.name : "image",
      mimeType: match[1],
      data: match[2],
    });
    return {
      type: "image",
      alignment,
      content: [],
      assetId,
      width: typeof props.previewWidth === "number" ? props.previewWidth : undefined,
      alt: typeof props.caption === "string" ? props.caption : null,
    };
  }

  if (value.type === "table" && isJsonObject(value.content)) {
    const rowsValue = value.content.rows;
    const rows = Array.isArray(rowsValue)
      ? rowsValue.flatMap((row) => {
          if (!isJsonObject(row) || !Array.isArray(row.cells)) return [];
          return [
            {
              cells: row.cells.map((cell) => {
                const cellContent = isJsonObject(cell) ? cell.content : cell;
                return {
                  blocks: [
                    {
                      type: "paragraph" as const,
                      alignment: "left" as const,
                      content: contentToRuns(cellContent),
                    },
                  ],
                };
              }),
            },
          ];
        })
      : [];
    return { type: "table", alignment, content: [], rows };
  }

  if (value.type === "heading") {
    const level =
      typeof props.level === "number" && Number.isInteger(props.level)
        ? props.level
        : 1;
    return {
      type: "heading",
      level,
      alignment,
      content: contentToRuns(value.content),
    };
  }

  if (value.type === "bulletListItem" || value.type === "numberedListItem") {
    return {
      type:
        value.type === "bulletListItem"
          ? "bullet_list_item"
          : "numbered_list_item",
      listLevel: 0,
      alignment,
      content: contentToRuns(value.content),
    };
  }

  if (value.type !== "paragraph") return undefined;

  return {
    type: "paragraph",
    alignment,
    content: contentToRuns(value.content),
  };
}

function toIntermediateBlocks(
  values: JsonValue[],
  assets: DocumentAsset[],
  listLevel = 0,
): IntermediateDocumentBlock[] {
  return values.flatMap((value) => {
    const block = toIntermediateBlock(value, assets);
    if (!block) return [];

    const isListItem =
      block.type === "bullet_list_item" || block.type === "numbered_list_item";
    if (isListItem) block.listLevel = listLevel;

    const children =
      isJsonObject(value) && Array.isArray(value.children)
        ? toIntermediateBlocks(
            value.children,
            assets,
            isListItem ? listLevel + 1 : listLevel,
          )
        : [];
    return [block, ...children];
  });
}

function isIntermediateDocument(
  source: JsonValue | IntermediateDocument,
): source is IntermediateDocument {
  return (
    typeof source === "object" &&
    !Array.isArray(source) &&
    source !== null &&
    "sections" in source
  );
}

export function importDocument(
  source?: JsonValue | IntermediateDocument,
): DocumentImportResult {
  const document =
    source && isIntermediateDocument(source)
      ? source.sections.flatMap((section) => {
          const assets = new Map(source.assets.map((asset) => [asset.id, asset]));
          return convertBlocks(section.blocks, assets);
        })
      : (source ?? emptyDocument);

  if (!Array.isArray(document)) {
    throw new TypeError("A document must be a JSON array of blocks.");
  }

  const nonEmptyDocument = document.length > 0 ? document : emptyDocument;
  return { document: cloneJson(nonEmptyDocument as JsonValue) };
}

export function exportDocument(document: unknown): DocumentExportResult {
  if (!Array.isArray(document)) {
    throw new TypeError("A BlockNote document must be an array of blocks.");
  }

  // BlockNote documents are JSON-serializable. The assertion stays inside this
  // adapter so the rest of the app never depends on a BlockNote type.
  return { document: cloneJson(document as JsonValue) };
}

export function exportIntermediateDocument(
  document: JsonValue,
  metadata?: DocumentMetadata,
): IntermediateDocument {
  if (!Array.isArray(document)) {
    throw new TypeError("A document must be a JSON array of blocks.");
  }

  const assets = metadata ? [...metadata.assets] : [];
  const blocks = toIntermediateBlocks(document, assets);

  return {
    sections: [
      {
        id: "document-1",
        type: "custom",
        title: null,
        blocks,
      },
    ],
    headers: metadata?.headers ?? [],
    footers: metadata?.footers ?? [],
    pageSettings: metadata?.pageSettings ?? null,
    assets,
  };
}
