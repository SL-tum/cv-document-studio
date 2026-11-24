# CV Document Studio

CV Document Studio is a local-first CV tailoring application. It combines an existing DOCX or PPTX
template, a candidate resume, and an optional role/project brief to produce a reviewable and
exportable Office document. The system edits only discovered template fields and preserves the
original OOXML package, formatting, relationships, and unsupported native content.

The project is an early-stage MVP, not a general-purpose Word or PowerPoint editor. Its core design
goal is controlled document generation: candidate facts remain the only evidence source, the
template remains structurally authoritative, and every generated change is represented as a
validated operation against a canonical Rich Document Tree (RDT).

## Main capabilities

- Import DOCX/PPTX templates and discover editable text, list, and collection regions.
- Import PDF, DOCX, and PPTX candidate resumes into reusable Candidate Ground Truth.
- Tailor content using Gemini with role, project, skill, emphasis, and language context.
- Preserve an unchanged template snapshot while creating isolated output sessions.
- Review generated content in a BlockNote-based browser editor.
- Preview and apply edits as revision-checked, atomic template operations.
- Validate grammar, unsupported facts, and contradictions against the candidate resume.
- Generate one document interactively or up to 10 candidate outputs in a batch.
- Export validated DOCX/PPTX files without rebuilding the Office package from browser HTML.
- Record every Gemini mapping/validation call with timing and token usage.

## System architecture

```text
┌────────────────────────── Browser ──────────────────────────┐
│ React/Vite UI                                               │
│ Libraries · Generation Brief · BlockNote review · Export   │
└─────────────────────────────┬───────────────────────────────┘
                              │ ReviewDocument / operations
                              ▼
┌──────────────────────── Node API ───────────────────────────┐
│ HTTP routes · in-memory sessions · batch orchestration      │
│ template/candidate stores · Gemini quality review           │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌──── document-tree package ────┐   ┌──── local persistence ──┐
│ OOXML import/export           │   │ data/templates           │
│ Rich Document Tree            │   │ data/candidates          │
│ template extraction/bindings  │   │ manual/llm-* logs        │
│ mapping/layout/quality logic  │   └──────────────────────────┘
└──────────────┬────────────────┘
               │ HTTPS
               ▼
        Google Gemini API
```

The browser never receives raw OOXML, native package parts, relationship data, or RDT bindings. It
receives a compact `ReviewDocument` with stable target IDs, values, constraints, format, and
revision. The API keeps the corresponding RDT, binding map, and native Office data in memory so an
export patches the original package rather than reconstructing it from editor content.

## Workflow

The complete single-generation path is:

```text
Template upload/select
  → immutable Template Snapshot (Office bytes + RDT + bindings + ReviewDocument)
Candidate upload/select
  → persisted Candidate Ground Truth
Generation Brief
  → section plan
  → Gemini Mapping (bounded concurrency, summaries after detail sections)
  → typed TemplateOperations
  → normalize + preview + layout-fit retry
  → atomic execution on a snapshot clone
  → ReviewDocument projection
  → browser edits as additional operations
  → Gemini grounding/quality review
  → revision approval
  → patch preserved OOXML package
  → DOCX/PPTX download
```

### 1. Import and prepare a template

```text
DOCX/PPTX bytes
    │
    ├─→ persist original file + metadata in Template Library
    │
    └─→ Office importer → RDT + NativeStore
                          │
                          ├─→ explicit marker extraction
                          ├─→ deterministic hybrid candidate discovery
                          │       └─→ PPTX slide placeholder ↔ slide-layout prompt inheritance
                          ├─→ one structured Gemini Semantic Review for unresolved candidates
                          │
                          ├─→ LlmTemplateDocument
                          ├─→ TemplateBindingMap
                          └─→ original ReviewDocument
```

