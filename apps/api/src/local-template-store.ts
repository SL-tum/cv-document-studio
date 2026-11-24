import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ReviewFormat, TemplateLibraryItem } from "@cv-document-studio/review-contracts";

interface StoredTemplateMetadata extends TemplateLibraryItem {
  schemaVersion: "1.0";
  originalFile: string;
}

export interface StoredTemplate {
  metadata: TemplateLibraryItem;
  bytes: Uint8Array;
}

export class LocalTemplateStore {
  constructor(private readonly rootDirectory: string) {}

  async list(): Promise<TemplateLibraryItem[]> {
    await mkdir(this.rootDirectory, { recursive: true });
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    const templates = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          try {
            return await this.readMetadata(entry.name);
          } catch {
            return undefined;
          }
        }),
    );
    return templates
      .filter((template): template is StoredTemplateMetadata => Boolean(template))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(toLibraryItem);
  }

  async create(fileName: string, bytes: Uint8Array): Promise<TemplateLibraryItem> {
    const format = templateFormat(fileName);
    const templateId = randomUUID();
    const directory = this.templateDirectory(templateId);
    const originalFile = `original.${format}`;
    const metadata: StoredTemplateMetadata = {
      schemaVersion: "1.0",
      templateId,
      name: fileName.replace(/\.(?:docx|pptx)$/iu, ""),
      fileName,
      format,
      createdAt: new Date().toISOString(),
      size: bytes.byteLength,
      originalFile,
    };
    await mkdir(this.rootDirectory, { recursive: true });
    await mkdir(directory, { recursive: false });
    await writeFile(path.join(directory, originalFile), bytes);
    await writeFile(path.join(directory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    return toLibraryItem(metadata);
  }

  async get(templateId: string): Promise<StoredTemplate | undefined> {
    if (!isTemplateId(templateId)) return undefined;
    try {
      const metadata = await this.readMetadata(templateId);
      const bytes = await readFile(path.join(this.templateDirectory(templateId), metadata.originalFile));
      return { metadata: toLibraryItem(metadata), bytes };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async delete(templateId: string): Promise<boolean> {
    if (!isTemplateId(templateId) || !(await this.get(templateId))) return false;
    await rm(this.templateDirectory(templateId), { recursive: true });
    return true;
  }

  private async readMetadata(templateId: string): Promise<StoredTemplateMetadata> {
    const value = JSON.parse(
      await readFile(path.join(this.templateDirectory(templateId), "metadata.json"), "utf8"),
    ) as StoredTemplateMetadata;
    if (value.schemaVersion !== "1.0" || value.templateId !== templateId) {
      throw new Error(`Invalid stored template metadata: ${templateId}`);
    }
    return value;
  }

  private templateDirectory(templateId: string): string {
    return path.join(this.rootDirectory, templateId);
  }
}

function templateFormat(fileName: string): ReviewFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pptx")) return "pptx";
  throw new Error("Template must be a DOCX or PPTX file.");
}

function isTemplateId(value: string): boolean {
  return /^[0-9a-f-]{36}$/iu.test(value);
}

function toLibraryItem(metadata: StoredTemplateMetadata): TemplateLibraryItem {
  return {
    templateId: metadata.templateId,
    name: metadata.name,
    fileName: metadata.fileName,
    format: metadata.format,
    createdAt: metadata.createdAt,
    size: metadata.size,
  };
}
