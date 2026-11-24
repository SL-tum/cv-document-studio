import { createHash } from "node:crypto";

import { importDocx } from "../importers/docx-importer.js";
import { importPptx } from "../importers/pptx-importer.js";
import type { GraphicNode } from "../model/drawing/index.js";
import type { InlineNode, ParagraphNode } from "../model/text/index.js";
import type { FlowBlockNode, FlowDocumentRoot } from "../model/word/index.js";
import type { PresentationDocumentRoot, SlideElementNode } from "../model/presentation/index.js";
import type { RichDocument } from "../model/core/document.js";
import type { CandidatePdfDocument, CandidatePdfPage, CandidatePdfTextItem } from "./model.js";

export type CandidateOfficeFormat = "docx" | "pptx";

/** Extracts semantic text from an Office candidate resume into the existing ground-truth shape. */
export function extractTextOfficeBytes(
  input: Uint8Array,
  fileName: string,
  format: CandidateOfficeFormat,
): CandidatePdfDocument {
  const bytes = new Uint8Array(input);
  const pageTexts =
    format === "docx" ? docxSectionTexts(importDocx(bytes)) : pptxSlideTexts(importPptx(bytes));
  if (!pageTexts.some((text) => text.trim())) {
    throw new Error(`${format.toUpperCase()} has no extractable text: ${fileName}`);
  }
  const pages = pageTexts.map((text, index) => officePage(index + 1, text));
  return {
    sourceFormat: format,
    fileName,
    relativePath: fileName,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength,
    pageCount: pages.length,
    pages,
    fullText: pages
      .map(
        (page) =>
          `--- ${format === "docx" ? "Section" : "Slide"} ${page.pageNumber} ---\n${page.text}`,
      )
      .join("\n\n"),
  };
}

export function docxSectionTexts(document: RichDocument<FlowDocumentRoot>): string[] {
  const sections = document.root.sections.map((section) =>
    section.blocks.flatMap(flowBlockText).filter(Boolean).join("\n"),
  );
  const headers = document.root.headers
    ?.flatMap((header) => header.blocks.flatMap(flowBlockText))
    .filter(Boolean)
    .join("\n");
  const footers = document.root.footers
    ?.flatMap((footer) => footer.blocks.flatMap(flowBlockText))
    .filter(Boolean)
    .join("\n");
  if (!sections.length) sections.push("");
  if (headers) sections[0] = [headers, sections[0]].filter(Boolean).join("\n");
  if (footers) {
    const last = sections.length - 1;
    sections[last] = [sections[last], footers].filter(Boolean).join("\n");
  }
  return sections;
}

export function pptxSlideTexts(document: RichDocument<PresentationDocumentRoot>): string[] {
  return document.root.slides.map((slide) => {
    const main = slide.shapes.flatMap(slideElementText);
    const notes = slide.notes?.elements.flatMap(slideElementText) ?? [];
    return [...main, ...notes].filter(Boolean).join("\n");
  });
}

function flowBlockText(block: FlowBlockNode): string[] {
  if (block.type === "paragraph" && "runs" in block) return [paragraphText(block as ParagraphNode)];
  if (block.type === "table" && "rows" in block) {
    return block.rows.map((row) =>
      row.cells
        .map((cell) => cell.blocks.flatMap(flowBlockText).filter(Boolean).join(" "))
        .join("\t"),
    );
  }
  if (
    (block.type === "structuredDocumentTag" || block.type === "customXml") &&
    "blocks" in block &&
    Array.isArray(block.blocks)
  ) {
    return block.blocks.flatMap(flowBlockText);
  }
  return [];
}

function paragraphText(paragraph: ParagraphNode): string {
  return paragraph.runs.map(inlineText).join("").trim();
}

function inlineText(node: InlineNode): string {
  if (node.type === "textRun") return node.text;
  if (node.type === "break") return "\n";
  if (node.type === "tab") return "\t";
  if (node.type === "hyperlink") return node.runs.map(inlineText).join("");
  if (node.type === "field") return node.result?.map(inlineText).join("") ?? "";
  return "";
}

function slideElementText(element: SlideElementNode): string[] {
  if (element.type === "shape" || element.type === "placeholder") {
    return element.textBody?.paragraphs.map(paragraphText) ?? [];
  }
  if (element.type === "group") return element.elements.flatMap(graphicText);
  return [];
}

function graphicText(graphic: GraphicNode): string[] {
  if (graphic.type === "shape") return graphic.textBody?.paragraphs.map(paragraphText) ?? [];
  if (graphic.type === "group") return graphic.elements.flatMap(graphicText);
  return [];
}

function officePage(pageNumber: number, text: string): CandidatePdfPage {
  const normalized = text.replace(/[ \t]+\n/gu, "\n").trim();
  const items: CandidatePdfTextItem[] = normalized
    ? normalized.split("\n").map((line, index) => ({
        index,
        text: line,
        direction: "ltr",
        transform: [],
        width: 0,
        height: 0,
        fontName: "",
        hasEol: true,
      }))
    : [];
  return { pageNumber, width: 0, height: 0, text: normalized, items };
}
