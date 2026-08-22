export interface ImportProject {
  sourceId: string;
  name: string;
  description?: string;
  color?: string;
  key?: string;
}

export interface ImportColumn {
  sourceId: string;
  name: string;
  order?: number;
  isDone?: boolean;
}

export interface ImportCardType {
  sourceId: string;
  name: string;
  icon?: string;
  color?: string;
}

export interface ImportLabel {
  sourceId: string;
  name: string;
  color?: string;
}

export interface ImportCard {
  sourceId: string;
  columnSourceId: string;
  title: string;
  description?: string;
  priority?: string;
  points?: number;
  owner?: string;
  dueDate?: string;
  typeSourceId?: string;
  labelSourceIds?: string[];
}

export interface ImportComment {
  sourceId: string;
  author: string;
  content: string;
  createdAt?: string;
}

export interface Importer {
  /** Adapter name, e.g. "plane" — used as ImportRecord.source. */
  name: string;
  fetchProjects(): AsyncGenerator<ImportProject>;
  fetchColumns(projectSourceId: string): AsyncGenerator<ImportColumn>;
  fetchCardTypes(projectSourceId: string): AsyncGenerator<ImportCardType>;
  fetchLabels(projectSourceId: string): AsyncGenerator<ImportLabel>;
  fetchCards(projectSourceId: string): AsyncGenerator<ImportCard>;
  fetchComments(cardSourceId: string): AsyncGenerator<ImportComment>;
}

export type ImportEntityType = "project" | "column" | "cardType" | "label" | "card" | "comment";

export interface ImportRecordResult {
  entityType: ImportEntityType;
  sourceId: string;
  status: "created" | "skipped" | "failed";
  localId?: string;
  error?: string;
}

export interface ImportDryRunRecordResult {
  entityType: ImportEntityType;
  sourceId: string;
  status: "would_create" | "would_skip";
}

export interface ImportSummary {
  mode: "live";
  importRunId: string;
  totals: { created: number; skipped: number; failed: number };
  records: ImportRecordResult[];
}

export interface ImportDryRunSummary {
  mode: "dry-run";
  importRunId: string;
  totals: { wouldCreate: number; wouldSkip: number };
  records: ImportDryRunRecordResult[];
}

export interface RunImportOptions {
  dryRun?: boolean;
}
