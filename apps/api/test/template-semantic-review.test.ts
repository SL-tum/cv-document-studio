import assert from "node:assert/strict";
import test from "node:test";

import type { ExtractionResult } from "@document-tree/rdt";
import { TemplateSemanticReviewer } from "../src/template-semantic-review.js";

test("template semantic reviewer classifies only supplied candidates with structured output", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const extraction = {
    template: {
      schemaVersion: "1.0",
      documentId: "template.pptx",
      revision: 1,
      sourceFormat: "pptx",
      root: { id: "root", type: "container", editable: false, children: [] },
    },
    bindings: {
      documentId: "template.pptx",
      templateRevision: 1,
      bindings: {},
      prototypes: {},
    },
    warnings: [],
    extraction: {
      candidates: [
        {
          id: "candidate:name",
          sourceNodeIds: ["paragraph:name", "run:name"],
          text: "Name",
          styleFeatures: { bold: true, emphasized: true },
          layoutFeatures: {
            slideIndex: 0,
            containerNodeId: "shape:contact",
            order: 0,
          },
          nativeRole: "body",
          signals: {
            text: {
              value: "Name",
              short: true,
              placeholder: true,
              inheritedPrompt: true,
            },
            style: { bold: true, emphasized: true },
          },
        },
      ],
      proposals: [],
      decisions: [],
    },
  } as ExtractionResult;
  const reviewer = new TemplateSemanticReviewer({
    apiKey: "test-key",
    responseLogDirectory: false,
    callLogDirectory: false,
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      decisions: [
                        {
                          candidateIds: ["candidate:name"],
                          decision: "editable",
                          targetId: "full-name",
                          label: "Full name",
                          sectionType: "personal-information",
                          fieldType: "text",
                          generationAction: "replace",
                          required: true,
                          confidence: 0.98,
                          explanation: "Standalone profile name placeholder.",
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });
  const decisions = await reviewer.review("template.pptx", extraction);
  assert.equal(decisions[0]?.targetId, "full-name");
  assert.match(JSON.stringify(requestBody?.contents), /candidate:name/u);
  assert.match(JSON.stringify(requestBody?.contents), /inheritedPlaceholderPrompt/u);
  assert.doesNotMatch(
    JSON.stringify(requestBody?.systemInstruction),
    /candidate:name/u,
  );
  const schema = (requestBody?.generationConfig as Record<string, unknown>)
    ?.responseJsonSchema;
  assert.match(JSON.stringify(schema), /needs_review/u);
});
