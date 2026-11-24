import type { LlmTemplateDocument, TemplateOperation } from "../llm-template/index.js";
import type { LlmTokenUsage } from "./response-recorder.js";

export interface LlmGenerationRequest {
  template: LlmTemplateDocument;
  userInput: unknown;
  allowedOperations: string[];
  messages?: LlmPromptMessage[];
  context?: { language?: string; purpose?: string };
}
export interface LlmPromptMessage {
  role: "system" | "user";
  content: string;
}
export interface LlmGenerationResult {
  operations: TemplateOperation[];
  warnings?: string[];
  metadata?: {
    provider: string;
    model: string;
    requestId?: string;
    requestStartedAt?: string;
    requestEndedAt?: string;
    durationMs?: number;
    tokenUsage?: LlmTokenUsage;
  };
}
export interface LlmProvider {
  generateOperations(request: LlmGenerationRequest): Promise<LlmGenerationResult>;
}