Explicit markers are used when present. Hybrid extraction then applies deterministic structural
rules to unmarked content, such as label/value relationships and supported table or shape
structures. Remaining ambiguous text candidates receive one structured Gemini semantic review.
The model may propose editable, fixed, needs-review, or ignored semantics, but it can select only
existing candidate IDs; deterministic binding validation remains authoritative. This allows
paragraph-level fields such as Name and Address in one PPTX shape without giving the model access to
OOXML paths or native payloads. PPTX extraction also estimates layout capacity for editable shapes.

Candidates above the automatic-accept threshold become editable immediately. Lower-confidence
`needsReview` candidates are exposed in a Template Extraction Review panel before generation. The
user can accept the suggested field, mark it as fixed template content, or ignore it. Generation is
blocked while decisions remain pending. Accepted fields become editable and enter Mapping; fixed or
ignored fields do not. Decisions are copied into the current in-memory Template Snapshot so later
sessions and batch items reuse them until the API restarts.

For an empty PPTX placeholder, extraction matches the slide placeholder to its Slide Layout by
`placeholderIndex`, falling back to `placeholderType`. A layout placeholder marked with
`hasCustomPrompt="1"` contributes its prompt text—such as `First Name, Name` plus `Project Role`—as
semantic evidence. The prompt is bound to the empty paragraph on the slide, not to the layout
paragraph. It is explicitly marked as a template instruction rather than candidate evidence, and
line breaks are preserved. Gemini uses it to decide whether the slot is editable, what it represents,
and whether Mapping should generate text or a list. The saved Slide Layout remains unchanged.

The imported RDT, deterministic and LLM-assisted extraction result, original `ReviewDocument`, and
master bytes form an immutable in-memory Template Snapshot. Semantic review runs once per snapshot
build and is reused by new sessions and batch items. Mapping, editing, and retries never mutate the
saved template or its snapshot. If semantic review is unavailable or invalid, import falls back to
the deterministic extraction and records a warning.

### 2. Import candidate ground truth

```text
PDF/DOCX/PPTX resume
    │
    ├─→ format-specific text extraction
    │     PDF: pages + positioned text items
    │     DOCX: body/tables/headers/footers and supported text containers
    │     PPTX: shapes/groups/placeholders/notes in slide order
    │
    └─→ CandidateGroundTruth
          ├─ full normalized source text
          ├─ per-document/page text and audit metadata
          ├─ source hashes and integrity information
          └─ extraction warnings
```

The original file, metadata, `ground-truth.json`, and `extracted.txt` are saved once. Reopening a
candidate loads the saved Ground Truth instead of parsing the original file again. PDF input must
have a real text layer; OCR is not currently included.

### 3. Generate a tailored document

```text
Template Snapshot clone ────────────┐
CandidateGroundTruth ───────────────┼─→ section-by-section Gemini Mapping
Generation Brief ───────────────────┘             │
                                                  ├─→ structured TemplateOperations
                                                  ├─→ operation normalization
                                                  ├─→ operation preview
                                                  │      ├─ revision/target/permission checks
                                                  │      ├─ binding/constraint checks
                                                  │      └─ trial execution + trial export
                                                  ├─→ layout-fit check/retry
                                                  └─→ atomic operation execution
                                                               │
                                                               ▼
                                                    generated ReviewDocument
```

Mapping uses each editable template section as the target boundary. Detail sections run in waves
with concurrency 3; professional summaries run afterward so they can account for earlier generated
content. Each prompt receives the complete candidate knowledge base, current section context,
template overview, prior operations, and optional Generation Brief. For an inherited PPTX custom
prompt, the section context also contains `placeholderPrompt`; the model is told to use it only as
the expected content/format description and never as a candidate fact.

The Generation Brief affects relevance, ordering, framing, tone, and output language. It is not
candidate evidence: requested skills or experiences are omitted unless Candidate Ground Truth
supports them.

Optional fact sections—currently certifications, clients, languages, and industry experience—may
legitimately return no operations when the candidate source contains no supporting facts. They are
recorded as `not_applicable`, left empty, and do not fail the generation. Required sections still
reject an empty result, but the model is never instructed to invent content to satisfy coverage.

