import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

function projectTempDirectory(): string {
  const directory = fileURLToPath(new URL("../../../outputs/tmp/", import.meta.url));
  mkdirSync(directory, { recursive: true });
  return directory;
}
import path from "node:path";
import test from "node:test";

import { LocalTemplateStore } from "../src/local-template-store.js";

test("local template store persists, reloads and deletes original template bytes", async () => {
  const directory = await mkdtemp(path.join(projectTempDirectory(), "cv-template-store-"));
  const original = new Uint8Array([80, 75, 3, 4, 10, 20]);
  const firstStore = new LocalTemplateStore(directory);
  const created = await firstStore.create("Consultant CV.pptx", original);

  assert.equal(created.name, "Consultant CV");
  assert.equal(created.format, "pptx");
  assert.equal(created.size, original.byteLength);

  const restartedStore = new LocalTemplateStore(directory);
  assert.deepEqual(await restartedStore.list(), [created]);
  const loaded = await restartedStore.get(created.templateId);
  assert.deepEqual(loaded?.metadata, created);
  assert.deepEqual(Array.from(loaded?.bytes ?? []), Array.from(original));

  assert.equal(await restartedStore.delete(created.templateId), true);
  assert.deepEqual(await restartedStore.list(), []);
  assert.equal(await restartedStore.get(created.templateId), undefined);
});

test("local template store rejects unsupported template formats", async () => {
  const directory = await mkdtemp(path.join(projectTempDirectory(), "cv-template-store-"));
  await assert.rejects(
    new LocalTemplateStore(directory).create("template.pdf", new Uint8Array()),
    /DOCX or PPTX/,
  );
});
