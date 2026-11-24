import { useState } from "react";

import type {
  CandidateQualityReviewResponse,
  CandidateReviewDecision,
} from "@cv-document-studio/review-contracts";

export interface CandidateQualityReviewDialogProps {
  report: CandidateQualityReviewResponse;
  isApplying: boolean;
  error?: string;
  onCancel: () => void;
  onComplete: (decisions: Record<string, CandidateReviewDecision>) => void;
  submitLabel?: string;
}

const issueLabels = {
  grammar: "Grammar",
  unsupported_fact: "Unsupported fact",
  contradiction: "Contradiction",
} as const;

export function CandidateQualityReviewDialog({
  report,
  isApplying,
  error,
  onCancel,
  onComplete,
  submitLabel = "Finish review & export",
}: CandidateQualityReviewDialogProps) {
  const [decisions, setDecisions] = useState<
    Record<string, CandidateReviewDecision>
  >({});
  const unresolved = report.issues.filter(
    (issue) => !decisions[issue.issueId],
  ).length;

  return (
    <div className="quality-review-backdrop" role="presentation">
      <section
        className="quality-review-dialog"
        aria-labelledby="quality-review-title"
        role="dialog"
        aria-modal="true"
      >
        <header className="quality-review-header">
          <div>
            <p className="eyebrow">Pre-export review</p>
            <h2 id="quality-review-title">
              Confirm every suggested correction
            </h2>
            <p>
              Candidate CV checked as ground truth · {report.checkedFields}{" "}
              blocks · {report.issues.length} issue(s)
            </p>
          </div>
          <button
            className="quality-review-close"
            disabled={isApplying}
            onClick={onCancel}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="quality-review-issues">
          {report.issues.map((issue, index) => (
            <article
              className={`quality-issue quality-issue--${issue.severity}`}
              key={issue.issueId}
            >
              <div className="quality-issue__meta">
                <span>
                  {index + 1}. {issue.fieldLabel}
                </span>
                <span>{issueLabels[issue.type]}</span>
              </div>
              <p className="quality-issue__explanation">{issue.explanation}</p>
              <div className="quality-issue__comparison">
                <div>
                  <h3>Current content</h3>
                  <mark>{issue.originalText}</mark>
                </div>
                <div>
                  <h3>Suggested replacement</h3>
                  <p className="quality-issue__suggestion">
                    {issue.suggestedText}
                  </p>
                </div>
              </div>
              {issue.evidence && (
                <p className="quality-issue__evidence">
                  <strong>Candidate evidence:</strong> {issue.evidence}
                </p>
              )}
              <div
                className="quality-issue__decisions"
                role="group"
                aria-label={`Decision for ${issue.fieldLabel}`}
              >
                <button
                  className={
                    decisions[issue.issueId] === "apply" ? "is-selected" : ""
                  }
                  disabled={isApplying}
                  onClick={() =>
                    setDecisions((value) => ({
                      ...value,
                      [issue.issueId]: "apply",
                    }))
                  }
                  type="button"
                >
                  Apply suggestion
                </button>
                <button
                  className={
                    decisions[issue.issueId] === "keep" ? "is-selected" : ""
                  }
                  disabled={isApplying}
                  onClick={() =>
                    setDecisions((value) => ({
                      ...value,
                      [issue.issueId]: "keep",
                    }))
                  }
                  type="button"
                >
                  Keep original
                </button>
              </div>
            </article>
          ))}
        </div>

        <footer className="quality-review-footer">
          <span className={error ? "quality-review-footer__error" : ""}>
            {error ??
              (unresolved
                ? `${unresolved} decision(s) remaining`
                : "All issues reviewed")}
          </span>
          <button
            className="document-action-button"
            disabled={isApplying || unresolved > 0}
            onClick={() => onComplete(decisions)}
            type="button"
          >
            {isApplying ? "Applying…" : submitLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