For sections with layout capacity, the prompt includes explicit character, line, and item budgets.
The returned operation is then checked deterministically. A field that does not fit is regenerated
with layout feedback, with three attempts by default. Accepted operations are normalized, validated,
and applied atomically to a fresh snapshot clone.

The model can return only typed operations against known target IDs:

| Template node | Mapping operation | Native write behavior |
| ------------- | ----------------- | --------------------- |
| Text | `setText` | Replaces mapped runs or creates runs in an empty DOCX/PPTX paragraph |
| List | `setList` | Reuses mapped paragraphs or creates sibling PPTX paragraphs for an empty placeholder |
| Collection | `appendCollectionItem` / item update/remove | Clones and updates a proven native prototype |

For a completely empty PPTX paragraph, generated runs are inserted before `a:endParaRPr`, which is
required for PowerPoint to recognize the text. Embedded newlines become native `a:br` nodes. For an
empty PPTX list placeholder, the first item is inserted into the existing paragraph and later items
become adjacent paragraphs, preserving paragraph properties and inherited placeholder formatting.
Operation Preview uses this same execution path, so unsupported bindings fail before session state
is changed.

### 4. Review and edit

The API projects the generated document into `ReviewDocument`; the web adapter converts those
fields into BlockNote blocks. Browser edits become `TemplateOperation` objects such as `setText`,
`setList`, or collection-item updates.

```text
BlockNote edit → operation preview → revision/target/constraint validation
                                      │
                                      └─→ atomic apply → revision increment
```

Preview does not mutate the document. A successful apply updates both the RDT-backed session and
its projected review state. Any edit after quality approval invalidates that approval.

### 5. Quality review and export

Every non-empty review field is checked against Candidate Ground Truth. Collection records are
reviewed separately. Validation calls run with concurrency 3 and return at most one actionable
grammar, unsupported-fact, or contradiction issue per checked field.

```text
current ReviewDocument + CandidateGroundTruth
                    │
                    └─→ Gemini validation
                              │
                    no issues ├─→ approve current revision
                              └─→ user applies suggestion or keeps original
                                               │
                                               └─→ approve current revision
                                                            │
                                                            ▼
                                      export clone → deterministic checks
                                                            │
                                                            ▼
                                                reviewed.docx/.pptx
```

Export is revision-gated. Every issue must have a decision, and direct export calls fail if the
current revision has not passed quality review. DOCX cleanup and OOXML/RDT/content checks run on an
export clone, leaving the editable session intact. PPTX export starts from the preserved original
package, synchronizes mapped existing runs, applies structural XML patches for newly created runs or
paragraphs, and preserves unrelated slides, layouts, masters, media, relationships, and opaque parts.

### 6. Batch generation

Batch mode combines one saved template, one shared Generation Brief, and 1–10 saved candidates.
Two candidates are processed concurrently. Every item receives an independent document session,
mapping result, quality review, approval state, retry state, and output filename.

Items without quality issues are approved automatically. Items with issues remain
`review_required` until resolved; failed items can be retried after active work finishes. Approved
outputs are returned in a ZIP containing `documents/` and `manifest.json`.

## Data flow and ownership

| Data object            | Created from                  | Contains                                                        | Stored where                                | Mutable?                  |
| ---------------------- | ----------------------------- | --------------------------------------------------------------- | ------------------------------------------- | ------------------------- |
| Template library item  | Uploaded DOCX/PPTX            | Metadata and unchanged Office bytes                             | `data/templates/`                           | Saved source is immutable |
| Template Snapshot      | Template library bytes        | Master bytes, RDT, extraction/bindings, original ReviewDocument | API memory/cache                            | No; cloned for use        |
| Template session       | Snapshot clone                | Working RDT, extraction state, revision, quality approval       | API memory                                  | Yes                       |
| Candidate library item | Uploaded resume               | Original file, metadata, Ground Truth, extracted text           | `data/candidates/`                          | Saved source is immutable |
| Candidate session      | Candidate library item        | Reference to loaded Candidate Ground Truth                      | API memory                                  | Session lifecycle only    |
| Generation Brief       | User input                    | Role/project context, skills, emphasis, language, instructions  | Request/batch memory                        | Yes                       |
| Template operations    | Gemini or browser edits       | Typed changes keyed by stable target ID                         | Generation/session state                    | Applied atomically        |
| ReviewDocument         | RDT + bindings                | Browser-safe editable fields and revision                       | API response/session projection             | Recreated after edits     |
| Quality review         | ReviewDocument + Ground Truth | Issues, evidence, suggestions, decisions                        | Session/batch memory                        | Yes                       |
| Exported document      | Approved session              | Patched original Office package                                 | Download response/batch memory              | Output artifact           |
| Gemini call log        | Semantic/mapping/validation call | Timing, status, request ID, token usage                      | `manual/llm-calls/` by default     | Append-only files         |
| Gemini response log    | Successful Gemini response    | Raw model-returned JSON text                                    | `manual/llm-responses/` under the project root by default | Append-only files         |

