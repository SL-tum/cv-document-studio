import { useRef, useState, type ChangeEvent } from "react";

import { importOfficeDocument } from "../api/documents";
import type { ReviewDocument } from "@cv-document-studio/review-contracts";

export interface TemplateUploadProps {
  onImported: (document: ReviewDocument) => void;
}

export function TemplateUpload({ onImported }: TemplateUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setError(undefined);

    try {
      onImported(await importOfficeDocument(file));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The document could not be imported.",
      );
    } finally {
      setIsLoading(false);
      // Allow the same file to be selected again after an error.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="document-action">
      <label className="document-action-button">
        {isLoading ? "Importing template…" : "Import Template"}
        <input
          ref={inputRef}
          accept=".docx,.pptx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          disabled={isLoading}
          onChange={handleFileChange}
          type="file"
        />
      </label>
      {error && (
        <p className="document-action-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
