import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  geminiTokenUsage,
  recordLlmCall,
  recordLlmResponseBody,
  unresolvedSemanticCandidates,
  type ExtractionResult,
  type LlmCallRecord,
  type LlmTemplateSemanticDecision,
} from "@document-tree/rdt";

const API_KEY_PLACEHOLDER = "YOUR_GEMINI_API_KEY";

export interface TemplateSemanticReviewerOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  systemPromptPath?: string;
  responseLogDirectory?: string | false;
  callLogDirectory?: string | false;
}

export class TemplateSemanticReviewer {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly systemPromptPath: string;
  private readonly responseLogDirectory: string | false | undefined;
  private readonly callLogDirectory: string | false | undefined;

  constructor(options: TemplateSemanticReviewerOptions = {}) {
    this.apiKey =
      options.apiKey ?? process.env.GEMINI_API_KEY ?? API_KEY_PLACEHOLDER;
    this.model = options.model ?? "gemini-3.5-flash";
    this.baseUrl = (
      options.baseUrl ?? "https://generativelanguage.googleapis.com"
    ).replace(/\/$/u, "");
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.systemPromptPath =
      options.systemPromptPath ??
      fileURLToPath(
        new URL(
          "../prompts/template-semantic-review.system.txt",
          import.meta.url,
        ),
      );
    this.responseLogDirectory = options.responseLogDirectory;
    this.callLogDirectory = options.callLogDirectory;
  }

  async review(
    documentId: string,
    extraction: ExtractionResult,
  ): Promise<LlmTemplateSemanticDecision[]> {
    if (!this.apiKey || this.apiKey === API_KEY_PLACEHOLDER) {
      throw new Error(
        "Gemini API key is not configured for template semantic review.",
      );
    }
    const candidates = unresolvedSemanticCandidates(extraction);
    if (!candidates.length) return [];
    const systemPrompt = await readFile(this.systemPromptPath, "utf8");
    const requestStartedAt = new Date();
    let response: Response | undefined;
    let payload: unknown;
    let requestId: string | undefined;
    try {
      response = await this.fetcher(
        `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: `<UNTRUSTED_TEMPLATE_DATA>${JSON.stringify(
                      {
                        documentId,
                        existingTemplateFields:
                          extraction.template.root.children.map((node) => ({
                            targetId: node.id,
                            label: node.label,
                            type: node.type,
                            editable: node.editable,
                          })),
                        ambiguousCandidates: candidates.map((candidate) => ({
                          candidateId: candidate.id,
                          text: candidate.text,
                          style: candidate.styleFeatures,
                          layout: candidate.layoutFeatures,
                          nativeRole: candidate.nativeRole,
                          neighborhood: candidate.signals.neighborhood,
                          inheritedPlaceholderPrompt:
                            candidate.signals.text?.inheritedPrompt === true,
                        })),
                      },
                      null,
                      2,
                    )}</UNTRUSTED_TEMPLATE_DATA>`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: "application/json",
              responseJsonSchema: semanticReviewSchema,
            },
          }),
        },
      );
      requestId =
        response.headers.get("x-request-id") ??
        response.headers.get("x-goog-request-id") ??
        undefined;
      payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          `Gemini template semantic review error ${response.status}: ${errorMessage(payload)}`,
        );
      }
      const text = responseText(payload);
      if (this.responseLogDirectory !== false) {
        await recordLlmResponseBody(text, this.responseLogDirectory);
      }
      const parsed = JSON.parse(text) as { decisions?: unknown[] };
      if (!Array.isArray(parsed.decisions)) {
        throw new Error(
          "Template semantic review response is missing decisions.",
        );
      }
      const decisions = parsed.decisions.map(parseDecision);
      await this.recordCall(
        callRecord(
          this.model,
          documentId,
          requestStartedAt,
          new Date(),
          "succeeded",
          response,
          requestId,
          payload,
        ),
      );
      return decisions;
    } catch (error) {
      await this.recordCall({
        ...callRecord(
          this.model,
          documentId,
          requestStartedAt,
          new Date(),
          "failed",
          response,
          requestId,
          payload,
        ),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async recordCall(call: LlmCallRecord): Promise<void> {
    if (this.callLogDirectory === false) return;
    await recordLlmCall(call, this.callLogDirectory).catch((error) => {
      console.error(
        "Failed to record Gemini template semantic call metadata:",
        error,
      );
    });
  }
}

const semanticReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decisions"],
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidateIds", "decision", "confidence", "explanation"],
        properties: {
          candidateIds: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
          },
          decision: { enum: ["editable", "fixed", "needs_review", "ignore"] },
          targetId: { type: "string" },
          label: { type: "string" },
          sectionType: { type: "string" },
          fieldType: { enum: ["text", "list"] },
          generationAction: {
            enum: [
              "replace",
              "fill_if_supported",
              "clear_if_unsupported",
              "preserve",
            ],
          },
          required: { type: "boolean" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          explanation: { type: "string" },
        },
      },
    },
  },
};

function parseDecision(value: unknown): LlmTemplateSemanticDecision {
  const item = record(value);
  if (
    !Array.isArray(item.candidateIds) ||
    !item.candidateIds.every((id) => typeof id === "string")
  ) {
    throw new Error("Template semantic decision has invalid candidateIds.");
  }
  if (
    !["editable", "fixed", "needs_review", "ignore"].includes(
      String(item.decision),
    )
  ) {
    throw new Error("Template semantic decision has invalid decision.");
  }
  if (
    typeof item.confidence !== "number" ||
    typeof item.explanation !== "string"
  ) {
    throw new Error(
      "Template semantic decision has invalid confidence or explanation.",
    );
  }
  return item as unknown as LlmTemplateSemanticDecision;
}

function callRecord(
  model: string,
  documentId: string,
  startedAt: Date,
  endedAt: Date,
  status: "succeeded" | "failed",
  response?: Response,
  requestId?: string,
  payload?: unknown,
): LlmCallRecord {
  const tokenUsage = geminiTokenUsage(payload);
  return {
    provider: "google-gemini",
    model,
    callType: "template_semantics",
    targetId: documentId,
    requestStartedAt: startedAt.toISOString(),
    requestEndedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    status,
    ...(response ? { httpStatus: response.status } : {}),
    ...(requestId ? { requestId } : {}),
    ...(tokenUsage ? { tokenUsage } : {}),
  };
}

function responseText(payload: unknown): string {
  const candidates = record(payload).candidates;
  const candidate = Array.isArray(candidates) ? record(candidates[0]) : {};
  const parts = record(candidate.content).parts;
  if (!Array.isArray(parts))
    throw new Error("Gemini template semantic response has no content.");
  const text = parts
    .map((part) => record(part).text)
    .find((item) => typeof item === "string");
  if (typeof text !== "string")
    throw new Error("Gemini template semantic response has no text.");
  return text;
}

function errorMessage(payload: unknown): string {
  const message = record(record(payload).error).message;
  return typeof message === "string" ? message : JSON.stringify(payload);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
