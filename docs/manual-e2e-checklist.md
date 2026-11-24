# Manual end-to-end test checklist

Use synthetic template and candidate files for this checklist. Do not use real candidate data unless
you intend to send it to the configured Gemini API.

## Prerequisites

- Add a valid `GEMINI_API_KEY` to the repository-root `.env`.
- Prepare one synthetic DOCX or PPTX template with text, list, and collection targets where possible.
- Prepare at least two synthetic candidate resumes in PDF, DOCX, or PPTX format.
- Run `npm run build`, `npm run dev:api`, and `npm run dev:web`.
- Open `http://127.0.0.1:5173`.

## Single-document generation

- Import the template and confirm it appears in the Template Library.
- Import a candidate and confirm it appears in the Candidate Library.
- Confirm generation does not start automatically.
- Confirm **Generate tailored CV** is disabled until Target role and Project or job background are
  populated.
- Complete every Generation Brief field and start generation.
- Import a PPTX whose profile/contact shape contains separate `Name` and `Address` paragraphs but no
  explicit RDT markers. Confirm one `template_semantics` call is logged, both high-confidence fields
  appear in the review document, and candidate name/address replace the correct paragraphs without
  changing the surrounding shape formatting.
- Confirm the generated content reflects the role/project context but contains no candidate facts
  that are only present in the Brief.
- Change the Brief after generation and confirm export is disabled until regeneration.
- Edit a generated field, select **Review & Export**, resolve every reported issue, and download the
  reviewed Office document.
- In a collection table cell, press Enter and confirm it creates a visible plain-text line break
  without moving to another field; review and export the document and verify the cell content.
- Select text in a non-table paragraph and use Bulleted list and Numbered list in the floating
  formatting toolbar; confirm the block type and exported field items update as expected. Select
  text in a table cell and confirm both structural-list actions are disabled.
- Open the downloaded file in Word or PowerPoint and check content, formatting, and native layout.
- In browser developer tools, inspect the generation response and confirm `performance` includes
  mapping, operation-execution, export/validation, call, retry, and concurrency measurements.
- With a template containing at least four editable fields plus a Profile/Summary field, confirm
  detail-field requests run in bounded parallel waves and the Profile/Summary is generated last.
- Force one field to exceed its layout budget and confirm only that field is retried, with no more
  than three field-level attempts by default; confirm `layoutRetries` increases while
  `fullDocumentRetries` remains zero.
- Use a candidate with no certifications and a template containing an editable Certifications
  section. Confirm Gemini may return an empty operations array, generation still succeeds, the
  section is left empty, and the status message identifies it as having no supported facts.
- Repeat the empty optional-section check in batch generation and confirm the item proceeds to
  quality review instead of entering `failed`.

## Batch generation

- Select one saved template and two or more saved candidates.
- Confirm no more than 10 candidates can be selected.
- Complete the shared Generation Brief and start the batch.
- Confirm per-item states progress through pending, generating, reviewing, and approved or
  review-required/failed.
- Confirm one failed item does not stop other items.
- Resolve every review-required item.
- Retry a failed item after active batch work finishes.
- Download the ZIP and confirm it contains `manifest.json` and one file under `documents/` for every
  approved item.
- Confirm filenames are unique and each output contains only its corresponding candidate facts.
- Confirm bounded concurrent quality review completes successfully without Gemini rate-limit errors;
  inspect each review response's `metadata.totalMs` and `metadata.maxConcurrency`.

## Restart behavior

- Start a batch, restart the API, and confirm the current MVP loses the in-memory batch and document
  sessions.
- Confirm Template Library and Candidate Library entries remain available after restart.

## Template snapshot reuse and isolation

- Import one template, create multiple sessions from it, and confirm every new session starts with
  the exact original field values and revision.
- Generate a document for candidate A, then generate one for candidate B from the same template;
  confirm candidate B's output contains no facts or edits from candidate A.
- Edit and quality-approve one generated session, then create another session from the same saved
  template; confirm the new session remains unchanged by the earlier edits.
- Run a multi-candidate batch with one template and confirm every item preserves the same template
  structure and formatting while containing only its corresponding candidate facts.
- Retry a failed batch item and confirm it starts from the pristine template snapshot rather than
  from any previous partial generation attempt.
- During one API process lifetime, create several sessions and a batch from the same saved template;
  check `/api/health` before and after and confirm `templateSnapshotBuilds` increases only on the
  first cache miss, not once per session or candidate; `cachedTemplateSnapshots` should represent
  the number of currently cached saved templates.
- Restart the API and confirm the first session created from a saved template rebuilds the in-memory
  snapshot successfully from the original Office file; subsequent sessions should reuse it.
- Delete a saved template and confirm no new session can be created from it. Existing sessions may
  continue until the API process stops because they retain their private in-memory snapshot.

## Regression checks

- Candidate imports accept PDF, DOCX, and PPTX and reject unsupported extensions.
- A scanned/image-only PDF is rejected.
- Direct export of an unapproved revision is rejected.
- Editing an approved revision invalidates its quality approval.
- DOCX output contains no redundant blank table rows.
- PPTX output stays within the expected text shapes for typical inputs.
