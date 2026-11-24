import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { PROJECT_ROOT, resolveProjectPath } from "../src/project-paths.js";

test("project paths remain rooted when cwd changes and reject external paths", () => {
  const previous = process.cwd();
  try {
    process.chdir(path.join(PROJECT_ROOT, "apps/api"));
    assert.equal(resolveProjectPath("data/templates"), path.join(PROJECT_ROOT, "data/templates"));
    assert.throws(() => resolveProjectPath("../outside"), /inside the project/);
    assert.throws(() => resolveProjectPath(path.dirname(PROJECT_ROOT)), /inside the project/);
  } finally { process.chdir(previous); }
});

test("project paths reject a symlink leading outside the project", () => {
  const directory = mkdtempSync(path.join(PROJECT_ROOT, "outputs/path-check-"));
  try {
    symlinkSync(path.dirname(PROJECT_ROOT), path.join(directory, "outside"), "dir");
    assert.throws(() => resolveProjectPath(path.join(directory, "outside/new-file")), /inside the project/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
