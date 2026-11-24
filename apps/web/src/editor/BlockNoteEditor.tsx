import { useMemo, useState, type KeyboardEvent } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import {
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  useComponentsContext,
  useCreateBlockNote,
} from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import {
  blockNoteSchema,
  exportDocument,
  importDocument,
} from "../adapters/blocknote/blocknoteAdapter";
import type {
  DocumentExportResult,
  JsonValue,
} from "../types/document";

export interface BlockNoteEditorProps {
  initialDocument?: JsonValue;
  onDocumentChange?: (result: DocumentExportResult) => void;
}

export function BlockNoteEditor({
  initialDocument,
  onDocumentChange,
}: BlockNoteEditorProps) {
  const importedDocument = useMemo(
    () => importDocument(initialDocument).document,
    [initialDocument],
  );

  const editor = useCreateBlockNote(
    {
      // This is the sole UI boundary where application JSON enters BlockNote.
      // All parsing and serialization still flow through the adapter.
      initialContent: importedDocument as never,
      schema: blockNoteSchema,
    },
    [importedDocument],
  );
  const [activeBlockType, setActiveBlockType] = useState<string>();
  const inTable = activeBlockType === "table";

  function refreshActiveBlockType() {
    try {
      setActiveBlockType(editor.getTextCursorPosition().block.type);
    } catch {
      setActiveBlockType(undefined);
    }
  }

  function setListType(type: "bulletListItem" | "numberedListItem") {
    const block = editor.getTextCursorPosition().block;
    if (block.type === "table") return;
    editor.updateBlock(block, { type } as never);
    setActiveBlockType(type);
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
      return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest("td, th")) return;
    event.preventDefault();
    editor.insertInlineContent("\n", { updateSelection: true });
  }

  const CustomFormattingToolbar = () => {
    const Components = useComponentsContext()!;
    const listTooltip = inTable
      ? "Structured lists are not available inside table cells."
      : undefined;
    return (
      <FormattingToolbar>
        {getFormattingToolbarItems()}
        <Components.FormattingToolbar.Button
          className="bn-button"
          icon={<span aria-hidden="true">•</span>}
          isDisabled={inTable}
          isSelected={activeBlockType === "bulletListItem"}
          label="Bulleted list"
          mainTooltip={listTooltip ?? "Convert the selected block to a bulleted list"}
          onClick={() => setListType("bulletListItem")}
        />
        <Components.FormattingToolbar.Button
          className="bn-button"
          icon={<span aria-hidden="true">1.</span>}
          isDisabled={inTable}
          isSelected={activeBlockType === "numberedListItem"}
          label="Numbered list"
          mainTooltip={listTooltip ?? "Convert the selected block to a numbered list"}
          onClick={() => setListType("numberedListItem")}
        />
      </FormattingToolbar>
    );
  };

  return (
    <BlockNoteView
      editable
      editor={editor}
      formattingToolbar={false}
      onChange={() => onDocumentChange?.(exportDocument(editor.document))}
      onKeyDownCapture={handleEditorKeyDown}
      onSelectionChange={refreshActiveBlockType}
      theme="light"
    >
      <FormattingToolbarController formattingToolbar={CustomFormattingToolbar} />
    </BlockNoteView>
  );
}