Template and candidate imports are deliberately independent. Any saved candidate can be paired
with any saved template. Because each generation starts from a snapshot clone, generated content
from one candidate cannot be written into the master template or leak into another output.

## Persistence boundaries

```text
Persisted across API restart               Lost when API stops
────────────────────────────────────       ───────────────────────────────
Template original files + metadata         Template working sessions
Candidate originals + Ground Truth         Candidate sessions
Candidate extracted text                   Generated document sessions
Gemini response/call logs                  Quality approvals/decisions
                                            Batch state and batch artifacts
                                            In-memory Template Snapshot cache
```

Template Snapshots are rebuilt from saved Office bytes after an API restart. Candidate Ground Truth
does not need rebuilding. Local data and model logs can contain personal or confidential material;
they are ignored by Git but have no automatic retention or deletion policy.

## Supported inputs

| Input            | Formats    | Extraction behavior                                                   |
| ---------------- | ---------- | --------------------------------------------------------------------- |
| Template         | DOCX, PPTX | OOXML import, markers, hybrid extraction, and PPTX layout-prompt inheritance |
| Candidate resume | PDF        | Page text layer and positioned text items for auditing                |
| Candidate resume | DOCX       | Paragraphs, tables, supported controls/fields, headers, and footers   |
| Candidate resume | PPTX       | Shapes, placeholders, nested groups, and speaker notes in slide order |

All candidate formats become the same `CandidateGroundTruth`, so mapping and validation do not
depend on the source file type. DOCX `pageCount` represents logical sections because OOXML does not
store rendered Word pagination; PPTX counts slides and PDF counts pages. Upload bodies are limited
to 50 MB.

## Repository structure

```text
cv_document_studio/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── index.ts                    HTTP routes, sessions, generation and batch orchestration
│   │   │   ├── candidate-quality-review.ts Gemini validation and review-operation creation
│   │   │   ├── template-semantic-review.ts Gemini review of unresolved template candidates
│   │   │   ├── local-template-store.ts     Persistent template library
│   │   │   └── local-candidate-store.ts    Persistent candidate/Ground Truth library
│   │   ├── prompts/                         Validation and template-semantic-review prompts
│   │   ├── test/                            API/store/reviewer tests
│   │   ├── manual/                          Ignored Gemini logs and manual artifacts
│   │   └── dist/                            Compiled API output
│   └── web/
│       ├── src/
│       │   ├── App.tsx                      Top-level single/batch workflow
│       │   ├── api/documents.ts             Typed API client
│       │   ├── components/                  Upload, libraries, brief, review, export and batch UI
│       │   ├── editor/BlockNoteEditor.tsx   Semantic document editor
│       │   └── adapters/                    ReviewDocument ↔ BlockNote conversion
│       └── dist/                            Production web build
├── packages/
│   ├── document-tree/
│   │   ├── src/
│   │   │   ├── model/                       Canonical RDT and DOCX/PPTX node models
│   │   │   ├── ooxml/                       OPC package, relationships, XML and patch planning
│   │   │   ├── importers/                   DOCX/PPTX → RDT
│   │   │   ├── exporters/                   RDT/native patches → DOCX/PPTX
│   │   │   ├── mutations/                   Native-aware document mutations
│   │   │   ├── llm-template/                Editable nodes, extraction, bindings, operations, gates
│   │   │   ├── llm-integration/             Prompts, schemas, Gemini provider, call logging
│   │   │   └── candidate-pipeline/          Ground Truth, mapping, layout fit and output quality
│   │   ├── prompts/                         Mapping/operation system prompts
│   │   ├── scripts/                         Standalone candidate pipeline
│   │   └── test/                            Extraction, mapping, OOXML and round-trip tests
│   └── review-contracts/
│       └── src/index.ts                     Shared API/web request and response types
├── data/
│   ├── templates/<templateId>/              Saved template metadata and original Office file
│   └── candidates/<candidateLibraryId>/      Resume, metadata, Ground Truth and extracted text
├── docs/
│   └── manual-e2e-checklist.md               Browser and real-Gemini acceptance checklist
├── manual/
│   └── llm-responses/                        Raw successful Gemini response bodies
├── package.json                              npm workspace scripts
└── README.md
```

