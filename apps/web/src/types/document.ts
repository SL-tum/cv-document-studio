export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonPrimitive | JsonValue[] | {
  [key: string]: JsonValue;
};

/**
 * Application-facing document data.
 *
 * Keeping this JSON-shaped and editor-agnostic prevents BlockNote's schema from
 * becoming the application's public document contract.
 */
export interface DocumentImportResult {
  document: JsonValue;
}

export interface DocumentExportResult {
  document: JsonValue;
}

export type TextAlignment = "left" | "center" | "right" | "justify";

export interface IntermediateTextStyles {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
}

export interface IntermediateTextRun {
  text: string;
  styles: IntermediateTextStyles;
}

export interface IntermediateDocumentBlock {
  type:
    | "paragraph"
    | "heading"
    | "bullet_list_item"
    | "numbered_list_item"
    | "table"
    | "image"
    | "page_break";
  level?: number;
  listLevel?: number;
  alignment: TextAlignment;
  content: IntermediateTextRun[];
  rows?: IntermediateTableRow[];
  assetId?: string;
  width?: number;
  height?: number;
  alt?: string | null;
  sectionId?: string | null;
  sectionType?: DocumentSectionType | null;
}

export interface IntermediateTableCell {
  blocks: IntermediateDocumentBlock[];
  colspan?: number;
  rowspan?: number;
}

export interface IntermediateTableRow {
  cells: IntermediateTableCell[];
}

export type DocumentSectionType =
  | "personal_information"
  | "summary"
  | "work_experience"
  | "education"
  | "skills"
  | "projects"
  | "certifications"
  | "languages"
  | "awards"
  | "interests"
  | "references"
  | "custom";

export interface DocumentSection {
  id: string;
  type: DocumentSectionType;
  title?: string | null;
  blocks: IntermediateDocumentBlock[];
}

export interface DocumentAsset {
  id: string;
  filename: string;
  mimeType: string;
  data: string;
}

export interface PageSettings {
  width: number;
  height: number;
  orientation: "portrait" | "landscape";
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

export interface DocumentMetadata {
  headers: IntermediateDocumentBlock[];
  footers: IntermediateDocumentBlock[];
  pageSettings?: PageSettings | null;
  assets: DocumentAsset[];
}

/**
 * Lightweight interchange format returned by document importers.
 *
 * This is deliberately smaller than a full rich document tree and contains no
 * editor-specific types.
 */
export interface IntermediateDocument extends DocumentMetadata {
  sections: DocumentSection[];
}
