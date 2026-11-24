import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

function projectTempDirectory(): string {
  const directory = fileURLToPath(new URL("../../../outputs/tmp/", import.meta.url));
  mkdirSync(directory, { recursive: true });
  return directory;
}
import path from "node:path";
import test from "node:test";

import type { CandidateGroundTruth } from "@document-tree/rdt";
import { LocalCandidateStore } from "../src/local-candidate-store.js";

const groundTruth: CandidateGroundTruth = {
  schemaVersion: "1.0",
  candidateId: "jane-doe",
  generatedAt: "2026-08-03T12:00:00.000Z",
  documents: [],
  fullText: "===== Jane_Doe.pdf =====\nJane Doe\nSkills: TypeScript",
  integrity: {
    totalDocuments: 1,
    totalPages: 2,
    pagesWithText: 2,
    totalTextItems: 18,
    warnings: [],
  },
};

test("local candidate store persists PDF, ground truth JSON and extracted text", async () => {
  const directory = await mkdtemp(
    path.join(projectTempDirectory(), "cv-candidate-store-"),
  );
  const bytes = new Uint8Array([37, 80, 68, 70, 45]);
  const created = await new LocalCandidateStore(directory).create(
    "Jane_Doe.pdf",
    bytes,
    groundTruth,
  );

  assert.equal(created.name, "Jane_Doe");
  assert.equal(created.pageCount, 2);
  assert.equal(created.textItems, 18);

  const restartedStore = new LocalCandidateStore(directory);
  assert.deepEqual(await restartedStore.list(), [created]);
  const loaded = await restartedStore.get(created.candidateLibraryId);
  assert.deepEqual(loaded?.groundTruth, groundTruth);
  assert.deepEqual(Array.from(loaded?.originalBytes ?? []), Array.from(bytes));
  assert.equal(
    await readFile(
      path.join(directory, created.candidateLibraryId, "extracted.txt"),
      "utf8",
    ),
    groundTruth.fullText,
  );

  assert.equal(await restartedStore.delete(created.candidateLibraryId), true);
  assert.deepEqual(await restartedStore.list(), []);
});

test("local candidate store accepts Office candidate files", async () => {
  const directory = await mkdtemp(
    path.join(projectTempDirectory(), "cv-candidate-store-"),
  );
  const created = await new LocalCandidateStore(directory).create(
    "Jane_Doe.docx",
    new Uint8Array([1, 2, 3]),
    groundTruth,
  );
  assert.equal(created.fileName, "Jane_Doe.docx");
  assert.deepEqual(
    Array.from(
      (await new LocalCandidateStore(directory).get(created.candidateLibraryId))
        ?.originalBytes ?? [],
    ),
    [1, 2, 3],
  );
});

test("local candidate store rejects unsupported files", async () => {
  const directory = await mkdtemp(
    path.join(projectTempDirectory(), "cv-candidate-store-"),
  );
  await assert.rejects(
    new LocalCandidateStore(directory).create(
      "Jane_Doe.txt",
      new Uint8Array(),
      groundTruth,
    ),
    /PDF, DOCX, or PPTX/,
  );
});