Generated `dist/`, local `data/`, and `manual/` content are runtime/build artifacts rather than
source architecture. See [`packages/document-tree/README.md`](packages/document-tree/README.md) for
the document engine, markers, operation schema, and standalone pipeline details.

## Quick start

### Prerequisites

- Node.js 22 (recommended)
- npm
- A Gemini API key

Create `.env` in the repository root:

```dotenv
GEMINI_API_KEY=your_api_key_here
```

Install dependencies and build all workspaces:

```bash
npm install
npm run build
```

Start the API and web app in separate terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open <http://localhost:5173>. The API listens on <http://127.0.0.1:8000> by default.

> `dev:api` runs compiled code from `apps/api/dist`. Rebuild after changing API or shared-package
> TypeScript before restarting it.

## Using the app

1. Import or select a DOCX/PPTX template.
2. Import or select one or more PDF/DOCX/PPTX candidates.
3. Enter the target role, project/job background, language, and optional targeting guidance.
4. Generate a tailored CV in Single Generation, or select candidates in Batch Generation.
5. Review and edit the generated fields.
6. Run **Review & Export** and resolve every reported issue.
7. Download the approved Office document or batch ZIP.

## API reference

| Method   | Endpoint                                                     | Description                                         |
| -------- | ------------------------------------------------------------ | --------------------------------------------------- |
| `GET`    | `/api/health`                                                | Health, session counts, and snapshot cache metrics  |
| `GET`    | `/api/templates`                                             | List saved templates                                |
| `POST`   | `/api/documents/import?filename=<name>`                      | Import/save a template and create a session         |
| `POST`   | `/api/templates/:templateId/sessions`                        | Create a session from a saved template              |
| `DELETE` | `/api/templates/:templateId`                                 | Delete a saved template                             |
| `GET`    | `/api/candidates`                                            | List saved candidates                               |
| `POST`   | `/api/candidates/import?filename=<name>`                     | Import/save a candidate resume                      |
| `POST`   | `/api/candidates/:candidateLibraryId/sessions`               | Create a candidate session                          |
| `DELETE` | `/api/candidates/:candidateLibraryId`                        | Delete a saved candidate                            |
| `POST`   | `/api/generations`                                           | Map a candidate into a template session             |
| `GET`    | `/api/documents/:sessionId/review`                           | Read the current ReviewDocument                     |
| `POST`   | `/api/documents/:sessionId/operations/preview`               | Validate operations without mutation                |
| `POST`   | `/api/documents/:sessionId/operations`                       | Atomically apply validated operations               |
| `POST`   | `/api/documents/:sessionId/template-extraction-review/resolve` | Accept, fix, or ignore an ambiguous template field  |
| `POST`   | `/api/documents/:sessionId/quality-review`                   | Validate current content against the candidate      |
| `POST`   | `/api/documents/:sessionId/quality-review/resolve`           | Resolve all quality issues                          |
| `GET`    | `/api/documents/:sessionId/export`                           | Export an approved revision                         |
| `POST`   | `/api/batches`                                               | Start a batch with one template and 1–10 candidates |
| `GET`    | `/api/batches/:batchId`                                      | Read batch/item progress                            |
| `POST`   | `/api/batches/:batchId/items/:itemId/quality-review/resolve` | Resolve one item review                             |
| `POST`   | `/api/batches/:batchId/items/:itemId/retry`                  | Retry a failed item                                 |
| `GET`    | `/api/batches/:batchId/export`                               | Download approved outputs as ZIP                    |

