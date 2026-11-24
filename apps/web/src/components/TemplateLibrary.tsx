import { useEffect, useState } from "react";

import type { ReviewDocument, TemplateLibraryItem } from "@cv-document-studio/review-contracts";
import { createTemplateSession, deleteTemplate, listTemplates } from "../api/documents";

export interface TemplateLibraryProps {
  refreshKey: number;
  activeFileName?: string;
  onSelected: (document: ReviewDocument) => void;
}

export function TemplateLibrary({ refreshKey, activeFileName, onSelected }: TemplateLibraryProps) {
  const [templates, setTemplates] = useState<TemplateLibraryItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void listTemplates()
      .then((items) => {
        if (cancelled) return;
        setTemplates(items);
        setSelectedId((current) =>
          items.some((template) => template.templateId === current)
            ? current
            : items[0]?.templateId ?? "",
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Templates could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function openSelected() {
    if (!selectedId) return;
    setBusy(true);
    setError(undefined);
    try {
      onSelected(await createTemplateSession(selectedId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The template could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selectedId) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteTemplate(selectedId);
      const remaining = templates.filter((template) => template.templateId !== selectedId);
      setTemplates(remaining);
      setSelectedId(remaining[0]?.templateId ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The template could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="template-library" aria-label="Reusable templates">
      <div>
        <p className="template-library__label">Template library</p>
        <p className="template-library__hint">
          {activeFileName ? `Active: ${activeFileName}` : "Choose a saved master template."}
        </p>
      </div>
      <select
        aria-label="Saved template"
        disabled={busy || templates.length === 0}
        onChange={(event) => setSelectedId(event.target.value)}
        value={selectedId}
      >
        {templates.length === 0 && <option value="">No saved templates</option>}
        {templates.map((template) => (
          <option key={template.templateId} value={template.templateId}>
            {template.name} · {template.format.toUpperCase()}
          </option>
        ))}
      </select>
      <button className="library-button" disabled={busy || !selectedId} onClick={openSelected} type="button">
        {busy ? "Working…" : "Use template"}
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
