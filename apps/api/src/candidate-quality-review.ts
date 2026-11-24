import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type {
  CandidateReviewIssue,
  ReviewField,
} from "@cv-document-studio/review-contracts";
import {
  geminiTokenUsage,
  recordLlmCall,
  recordLlmResponseBody,
  type LlmCallRecord,
} from "@document-tree/rdt";

const API_KEY_PLACEHOLDER = "YOUR_GEMINI_API_KEY";

export interface CandidateQualityReviewOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  systemPromptPath?: string;
  responseLogDirectory?: string | false;
  callLogDirectory?: string | false;
}

export interface ReviewFieldInput {
  documentId: string;
  revision: number;
  candidateText: string;
  field: ReviewField;
}

export class CandidateQualityReviewer {
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly systemPromptPath: string;
  private readonly responseLogDirectory: string | false | undefined;
  private readonly callLogDirectory: string | false | undefined;

  constructor(options: CandidateQualityReviewOptions = {}) {
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
          "../prompts/candidate-quality-review.system.txt",
          import.meta.url,
        ),
      );
    this.responseLogDirectory = options.responseLogDirectory;
    this.callLogDirectory = options.callLogDirectory;
  }

  async reviewField(input: ReviewFieldInput): Promise<CandidateReviewIssue[]> {
    if (!this.apiKey || this.apiKey === API_KEY_PLACEHOLDER) {
      throw new Error(
        "Gemini API key is not configured for candidate quality review.",
      );
    }
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
                    text: JSON.stringify({
                      documentId: input.documentId,
                      baseRevision: input.revision,
                      candidateKnowledgeBase: input.candidateText,
                      targetField: input.field,
                    }),
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              responseMimeType: "application/json",
              responseJsonSchema: responseSchema(input.field),
            },
          }),
        },
      );
      requestId =
        response.headers.get("x-request-id") ??
        response.headers.get("x-goog-request-id") ??
        undefined;
      payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          `Gemini quality review error ${response.status}: ${errorMessage(payload)}`,
        );
      const text = responseText(payload);
      if (this.responseLogDirectory !== false) {
        await recordLlmResponseBody(text, this.responseLogDirectory);
      }
      const parsed = JSON.parse(text) as { issues?: unknown[] };
      if (!Array.isArray(parsed.issues))
        throw new Error("Quality review response is missing issues.");
      const issues = parsed.issues.map((issue) =>
        toReviewIssue(issue, input.field),
      );
      const requestEndedAt = new Date();
      const tokenUsage = geminiTokenUsage(payload);
      await this.recordCall({
        ...this.baseCall(
          input.field.targetId,
          requestStartedAt,
          requestEndedAt,
        ),
        status: "succeeded",
        httpStatus: response.status,
        ...(requestId ? { requestId } : {}),
        ...(tokenUsage ? { tokenUsage } : {}),
      });
      return issues;
    } catch (error) {
      const requestEndedAt = new Date();
      const tokenUsage = geminiTokenUsage(payload);
      await this.recordCall({
        ...this.baseCall(
          input.field.targetId,
          requestStartedAt,
          requestEndedAt,
        ),
        status: "failed",
        ...(response ? { httpStatus: response.status } : {}),
        ...(requestId ? { requestId } : {}),
        ...(tokenUsage ? { tokenUsage } : {}),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private baseCall(
    targetId: string,
    startedAt: Date,
    endedAt: Date,
  ): Omit<LlmCallRecord, "status"> {
    return {
      provider: "google-gemini",
      model: this.model,
      callType: "validation",
      targetId,
      requestStartedAt: startedAt.toISOString(),
      requestEndedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
    };
  }

  private async recordCall(call: LlmCallRecord): Promise<void> {
    if (this.callLogDirectory === false) return;
    await recordLlmCall(call, this.callLogDirectory).catch((error) => {
      console.error("Failed to record Gemini validation call metadata:", error);
    });
  }
}

function responseSchema(field: ReviewField): unknown {
  const suggestion =
    field.type === "list"
      ? { suggestedItems: { type: "array", items: { type: "string" } } }
      : field.type === "collection"
        ? {
            suggestedRecord: {
              type: "object",
              additionalProperties: false,
              required: field.collectionFields?.map((item) => item.key) ?? [],
              properties: Object.fromEntries(
                (field.collectionFields ?? []).map((item) => [
                  item.key,
                  { type: "string" },
                ]),
              ),
            },
          }
        : { suggestedText: { type: "string" } };
  return {
    type: "object",
    additionalProperties: false,
    required: ["issues"],
    properties: {
      issues: {
        type: "array",
        maxItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "type",
            "severity",
            "originalText",
            "explanation",
            ...Object.keys(suggestion),
          ],
          properties: {
            type: { enum: ["grammar", "unsupported_fact", "contradiction"] },
            severity: { enum: ["warning", "error"] },
            originalText: { type: "string" },
            explanation: { type: "string" },
            evidence: { type: "string" },
            ...suggestion,
          },
        },
      },
    },
  };
}

