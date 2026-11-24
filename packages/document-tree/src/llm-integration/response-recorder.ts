import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../project-paths.js";

export const DEFAULT_LLM_RESPONSE_DIRECTORY = "manual/llm-responses";
export const DEFAULT_LLM_CALL_DIRECTORY = "manual/llm-calls";

export interface LlmTokenUsage {
  promptTokens?: number;
  candidateTokens?: number;
  totalTokens?: number;
  cachedContentTokens?: number;
  thoughtsTokens?: number;
}

export interface LlmCallRecord {
  provider: "google-gemini";
  model: string;
  callType: "mapping" | "validation" | "template_semantics";
  targetId?: string;
  requestStartedAt: string;
  requestEndedAt: string;
  durationMs: number;
  status: "succeeded" | "failed";
  httpStatus?: number;
  requestId?: string;
  tokenUsage?: LlmTokenUsage;
  error?: string;
}

export async function recordLlmResponseBody(
  body: string,
  directory = process.env.LLM_RESPONSE_DIR ?? DEFAULT_LLM_RESPONSE_DIRECTORY,
  now = new Date(),
): Promise<string> {
  directory = resolveProjectPath(directory);
  await mkdir(directory, { recursive: true });
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const basePath = path.join(directory, `${timestamp}.json`);
  const content = body.trimEnd() + "\n";

  for (let sequence = 0; ; sequence++) {
    const filePath =
      sequence === 0 ? basePath : path.join(directory, `${timestamp}-${sequence}.json`);
    try {
      await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (error) {
      if (isFileExistsError(error)) continue;
      throw error;
    }
  }
}

export async function recordLlmCall(
  call: LlmCallRecord,
  directory = process.env.LLM_CALL_LOG_DIR ?? DEFAULT_LLM_CALL_DIRECTORY,
): Promise<string> {
  directory = resolveProjectPath(directory);
  await mkdir(directory, { recursive: true });
  const timestamp = call.requestStartedAt.replaceAll(":", "-").replaceAll(".", "-");
  const target = call.targetId ? `-${safeFilePart(call.targetId)}` : "";
  const basePath = path.join(directory, `${timestamp}-${call.callType}${target}.json`);
  const content = JSON.stringify(call, null, 2) + "\n";
  for (let sequence = 0; ; sequence++) {
    const filePath = sequence === 0 ? basePath : basePath.replace(/\.json$/u, `-${sequence}.json`);
    try {
      await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (error) {
      if (isFileExistsError(error)) continue;
      throw error;
    }
  }
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "-").slice(0, 80);
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
