import { useEffect, useMemo, useState } from "react";

import type {
  BatchGeneration as BatchGenerationModel,
  BatchGenerationItem,
  CandidateLibraryItem,
  CandidateReviewDecision,
  TemplateLibraryItem,
} from "@cv-document-studio/review-contracts";
import {
  createBatchGeneration,
  downloadBatchGeneration,
  getBatchGeneration,
  listCandidates,
  listTemplates,
  resolveBatchQualityReview,
  retryBatchGenerationItem,
} from "../api/documents";
import { CandidateQualityReviewDialog } from "./CandidateQualityReviewDialog";
import { GenerationBriefFields } from "./GenerationBriefFields";
import {
  emptyGenerationBrief,
  generationBriefIsReady,
  toGenerationBrief,
  type GenerationBriefDraft,
} from "../types/generationBrief";

export interface BatchGenerationProps {
  templateRefreshKey: number;
  candidateRefreshKey: number;
}

export function BatchGeneration({
  templateRefreshKey,
  candidateRefreshKey,
}: BatchGenerationProps) {
  const [templates, setTemplates] = useState<TemplateLibraryItem[]>([]);
  const [candidates, setCandidates] = useState<CandidateLibraryItem[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [candidateIds, setCandidateIds] = useState<string[]>([]);
  const [batch, setBatch] = useState<BatchGenerationModel>();
  const [reviewItem, setReviewItem] = useState<BatchGenerationItem>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const [brief, setBrief] =
    useState<GenerationBriefDraft>(emptyGenerationBrief);
  const batchId = batch?.batchId;
  const batchStatus = batch?.status;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listTemplates(), listCandidates()])
      .then(([nextTemplates, nextCandidates]) => {
        if (cancelled) return;
        setTemplates(nextTemplates);
        setCandidates(nextCandidates);
        setTemplateId((current) =>
          nextTemplates.some((item) => item.templateId === current)
            ? current
            : (nextTemplates[0]?.templateId ?? ""),
        );
        setCandidateIds((current) =>
          current.filter((id) =>
            nextCandidates.some((item) => item.candidateLibraryId === id),
          ),
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(message(reason, "Batch libraries could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [templateRefreshKey, candidateRefreshKey]);

  useEffect(() => {
    if (!batchId || batchStatus !== "processing") return;
    const timer = window.setInterval(() => {
      void getBatchGeneration(batchId)
        .then(setBatch)
        .catch((reason: unknown) =>
          setError(message(reason, "Batch progress could not be loaded.")),
        );
    }, 1500);
    return () => window.clearInterval(timer);
  }, [batchId, batchStatus]);

  const canExport = batch?.status === "ready" && batch.approved > 0;
  const selectedCount = candidateIds.length;
  const selectedSet = useMemo(() => new Set(candidateIds), [candidateIds]);

  function toggleCandidate(candidateLibraryId: string) {
    setCandidateIds((current) =>
      current.includes(candidateLibraryId)
        ? current.filter((id) => id !== candidateLibraryId)
        : current.length < 10
          ? [...current, candidateLibraryId]
          : current,
    );
  }

  async function startBatch() {
    if (!templateId || !candidateIds.length) return;
    setBusy(true);
    setError(undefined);
    try {
      setBatch(
        await createBatchGeneration({
          templateLibraryId: templateId,
          candidateLibraryIds: candidateIds,
          brief: toGenerationBrief(brief),
        }),
      );
    } catch (reason) {
      setError(message(reason, "The batch could not be started."));
    } finally {
      setBusy(false);
    }
  }

  async function finishReview(
    decisions: Record<string, CandidateReviewDecision>,
  ) {
    if (!batch || !reviewItem?.qualityReview) return;
    setBusy(true);
    setError(undefined);
    try {
      const updated = await resolveBatchQualityReview(
        batch.batchId,
        reviewItem.itemId,
        {
          reviewId: reviewItem.qualityReview.reviewId,
          decisions: reviewItem.qualityReview.issues.map((issue) => ({
            issueId: issue.issueId,
            decision: decisions[issue.issueId]!,
          })),
        },
      );
      setBatch(updated);
      setReviewItem(undefined);
    } catch (reason) {
      setError(message(reason, "The review decisions could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function downloadBatch() {
    if (!batch) return;
    setBusy(true);
    setError(undefined);
    try {
      const blob = await downloadBatchGeneration(batch.batchId);
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `cv-batch-${batch.batchId.slice(0, 8)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      setBatch(await getBatchGeneration(batch.batchId));
    } catch (reason) {
      setError(message(reason, "The batch could not be downloaded."));
    } finally {
      setBusy(false);
    }
  }

  async function retryItem(itemId: string) {
    if (!batch) return;
    setBusy(true);
    setError(undefined);
    try {
      setBatch(await retryBatchGenerationItem(batch.batchId, itemId));
    } catch (reason) {
      setError(message(reason, "The failed item could not be retried."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="batch-generation"
      aria-label="Batch document generation"
    >
      <header className="batch-generation__header">
        <div>
          <p className="eyebrow">Batch generation</p>
          <h2>Generate multiple output documents</h2>
          <p>
            Choose one saved template and up to 10 candidates. Two candidates
            run concurrently.
          </p>
        </div>
        <div className="batch-generation__actions">
          {expanded && (
            <>
              <button
                className="document-action-button"
                disabled={
                  busy ||
                  !templateId ||
                  selectedCount === 0 ||
                  !generationBriefIsReady(brief) ||
                  batch?.status === "processing"
                }
                onClick={startBatch}
                type="button"
              >
                {busy
                  ? "Working…"
                  : `Generate ${selectedCount || ""} document${selectedCount === 1 ? "" : "s"}`}
              </button>
              <button
                className="document-action-button document-action-button--secondary"
                disabled={busy || !canExport}
                onClick={downloadBatch}
                type="button"
              >
                Download ZIP
              </button>
            </>
          )}
          <button
            aria-controls="batch-generation-content"
            aria-expanded={expanded}
            className="document-action-button document-action-button--secondary"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? "Collapse batch" : "Open batch generation"}
          </button>
        </div>
      </header>

      {expanded && (
        <div className="batch-generation__content" id="batch-generation-content">
          <label className="batch-generation__template">
        <span>Template</span>
        <select
          disabled={busy || templates.length === 0}
          onChange={(event) => setTemplateId(event.target.value)}
          value={templateId}
        >
          {templates.length === 0 && (
            <option value="">No saved templates</option>
          )}
          {templates.map((template) => (
            <option key={template.templateId} value={template.templateId}>
              {template.name} · {template.format.toUpperCase()}
            </option>
          ))}
        </select>
          </label>

          <div className="batch-generation__brief">
        <h3>Shared generation brief</h3>
        <p>
          The same target role and project context will guide every candidate in
          this batch.
        </p>
        <GenerationBriefFields
          disabled={busy || batch?.status === "processing"}
          idPrefix="batch-brief"
          onChange={setBrief}
          value={brief}
        />
          </div>

          <div className="batch-generation__candidate-heading">
        <span>Candidates · {selectedCount}/10 selected</span>
        <button
          disabled={busy || !candidates.length}
          onClick={() =>
            setCandidateIds(
              candidates.slice(0, 10).map((item) => item.candidateLibraryId),
            )
          }
          type="button"
        >
          Select first 10
        </button>
        <button
          disabled={busy || !selectedCount}
          onClick={() => setCandidateIds([])}
          type="button"
        >
          Clear
        </button>
          </div>
          <div className="batch-generation__candidates">
        {candidates.length === 0 && (
          <p>No saved candidates. Import candidates first.</p>
        )}
        {candidates.map((candidate) => (
          <label key={candidate.candidateLibraryId}>
            <input
              checked={selectedSet.has(candidate.candidateLibraryId)}
              disabled={
                busy ||
                (!selectedSet.has(candidate.candidateLibraryId) &&
                  selectedCount >= 10)
              }
              onChange={() => toggleCandidate(candidate.candidateLibraryId)}
              type="checkbox"
            />
            <span>{candidate.name}</span>
            <small>{candidate.fileName}</small>
          </label>
        ))}
          </div>

          {batch && (
            <div className="batch-generation__result">
          <p>
            <strong>
              {batch.completed}/{batch.total}
            </strong>{" "}
            complete · {batch.approved} approved · {batch.reviewRequired} need
            review · {batch.failed} failed
          </p>
          <progress max={batch.total} value={batch.completed} />
          <div className="batch-generation__items">
            {batch.items.map((item) => (
              <article key={item.itemId}>
                <div>
                  <strong>{item.candidateName}</strong>
                  <small>{item.outputFileName}</small>
                </div>
                <span className={`batch-status batch-status--${item.status}`}>
                  {item.status.replace("_", " ")}
                </span>
                {item.status === "review_required" && item.qualityReview && (
                  <button onClick={() => setReviewItem(item)} type="button">
                    Review {item.qualityReview.issues.length} issue(s)
                  </button>
                )}
                {item.status === "failed" && batch.status !== "processing" && (
                  <button
                    disabled={busy}
                    onClick={() => retryItem(item.itemId)}
                    type="button"
                  >
                    Retry
                  </button>
                )}
                {item.error && <p role="alert">{item.error}</p>}
              </article>
            ))}
          </div>
            </div>
          )}
          {error && (
            <p className="document-action-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      {reviewItem?.qualityReview && (
        <CandidateQualityReviewDialog
          error={error}
          isApplying={busy}
          onCancel={() => setReviewItem(undefined)}
          onComplete={finishReview}
          report={reviewItem.qualityReview}
          submitLabel="Save decisions"
        />
      )}
    </section>
  );
}

function message(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}
