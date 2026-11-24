import { useState } from "react";
import type {
  CandidateQualityReviewResponse,
  ReviewDocument,
} from "@cv-document-studio/review-contracts";
import {
  applyDocumentOperations,
  downloadReviewedDocument,
  previewDocumentOperations,
  reviewCandidateQuality,
  resolveCandidateQualityReview,
} from "../api/documents";
import { blocksToOperationEnvelope } from "../adapters/review/reviewDocumentAdapter";
import type { JsonValue } from "../types/document";
import { CandidateQualityReviewDialog } from "./CandidateQualityReviewDialog";

export interface DocumentExportProps {
  document: JsonValue;
  review?: ReviewDocument;
  onApplied: (review: ReviewDocument) => void;
  disabled?: boolean;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DocumentExport({ document, review, onApplied, disabled }: DocumentExportProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [report, setReport] = useState<CandidateQualityReviewResponse>();
  const [reviewedDocument, setReviewedDocument] = useState<ReviewDocument>();

  async function handleExport() {
    if (!review) return;
    setIsLoading(true);
    setError(undefined);
    try {
      const envelope = blocksToOperationEnvelope(document, review);
      let currentReview = review;
      if (envelope.operations.length) {
        const preview = await previewDocumentOperations(review.sessionId, envelope);
        if (!preview.valid) throw new Error(preview.errors.join("; "));
        currentReview = await applyDocumentOperations(review.sessionId, envelope);
        onApplied(currentReview);
      }
      const qualityReport = await reviewCandidateQuality(review.sessionId);
      if (!qualityReport.issues.length) {
        await exportDocument(currentReview);
        return;
      }
      setReviewedDocument(currentReview);
      setReport(qualityReport);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The document could not be exported.");
    } finally {
      setIsLoading(false);
    }
  }

  async function finishReview(decisions: Record<string, "apply" | "keep">) {
    if (!review || !report || !reviewedDocument) return;
    setIsLoading(true);
    setError(undefined);
    try {
      const resolution = await resolveCandidateQualityReview(review.sessionId, {
        reviewId: report.reviewId,
        decisions: report.issues.map((issue) => ({
          issueId: issue.issueId,
          decision: decisions[issue.issueId]!,
        })),
      });
      const currentReview = resolution.reviewDocument;
      onApplied(currentReview);
      await exportDocument(currentReview);
      setReport(undefined);
      setReviewedDocument(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Review corrections could not be applied.");
    } finally {
      setIsLoading(false);
    }
  }

  async function exportDocument(currentReview: ReviewDocument) {
    downloadBlob(
      await downloadReviewedDocument(currentReview.sessionId),
      `reviewed.${currentReview.format}`,
    );
  }

  return (<>
    <div className="document-action">
      <button
        className="document-action-button document-action-button--secondary"
        disabled={isLoading || !review || disabled}
        onClick={handleExport}
        type="button"
      >
        {isLoading ? "Validating…" : "Review & Export"}
      </button>
      {error && <p className="document-action-error" role="alert">{error}</p>}
    </div>
    {report && (
      <CandidateQualityReviewDialog
        error={error}
        isApplying={isLoading}
        onCancel={() => setReport(undefined)}
        onComplete={finishReview}
        report={report}
      />
    )}
  </>);
}
