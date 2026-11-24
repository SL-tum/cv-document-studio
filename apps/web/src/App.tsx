import { useState } from "react";

import type {
  CandidateImportResult,
  ReviewDocument,
} from "@cv-document-studio/review-contracts";
import { reviewDocumentToBlocks } from "./adapters/review/reviewDocumentAdapter";
import { DocumentExport } from "./components/DocumentExport";
import { TemplateUpload } from "./components/DocumentUpload";
import { CandidateUpload } from "./components/CandidateUpload";
import { TemplateLibrary } from "./components/TemplateLibrary";
import { CandidateLibrary } from "./components/CandidateLibrary";
import { BatchGeneration } from "./components/BatchGeneration";
import { GenerationBriefFields } from "./components/GenerationBriefFields";
import { TemplateExtractionReview } from "./components/TemplateExtractionReview";
import {
  emptyGenerationBrief,
  generationBriefIsReady,
  toGenerationBrief,
  type GenerationBriefDraft,
} from "./types/generationBrief";
import { generateCandidatePreview } from "./api/documents";
import { BlockNoteEditor } from "./editor/BlockNoteEditor";
import type { JsonValue } from "./types/document";
import "./App.css";

const initialDocument: JsonValue = [
  {
    type: "heading",
    props: { level: 1 },
    content: "Start writing",
  },
  {
    type: "paragraph",
    content: "Use the editor to draft and format your document.",
  },
];

