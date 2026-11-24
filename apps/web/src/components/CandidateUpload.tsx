import { useRef, useState, type ChangeEvent } from "react";
import type { CandidateImportResult } from "@cv-document-studio/review-contracts";
import { importCandidateCv } from "../api/documents";

export interface CandidateUploadProps {
  onImported: (candidates: CandidateImportResult[]) => void;
}

export function CandidateUpload({ onImported }: CandidateUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setIsLoading(true);
    setError(undefined);
    try {
      const imported: CandidateImportResult[] = [];
      for (const file of files) imported.push(await importCandidateCv(file));
      onImported(imported);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The candidate CV could not be imported.",
      );
    } finally {
      setIsLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="document-action">
      <label className="document-action-button document-action-button--secondary">
        {isLoading ? "Extracting candidates…" : "Import Candidate CVs"}
        <input
          ref={inputRef}
          accept=".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          disabled={isLoading}
          multiple
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