Raw import endpoints use the request body for file bytes and `filename` to choose the parser. JSON
contracts come from `packages/review-contracts`. Generation endpoints accept an optional `brief`;
the web UI requires target role, project background, and language.

## Configuration

| Variable                        | Default                 | Purpose                                        |
| ------------------------------- | ----------------------- | ---------------------------------------------- |
| `GEMINI_API_KEY`                | —                       | Required for mapping and quality validation    |
| `CV_STUDIO_API_PORT`            | `8000`                  | API listening port                             |
| `CV_STUDIO_FRONTEND_ORIGIN`     | `http://localhost:5173` | Additional allowed frontend origin             |
| `CV_STUDIO_TEMPLATE_DIRECTORY`  | `data/templates`        | Template library location                      |
| `CV_STUDIO_CANDIDATE_DIRECTORY` | `data/candidates`       | Candidate library location                     |
| `VITE_BACKEND_URL`              | `http://localhost:8000` | Browser-facing API base URL                    |
| `LLM_RESPONSE_DIR`              | `manual/llm-responses`  | Raw successful Gemini response directory, resolved from the project root |
| `LLM_CALL_LOG_DIR`              | `manual/llm-calls`      | Per-call timing, status, ID, and token records |

The API startup scripts remove an inherited `GEMINI_API_KEY` before loading the repository `.env`,
preventing a stale shell value from overriding project configuration. `LLM_RESPONSE_DIR` is resolved
from the repository root; other relative paths follow their owning component's documented base.

## Observability

Every Gemini template-semantic-review, mapping, and validation request produces a call record
containing call type, target ID, start/end timestamps, duration, status, HTTP status, request ID
when available, and Gemini-reported
prompt/output/thinking/total token usage. Failed requests are recorded too; token fields are absent
if Gemini does not return `usageMetadata`. Successful raw model responses are stored separately.

The generation API also returns stage timings for mapping, atomic operation execution, export and
deterministic validation, together with call/retry counts and concurrency. These response-level
performance summaries are not currently persisted.

## Development checks

```bash
npm run check
npm test
npm run build
npm run lint -w @cv-document-studio/web
```

Tests cover the RDT/OOXML engine, import/export round trips, template mapping, layout checks,
persistent stores, and candidate quality review. Browser interaction and real-model scenarios are
listed in [`docs/manual-e2e-checklist.md`](docs/manual-e2e-checklist.md).

## Current limitations

- Candidate PDFs require a text layer; OCR is not implemented.
- Images, charts, embedded objects, and other non-text candidate content are not interpreted.
- DOCX candidate counts represent logical sections rather than rendered pages.
- Sessions, quality decisions, batch state, and generated batch artifacts are held in memory.
- There is no authentication, authorization, tenant isolation, or storage retention policy.
- The browser editor is semantic rather than WYSIWYG; Office owns pagination and shape placement.
- Rendered previews, field overlays, and rendered overflow/overlap checks are not implemented.
- PPTX text fields are reviewable, but free-form slide layout editing needs a dedicated canvas.

## Roadmap

- Phase 2 template snapshots: persist versioned RDT, extraction/binding data, and the original
  ReviewDocument to disk, keyed by source hash plus parser/schema version, with automatic cache
  invalidation and safe rebuild from the original Office file
