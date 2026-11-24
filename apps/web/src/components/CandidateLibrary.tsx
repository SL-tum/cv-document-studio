import { useEffect, useState } from "react";

import type { CandidateImportResult, CandidateLibraryItem } from "@cv-document-studio/review-contracts";
import { createCandidateSession, deleteCandidate, listCandidates } from "../api/documents";

export interface CandidateLibraryProps {
  refreshKey: number;
  activeFileName?: string;
  onSelected: (candidate: CandidateImportResult) => void;
}

export function CandidateLibrary({ refreshKey, activeFileName, onSelected }: CandidateLibraryProps) {
  const [candidates, setCandidates] = useState<CandidateLibraryItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void listCandidates()
      .then((items) => {
        if (cancelled) return;
        setCandidates(items);
        setSelectedId((current) =>
          items.some((candidate) => candidate.candidateLibraryId === current)
            ? current
            : items[0]?.candidateLibraryId ?? "",
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Candidates could not be loaded.");
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  async function openSelected() {
    if (!selectedId) return;
    setBusy(true);
    setError(undefined);
    try {
      onSelected(await createCandidateSession(selectedId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The candidate could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selectedId) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteCandidate(selectedId);
      const remaining = candidates.filter((candidate) => candidate.candidateLibraryId !== selectedId);
      setCandidates(remaining);
      setSelectedId(remaining[0]?.candidateLibraryId ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The candidate could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="template-library" aria-label="Reusable candidates">
      <div>
        <p className="template-library__label">Candidate library</p>
        <p className="template-library__hint">
          {activeFileName ? `Active: ${activeFileName}` : "Choose a saved candidate CV."}
        </p>
      </div>
      <select
        aria-label="Saved candidate"
        disabled={busy || candidates.length === 0}
        onChange={(event) => setSelectedId(event.target.value)}
        value={selectedId}
      >
        {candidates.length === 0 && <option value="">No saved candidates</option>}
        {candidates.map((candidate) => (
          <option key={candidate.candidateLibraryId} value={candidate.candidateLibraryId}>
            {candidate.name} · {candidate.pageCount} page(s)
          </option>
        ))}
      </select>
      <button className="library-button" disabled={busy || !selectedId} onClick={openSelected} type="button">
        {busy ? "Working…" : "Use candidate"}
      </button>
      <button
        className="library-button library-button--danger"
        disabled={busy || !selectedId}
        onClick={removeSelected}
        type="button"
      >
        Delete
      </button>
      {error && <p className="template-library__error" role="alert">{error}</p>}
    </section>
  );
}
