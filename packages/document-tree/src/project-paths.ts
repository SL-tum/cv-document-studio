import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Resolve project files independently of cwd and reject paths outside the project. */
export function resolveProjectPath(value: string): string {
  const resolved = path.resolve(PROJECT_ROOT, value);
  const assertInside = (target: string) => {
    const relative = path.relative(realpathSync(PROJECT_ROOT), target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Path must stay inside the project: ${value}`);
    }
  };
  assertInside(resolved);
  let ancestor = resolved;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  assertInside(realpathSync(ancestor));
  return resolved;
}
