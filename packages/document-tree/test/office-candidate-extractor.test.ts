import assert from "node:assert/strict";
import test from "node:test";

import {
  docxSectionTexts,
  pptxSlideTexts,
  type FlowDocumentRoot,
  type PresentationDocumentRoot,
  type RichDocument,
} from "../src/index.js";

test("extracts candidate text from DOCX paragraphs and table cells", () => {
  const document = {
    root: {
      headers: [{ blocks: [paragraph("jane@example.com")] }],
      sections: [
        {
          blocks: [
            paragraph("Jane Doe"),
            {
              type: "table",
              rows: [
                { cells: [{ blocks: [paragraph("Role")] }, { blocks: [paragraph("Engineer")] }] },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as RichDocument<FlowDocumentRoot>;

  assert.deepEqual(docxSectionTexts(document), ["jane@example.com\nJane Doe\nRole\tEngineer"]);
});

test("extracts candidate text from PPTX shapes, groups, and notes", () => {
  const document = {
    root: {
      slides: [
        {
          shapes: [shape("Jane Doe"), { type: "group", elements: [shape("Engineer")] }],
          notes: { elements: [shape("Berlin")] },
        },
      ],
    },
  } as unknown as RichDocument<PresentationDocumentRoot>;

  assert.deepEqual(pptxSlideTexts(document), ["Jane Doe\nEngineer\nBerlin"]);
});

function paragraph(text: string) {
  return {
    type: "paragraph",
    runs: [{ type: "textRun", text, properties: {} }],
    properties: {},
  };
}

function shape(text: string) {
  return {
    type: "shape",
    textBody: { paragraphs: [paragraph(text)] },
  };
}