- LLM-assisted template semantics: use deterministic rules to discover candidates and prove safe
  Office bindings, then use a structured LLM review only for ambiguous fields to suggest acceptance,
  labels, section types, and text/list classification; keep final editability behind validation and
  user review, with stable IDs, prompt/model versioning, and prompt-injection boundaries
- Recoverable batch storage: persist batch metadata, per-item status, quality-review decisions, and
  generated/approved Office artifacts without serializing complete in-memory RDT sessions
- Configurable batch retention, deletion, and restart recovery
- Reusable Generation Brief Library with saved project/role profiles and “reuse last brief” support
- Rendered document previews with field-region overlays
- Pre-export rendered-layout quality checks: render DOCX/PPTX to PDF/PNG, detect page growth,
  clipping, overflow, overlap, and missing rendered text, then feed actionable layout findings back
  into bounded content-regeneration retries
- Rich table-cell editing and Office round-trip: support paragraphs, hard line breaks, bullet lists,
  and numbered lists inside collection cells by extending the editor schema, ReviewDocument cell
  values, template operations, and native DOCX `w:p`/numbering plus PPTX `a:p` bullet/auto-number
  generation, with round-trip and real Office rendering tests
- Operation audit history
- Authentication and tenant isolation
- Upload retention and deletion policies
- OCR support for scanned resumes

## 项目内文件与路径约定

所有项目文件以仓库根目录为基准，与启动命令所在目录无关。

| 内容 | 项目内位置 |
| --- | --- |
| 前后端代码 | `apps/api/src/`、`apps/web/src/` |
| 内部包及源码 | `packages/document-tree/`、`packages/review-contracts/` |
| 第三方包与版本锁 | `node_modules/`、`package-lock.json` |
| 模板输入及元数据 | `data/templates/<id>/` |
| 候选人原件、文本及 Ground Truth | `data/candidates/<id>/` |
| 提示词 | `apps/api/prompts/`、`packages/document-tree/prompts/` |
| 模型原始响应及调用记录 | `manual/llm-responses/`、`manual/llm-calls/` |
| CLI 生成文档和字段计划 | `outputs/candidate-output/`，可指定项目内路径 |
| 测试临时文件 | `outputs/tmp/` |
| 构建产物 | 各应用和包的 `dist/` |
| 本地密钥与配置 | 根目录 `.env`，不写入清单内容 |
| 文件清单和路径核查 | `npm run audit:paths` → `outputs/project-inventory.json` |

日志、CLI 输入输出及 API 数据目录统一从项目根目录解析，拒绝指向项目外部的路径（包括现有外部符号链接）。旧的应用和包目录下的日志已归并到根目录 `manual/`。上传接口的导出文档通过 HTTP 下载到浏览器，下载位置由浏览器控制；需归档时保存到本项目 `outputs/`。

项目仍需要系统安装的 Node.js/npm；Gemini 是外部联网服务，npm 锁文件包含包下载地址。这些服务地址并非可迁入的本地文件。已安装 npm 依赖保存在项目内。`audit:paths` 核查符号链接、常见外部绝对路径及已保存输入元数据，并列出所有本地文件和文本引用的服务域名；不会输出 `.env` 的内容。

从项目根目录运行 CLI（输入文件必须已放入项目内）：

```sh
npm run build
node --env-file-if-exists=.env packages/document-tree/scripts/candidate-pipeline.mjs data/candidates/<id> data/templates/<id>/original.docx outputs/candidate-output
```

## GitHub repository and private local data

The repository contains source code, prompts, tests, documentation, and the npm lockfile.
Candidate CVs, uploaded templates, extracted candidate data, AI logs, generated documents,
local environment files, installed dependencies, and build output are excluded by `.gitignore`.
They stay on your machine and are not included when cloning this repository.

After cloning:

```sh
npm ci
cp .env.example .env
# Edit .env and supply your Gemini API key.
npm run build
npm test
npm run dev:api
# In a second terminal:
npm run dev:web
```

AI generation and review send candidate text and relevant template content to Google Gemini.
Local storage does not make the AI workflow offline. Do not commit real candidate data or API keys.
