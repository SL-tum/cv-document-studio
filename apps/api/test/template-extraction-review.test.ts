import assert from "node:assert/strict";
import test from "node:test";

import type { ExtractionResult } from "@document-tree/rdt";
import {
  resolveTemplateExtractionReview,
  templateExtractionReviewItems,
} from "../src/template-extraction-review.js";

function extraction(): ExtractionResult {
  return {
    template: {
      schemaVersion: "1.0",
      documentId: "template.pptx",
      revision: 1,
      sourceFormat: "pptx",
      root: {
        id: "root",
        type: "container",
        editable: false,
        children: [
          {
            id: "professional-summary",
            type: "text",
            label: "Professional Summary",
            editable: false,
            value: "",
          },
        ],
      },
    },
    bindings: {
      documentId: "template.pptx",
      templateRevision: 1,
      bindings: {},
      prototypes: {},
    },
    warnings: ["Inferred field professional-summary needs review (confidence 0.85)"],
    extraction: {
      candidates: [
        {
          id: "candidate:summary",
          sourceNodeIds: ["paragraph:summary"],
          text: "Summary of professional experience",
          styleFeatures: {},
          layoutFeatures: { slideIndex: 0 },
          nativeRole: "body",
          signals: {},
        },
      ],
      proposals: [],
      decisions: [
        {
          status: "needsReview",
          proposal: {
            id: "professional-summary",
            type: "text",
            label: "Professional Summary",
            candidateIds: ["candidate:summary"],
            valueCandidateIds: ["candidate:summary"],
            confidence: 0.85,
            source: "llmInference",
            evidence: [
              {
                signal: "llm",
                description: "Likely summary placeholder.",
              },
            ],
          },
        },
      ],
    },
  };
}

test("template extraction review exposes and accepts an ambiguous field", () => {
  const result = extraction();
  assert.deepEqual(templateExtractionReviewItems(result), [
    {
      targetId: "professional-summary",
      label: "Professional Summary",
      fieldType: "text",
      confidence: 0.85,
      explanation: "Likely summary placeholder.",
      sourceText: "Summary of professional experience",
      nativeRole: "body",
      slideIndex: 0,
    },
  ]);
  resolveTemplateExtractionReview(result, {
    decisions: [{ targetId: "professional-summary", action: "accept" }],
  });
  assert.equal(result.template.root.children[0]?.editable, true);
  assert.equal(result.extraction?.decisions[0]?.status, "accepted");
  assert.deepEqual(templateExtractionReviewItems(result), []);
  assert.deepEqual(result.warnings, []);
});

test("template extraction review can keep an ambiguous field fixed", () => {
  const result = extraction();
  resolveTemplateExtractionReview(result, {
    decisions: [{ targetId: "professional-summary", action: "fixed" }],
  });
  assert.equal(result.template.root.children[0]?.editable, false);
  assert.equal(result.extraction?.decisions[0]?.status, "rejected");
  assert.deepEqual(templateExtractionReviewItems(result), []);
});
