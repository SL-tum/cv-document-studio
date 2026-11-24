import { readdir, realpath, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
const issues = [];
const externalServices = new Set();
const inside = target => { const rel = path.relative(root, target); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = path.join(directory, entry.name);
    const relative = path.relative(root, full);
    if (entry.isSymbolicLink()) {
      try { const target = await realpath(full); if (!inside(target)) issues.push({ file: relative, reason: 'external symlink', target }); }
      catch { issues.push({ file: relative, reason: 'broken symlink' }); }
      continue;
    }
    if (entry.isDirectory()) { await walk(full); continue; }
    const info = await stat(full);
    files.push({ path: relative, bytes: info.size });
    if (relative.split(path.sep).includes('node_modules') || relative.split(path.sep).includes('dist') || relative.startsWith('outputs/') || relative.startsWith('scripts/audit-project')) continue;
    if (!/\.(?:ts|tsx|mjs|js|json|md|txt|css)$/.test(entry.name) && !entry.name.startsWith('.env')) continue;
    const content = await readFile(full, 'utf8');
    for (const match of content.matchAll(/(?:\/Users\/|\/home\/|\/Volumes\/|\/private\/tmp\/)[^\s"'<>`\\)]+/g)) {
      if (!inside(match[0])) issues.push({ file: relative, reason: 'external absolute path', target: match[0] });
    }
    for (const match of content.matchAll(/https?:\/\/[a-zA-Z0-9.-]+(?::\d+)?/g)) externalServices.add(match[0]);
  }
}
await walk(root);
// Persisted library metadata must refer to real files inside its own record directory.
for (const file of files.filter(file => /^data\/(templates|candidates)\/[^/]+\/metadata\.json$/.test(file.path))) {
  const metadata = JSON.parse(await readFile(path.join(root, file.path), 'utf8'));
  for (const key of ['originalFile', 'groundTruthFile', 'textFile']) {
    if (!metadata[key]) continue;
    const target = path.resolve(root, path.dirname(file.path), metadata[key]);
    try { if (!inside(await realpath(target))) throw new Error(); }
    catch { issues.push({ file: file.path, reason: `missing or external ${key}`, target: metadata[key] }); }
  }
}
const report = { generatedAt: new Date().toISOString(), root: '.', fileCount: files.length, issues, referencedOrigins: [...externalServices].sort(), files: files.sort((a,b) => a.path.localeCompare(b.path)) };
await mkdir(path.join(root, 'outputs'), { recursive: true });
await writeFile(path.join(root, 'outputs/project-inventory.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Audited ${files.length} files; ${issues.length} issues. Report: outputs/project-inventory.json`);
if (issues.length) { console.error(JSON.stringify(issues, null, 2)); process.exitCode = 1; }