export default function App() {
  const [document, setDocument] = useState<JsonValue>(initialDocument);
  const [editorDocument, setEditorDocument] =
    useState<JsonValue>(initialDocument);
  const [editorRevision, setEditorRevision] = useState(0);
  const [review, setReview] = useState<ReviewDocument>();
  const [candidate, setCandidate] = useState<CandidateImportResult>();
  const [generationStatus, setGenerationStatus] = useState<
    "idle" | "generating" | "ready" | "error"
  >("idle");
  const [generationMessage, setGenerationMessage] = useState<string>();
  const [templateLibraryRefresh, setTemplateLibraryRefresh] = useState(0);
  const [candidateLibraryRefresh, setCandidateLibraryRefresh] = useState(0);
  const [brief, setBrief] =
    useState<GenerationBriefDraft>(emptyGenerationBrief);

  function activateTemplate(reviewDocument: ReviewDocument) {
    const imported = reviewDocumentToBlocks(reviewDocument);
    setDocument(imported);
    setEditorDocument(imported);
    setReview(reviewDocument);
    setEditorRevision((revision) => revision + 1);
    setGenerationStatus("idle");
    setGenerationMessage(undefined);
  }

  function selectCandidate(nextCandidate: CandidateImportResult) {
    setCandidate(nextCandidate);
    setGenerationStatus("idle");
    setGenerationMessage(
      "Complete the generation brief, then generate the tailored CV.",
    );
  }

  async function generateDocument() {
    if (
      !review?.sessionId ||
      !candidate?.candidateSessionId ||
      !generationBriefIsReady(brief)
    )
      return;
    setGenerationStatus("generating");
    setGenerationMessage(
      "Gemini is tailoring the selected template to the target role and project…",
    );
    try {
      const result = await generateCandidatePreview({
        templateSessionId: review.sessionId,
        candidateSessionId: candidate.candidateSessionId,
        brief: toGenerationBrief(brief),
      });
      const imported = reviewDocumentToBlocks(result.reviewDocument);
      setReview(result.reviewDocument);
      setDocument(imported);
      setEditorDocument(imported);
      setEditorRevision((revision) => revision + 1);
      setGenerationStatus("ready");
      const skipped = result.notApplicableFields
        .map((field) => field.label ?? field.targetId)
        .join(", ");
      setGenerationMessage(
        `Tailored preview ready in ${(result.performance.totalMs / 1000).toFixed(1)}s · ${result.llmCalls} LLM calls · ${result.performance.layoutRetries} layout retry/retries${skipped ? ` · Left empty (no supported facts): ${skipped}` : ""}`,
      );
    } catch (reason) {
      setGenerationStatus("error");
      setGenerationMessage(
        reason instanceof Error
          ? reason.message
          : "Candidate generation failed.",
      );
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">CV Transformer</p>
          <h1>Document editor</h1>
          <p>Your changes are held locally for this MVP.</p>
        </div>
        <div className="document-actions">
          <TemplateUpload
            onImported={(reviewDocument) => {
              activateTemplate(reviewDocument);
              setTemplateLibraryRefresh((value) => value + 1);
            }}
          />
          <CandidateUpload
            onImported={(candidates) => {
              const latest = candidates.at(-1);
              if (latest) selectCandidate(latest);
              setCandidateLibraryRefresh((value) => value + 1);
            }}
          />
        </div>
      </header>

      <section className="generation-brief" aria-label="Generation brief">
        <header className="generation-brief__header">
          <div>
            <p className="eyebrow">Single generation</p>
            <h2>Tailor this CV to the assignment</h2>
            <p>
              Project and role context guides relevance only; candidate facts
              remain the sole factual source.
            </p>
          </div>
          <div className="document-actions">
            <button
              className="document-action-button"
              disabled={
                generationStatus === "generating" ||
                !review ||
                Boolean(review.templateExtractionReview?.length) ||
                !candidate ||
                !generationBriefIsReady(brief)
              }
              onClick={generateDocument}
              type="button"
            >
              {generationStatus === "generating"
                ? "Generating…"
                : "Generate tailored CV"}
            </button>
            <DocumentExport
              document={document}
              review={review}
              onApplied={setReview}
              disabled={generationStatus !== "ready"}
            />
          </div>
        </header>
        <div className="single-generation__libraries">
          <TemplateLibrary
            activeFileName={review?.documentId}
            onSelected={activateTemplate}
            refreshKey={templateLibraryRefresh}
          />
          <CandidateLibrary
            activeFileName={candidate?.fileName}
            onSelected={selectCandidate}
            refreshKey={candidateLibraryRefresh}
          />
        </div>
        {review?.templateExtractionReview?.length ? (
          <TemplateExtractionReview
            review={review}
            onResolved={(nextReview) => activateTemplate(nextReview)}
          />
        ) : null}
        {generationMessage && (
          <output
            className={`generation-status generation-status--prominent generation-status--${generationStatus}`}
            aria-live="polite"
          >
            <span className="generation-status__indicator" aria-hidden="true" />
            <span>{generationMessage}</span>
          </output>
        )}
        <GenerationBriefFields
          disabled={generationStatus === "generating"}
          idPrefix="single-brief"
          onChange={(value) => {
            setBrief(value);
            if (generationStatus === "ready") {
              setGenerationStatus("idle");
              setGenerationMessage(
                "The brief changed. Generate again before review and export.",
              );
            }
          }}
          value={brief}
        />
      </section>

      <section className="editor-card" aria-label="Document editor">
        <BlockNoteEditor
          key={editorRevision}
          initialDocument={editorDocument}
          onDocumentChange={(result) => setDocument(result.document)}
        />
      </section>

      <output className="save-status" aria-live="polite">
        {review
          ? `${review.format.toUpperCase()} · revision ${review.revision} · ${review.fields.length} fields`
          : Array.isArray(document)
            ? `${document.length} blocks`
            : "Document ready"}
      </output>
      <output className="save-status" aria-live="polite">
        {candidate
          ? `Candidate: ${candidate.fileName} · ${candidate.pageCount} pages · ${candidate.characterCount} characters`
          : "No candidate CV imported"}
      </output>

      <BatchGeneration
        candidateRefreshKey={candidateLibraryRefresh}
        templateRefreshKey={templateLibraryRefresh}
      />
    </main>
  );
}
