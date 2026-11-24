import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CandidateLibraryItem } from "@cv-document-studio/review-contracts";
import type { CandidateGroundTruth } from "@document-tree/rdt";

interface StoredCandidateMetadata extends CandidateLibraryItem {
  schemaVersion: "1.0";
  originalFile: string;
  groundTruthFile: "ground-truth.json";
  textFile: "extracted.txt";
}

export interface StoredCandidate {
  metadata: CandidateLibraryItem;
  groundTruth: CandidateGroundTruth;
  originalBytes: Uint8Array;
}

export class LocalCandidateStore {
  constructor(private readonly rootDirectory: string) {}

  async list(): Promise<CandidateLibraryItem[]> {
    await mkdir(this.rootDirectory, { recursive: true });
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    const candidates = await Promise.all(
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
    return candidates
      .filter((candidate): candidate is StoredCandidateMetadata =>
        Boolean(candidate),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(toLibraryItem);
  }

  async create(
    fileName: string,
    originalBytes: Uint8Array,
    groundTruth: CandidateGroundTruth,
  ): Promise<CandidateLibraryItem> {
    const extension = candidateExtension(fileName);
    if (!extension)
      throw new Error("Candidate CV must be a PDF, DOCX, or PPTX file.");
    const candidateLibraryId = randomUUID();
    const directory = this.candidateDirectory(candidateLibraryId);
    const metadata: StoredCandidateMetadata = {
      schemaVersion: "1.0",
      candidateLibraryId,
      candidateId: groundTruth.candidateId,
      name: fileName.replace(/\.(?:pdf|docx|pptx)$/iu, ""),
      fileName,
      createdAt: new Date().toISOString(),
      size: originalBytes.byteLength,
      pageCount: groundTruth.integrity.totalPages,
      characterCount: groundTruth.fullText.length,
      textItems: groundTruth.integrity.totalTextItems,
      warnings: groundTruth.integrity.warnings,
      originalFile: `original.${extension}`,
      groundTruthFile: "ground-truth.json",
      textFile: "extracted.txt",
    };
    await mkdir(this.rootDirectory, { recursive: true });
    await mkdir(directory, { recursive: false });
    await Promise.all([
      writeFile(path.join(directory, metadata.originalFile), originalBytes),
      writeFile(
        path.join(directory, metadata.groundTruthFile),
        `${JSON.stringify(groundTruth, null, 2)}\n`,
      ),
      writeFile(path.join(directory, metadata.textFile), groundTruth.fullText),
      writeFile(
        path.join(directory, "metadata.json"),
        `${JSON.stringify(metadata, null, 2)}\n`,
      ),
    ]);
    return toLibraryItem(metadata);
  }

  async get(candidateLibraryId: string): Promise<StoredCandidate | undefined> {
    if (!isLibraryId(candidateLibraryId)) return undefined;
    try {
      const metadata = await this.readMetadata(candidateLibraryId);
      const directory = this.candidateDirectory(candidateLibraryId);
      const [groundTruthText, originalBytes] = await Promise.all([
        readFile(path.join(directory, metadata.groundTruthFile), "utf8"),
        readFile(path.join(directory, metadata.originalFile)),
      ]);
      return {
        metadata: toLibraryItem(metadata),
        groundTruth: JSON.parse(groundTruthText) as CandidateGroundTruth,
        originalBytes,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async delete(candidateLibraryId: string): Promise<boolean> {
    if (
      !isLibraryId(candidateLibraryId) ||
      !(await this.get(candidateLibraryId))
    )
      return false;
    await rm(this.candidateDirectory(candidateLibraryId), { recursive: true });
    return true;
  }

  private async readMetadata(
    candidateLibraryId: string,
  ): Promise<StoredCandidateMetadata> {
    const value = JSON.parse(
      await readFile(
        path.join(this.candidateDirectory(candidateLibraryId), "metadata.json"),
        "utf8",
      ),
    ) as StoredCandidateMetadata;
    if (
      value.schemaVersion !== "1.0" ||
      value.candidateLibraryId !== candidateLibraryId
    ) {
      throw new Error(
        `Invalid stored candidate metadata: ${candidateLibraryId}`,
      );
    }
    return value;
  }

  private candidateDirectory(candidateLibraryId: string): string {
    return path.join(this.rootDirectory, candidateLibraryId);
  }
}

function candidateExtension(
  fileName: string,
): "pdf" | "docx" | "pptx" | undefined {
  const extension = fileName.toLowerCase().match(/\.([^.]+)$/u)?.[1];
  return extension === "pdf" || extension === "docx" || extension === "pptx"
    ? extension
    : undefined;
}

function isLibraryId(value: string): boolean {
  return /^[0-9a-f-]{36}$/iu.test(value);
}

function toLibraryItem(
  metadata: StoredCandidateMetadata,
): CandidateLibraryItem {
  return {
    candidateLibraryId: metadata.candidateLibraryId,
    candidateId: metadata.candidateId,
    name: metadata.name,
    fileName: metadata.fileName,
    createdAt: metadata.createdAt,
    size: metadata.size,
    pageCount: metadata.pageCount,
    characterCount: metadata.characterCount,
    textItems: metadata.textItems,
    warnings: metadata.warnings,
  };
}
