import { useState } from "react";

import type {
  ReviewDocument,
  TemplateExtractionReviewAction,
  TemplateExtractionReviewItem,
} from "@cv-document-studio/review-contracts";
import { resolveTemplateExtractionReview } from "../api/documents";

interface TemplateExtractionReviewProps {
  review: ReviewDocument;
  onResolved: (review: ReviewDocument) => void;
}

export function TemplateExtractionReview({
  review,
  onResolved,
}: TemplateExtractionReviewProps) {
  const items = review.templateExtractionReview ?? [];
  const [busyTarget, setBusyTarget] = useState<string>();
  const [error, setError] = useState<string>();
  if (!items.length) return null;

  async function resolve(
    item: TemplateExtractionReviewItem,
    action: TemplateExtractionReviewAction,
  ) {
    setBusyTarget(item.targetId);
    setError(undefined);
    try {
      onResolved(
        await resolveTemplateExtractionReview(review.sessionId, {
          decisions: [{ targetId: item.targetId, action }],
        }),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The template-field decision could not be applied.",
      );
    } finally {
      setBusyTarget(undefined);
    }
  }

  return (
    <section className="template-extraction-review" aria-label="Template field review">
      <header>
        <div>
          <p className="eyebrow">Template review required</p>
          <h3>Confirm ambiguous template fields</h3>
          <p>
            Accept fields that should be generated from the candidate CV. Fixed and ignored fields
            are excluded from Mapping.
          </p>
        </div>
        <span className="template-extraction-review__count">{items.length} pending</span>
      </header>
      {items.map((item) => (
        <article className="template-extraction-review__item" key={item.targetId}>
          <div>
            <strong>{item.label}</strong>
            <span>
              {item.fieldType} · confidence {(item.confidence * 100).toFixed(0)}%
              {item.slideIndex !== undefined ? ` · slide ${item.slideIndex + 1}` : ""}
            </span>
            {item.sourceText && <pre>{item.sourceText}</pre>}
            <p>{item.explanation}</p>
          </div>
          <div className="template-extraction-review__actions">
            <button
              disabled={Boolean(busyTarget)}
              onClick={() => void resolve(item, "accept")}
              type="button"
            >
              Accept field
            </button>
            <button
              disabled={Boolean(busyTarget)}
              onClick={() => void resolve(item, "fixed")}
              type="button"
            >
              Mark fixed
            </button>
            <button
              disabled={Boolean(busyTarget)}
              onClick={() => void resolve(item, "ignore")}
              type="button"
            >
              Ignore
            </button>
          </div>
        </article>
      ))}
      {error && <p className="document-action-error">{error}</p>}
    </section>
  );
}