function toReviewIssue(
  value: unknown,
  field: ReviewField,
): CandidateReviewIssue {
  const issue = record(value);
  const type = issue.type;
  const severity = issue.severity;
  if (
    type !== "grammar" &&
    type !== "unsupported_fact" &&
    type !== "contradiction"
  ) {
    throw new Error("Quality review returned an unsupported issue type.");
  }
  if (severity !== "warning" && severity !== "error") {
    throw new Error("Quality review returned an unsupported severity.");
  }
  const originalText = requiredString(issue.originalText, "originalText");
  const explanation = requiredString(issue.explanation, "explanation");
  if (field.type === "list") {
    if (
      !Array.isArray(issue.suggestedItems) ||
      !issue.suggestedItems.every((item) => typeof item === "string")
    ) {
      throw new Error("Quality review returned invalid suggestedItems.");
    }
    const items = issue.suggestedItems as string[];
    return {
      issueId: randomUUID(),
      targetId: field.targetId,
      fieldLabel: field.label,
      type,
      severity,
      originalText,
      explanation,
      ...(typeof issue.evidence === "string"
        ? { evidence: issue.evidence }
        : {}),
      suggestedText: items.join("\n"),
      suggestedOperation: { op: "setList", targetId: field.targetId, items },
    };
  }
  if (field.type === "collection") {
    const recordValue = record(issue.suggestedRecord);
    const itemId = field.records?.[0]?.itemId;
    if (
      !itemId ||
      !(field.collectionFields ?? []).every(
        (item) => typeof recordValue[item.key] === "string",
      )
    ) {
      throw new Error("Quality review returned an invalid suggestedRecord.");
    }
    const suggestedRecord = Object.fromEntries(
      (field.collectionFields ?? []).map((item) => [
        item.key,
        recordValue[item.key] as string,
      ]),
    );
    return {
      issueId: randomUUID(),
      targetId: field.targetId,
      fieldLabel: field.label,
      type,
      severity,
      originalText,
      explanation,
      ...(typeof issue.evidence === "string"
        ? { evidence: issue.evidence }
        : {}),
      suggestedText: Object.values(suggestedRecord).join("\n"),
      suggestedOperation: {
        op: "updateCollectionItem",
        targetId: field.targetId,
        itemId,
        value: suggestedRecord,
      },
    };
  }
  const suggestedText = requiredString(issue.suggestedText, "suggestedText");
  return {
    issueId: randomUUID(),
    targetId: field.targetId,
    fieldLabel: field.label,
    type,
    severity,
    originalText,
    explanation,
    ...(typeof issue.evidence === "string" ? { evidence: issue.evidence } : {}),
    suggestedText,
    suggestedOperation: {
      op: "setText",
      targetId: field.targetId,
      value: suggestedText,
    },
  };
}

function responseText(payload: unknown): string {
  const candidates = record(payload).candidates;
  const candidate = Array.isArray(candidates) ? record(candidates[0]) : {};
  const parts = record(candidate.content).parts;
  if (!Array.isArray(parts))
    throw new Error("Gemini quality review response has no content.");
  const text = parts
    .map((part) => record(part).text)
    .find((item) => typeof item === "string");
  if (typeof text !== "string")
    throw new Error("Gemini quality review response has no text.");
  return text;
}

function errorMessage(payload: unknown): string {
  const message = record(record(payload).error).message;
  return typeof message === "string" ? message : JSON.stringify(payload);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string")
    throw new Error(`Quality review response is missing ${name}.`);
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
