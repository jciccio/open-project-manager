import { DEFAULT_CARD_TYPES } from "../cardTypeDefaults";
import { htmlToMarkdown } from "./htmlToMarkdown";
import type {
  Importer,
  ImportProject,
  ImportColumn,
  ImportCardType,
  ImportLabel,
  ImportCard,
  ImportCardLink,
  ImportCardRelation,
  ImportComment,
} from "./types";

export interface PlaneImporterConfig {
  /** Instance URL, e.g. "https://api.plane.so" or "https://plane.example.com". */
  baseUrl: string;
  apiKey: string;
  workspaceSlug: string;
  /** Project identifiers to import, e.g. ["ABC"]. Empty means every project the key can see. */
  projectIdentifiers?: string[];
  /** Max retries for 429/5xx and transient network errors (default: 5). */
  maxRetries?: number;
  /** Initial retry backoff delay in ms (default: 1000). */
  retryDelayMs?: number;
  /** Per-request timeout in ms, covering the response body (default: 30000). A timeout is retried. */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Leave out relations that cross projects. A dry run sets this, since it writes nothing for their targets to resolve against. */
  skipCrossProjectRelations?: boolean;
}

// Plane's docs cap per_page at 100, although CE accepts more.
const PER_PAGE = 100;
const MAX_WAIT_MS = 120_000;

interface PlanePage<T> {
  results?: T[];
  next_cursor?: string;
  next_page_results?: boolean;
}

interface PlaneProject {
  id: string;
  name: string;
  identifier: string;
  description?: string;
}

interface PlaneState {
  id: string;
  name: string;
  group: string;
  sequence: number;
  color?: string;
  description?: string;
}

interface PlaneLabel {
  id: string;
  name: string;
  color?: string;
}

interface PlaneWorkItem {
  id: string;
  name: string;
  description_html?: string;
  state: string;
  priority?: string;
  assignees?: string[];
  labels?: string[];
  estimate_point?: string | null;
  target_date?: string | null;
  completed_at?: string | null;
  created_at?: string;
  sequence_id?: number;
  parent?: string | null;
}

interface PlaneLink {
  url: string;
  title?: string | null;
}

interface PlaneRelationTarget {
  project_id: string;
  issue_id: string;
}

// Plane's start_before, start_after, finish_before and finish_after have no OPM equivalent.
const RELATION_TYPES: Record<string, ImportCardRelation["type"]> = {
  blocking: "BLOCKS",
  blocked_by: "BLOCKED_BY",
  relates_to: "RELATES_TO",
  duplicate: "RELATES_TO",
};

interface PlaneComment {
  id: string;
  comment_html?: string;
  actor?: string | null;
  created_by?: string | null;
  created_at?: string;
}

interface PlaneMember {
  id: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
}

interface PlaneEstimatePoint {
  id: string;
  value: string;
}

class PlaneApiError extends Error {
  constructor(
    path: string,
    readonly status: number,
    statusText: string
  ) {
    super(`Plane GET ${path} failed: ${status} ${statusText}`);
    this.name = "PlaneApiError";
  }
}

export function projectSourceId(id: string): string {
  return `plane:project:${id}`;
}
export function stateSourceId(id: string): string {
  return `plane:state:${id}`;
}
export function labelSourceId(id: string): string {
  return `plane:label:${id}`;
}
export function workItemSourceId(projectId: string, id: string): string {
  return `plane:item:${projectId}:${id}`;
}
export function cardTypeSourceId(projectId: string, name: string): string {
  return `plane:cardtype:${projectId}:${name}`;
}
export function commentSourceId(id: string): string {
  return `plane:comment:${id}`;
}

function projectIdOf(sourceId: string): string {
  return sourceId.slice(projectSourceId("").length);
}

export function mapPriority(priority: string | undefined): string {
  const upper = priority?.toUpperCase();
  return upper === "URGENT" || upper === "HIGH" || upper === "MEDIUM" || upper === "LOW" ? upper : "NONE";
}

function memberName(member: PlaneMember): string | undefined {
  return member.display_name || [member.first_name, member.last_name].filter(Boolean).join(" ") || undefined;
}

export class PlaneImporter implements Importer {
  readonly name: string;

  private readonly apiBase: string;
  private readonly apiKey: string;
  private readonly workspacePath: string;
  private readonly projectIdentifiers?: Set<string>;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  private rateLimitRemaining?: number;
  private rateLimitResetAtMs?: number;
  private members?: Promise<Map<string, string>>;
  private estimatePoints = new Map<string, Promise<Map<string, number>>>();
  private readonly skipCrossProjectRelations: boolean;
  private readonly projectsStarted = new Set<string>();
  private crossProjectRelationsSkippedCount = 0;

  constructor(config: PlaneImporterConfig) {
    const base = config.baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
    this.apiBase = `${base}/api/v1`;
    this.apiKey = config.apiKey;
    this.workspacePath = `/workspaces/${encodeURIComponent(config.workspaceSlug)}`;
    this.projectIdentifiers = config.projectIdentifiers?.length
      ? new Set(config.projectIdentifiers.map((identifier) => identifier.toUpperCase()))
      : undefined;
    this.maxRetries = config.maxRetries ?? 5;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.skipCrossProjectRelations = config.skipCrossProjectRelations ?? false;
    this.name = `plane:${new URL(base).host}/${config.workspaceSlug}`;
  }

  private recordRateLimit(res: Response) {
    const remaining = Number.parseInt(res.headers.get("x-ratelimit-remaining") ?? "", 10);
    const resetAtSec = Number.parseInt(res.headers.get("x-ratelimit-reset") ?? "", 10);
    this.rateLimitRemaining = Number.isNaN(remaining) ? undefined : remaining;
    this.rateLimitResetAtMs = Number.isNaN(resetAtSec) ? undefined : resetAtSec * 1000;
  }

  private async waitForRateLimitWindow() {
    if (this.rateLimitRemaining !== 0 || this.rateLimitResetAtMs === undefined) return;
    const wait = this.rateLimitResetAtMs - Date.now();
    this.rateLimitRemaining = undefined;
    if (wait > 0) await this.sleep(Math.min(wait, MAX_WAIT_MS));
  }

  private retryDelay(res: Response, attempt: number): number {
    const retryAfterSec = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    if (!Number.isNaN(retryAfterSec)) return Math.min(retryAfterSec * 1000, MAX_WAIT_MS);
    if (res.status === 429 && this.rateLimitResetAtMs !== undefined) {
      const untilReset = this.rateLimitResetAtMs - Date.now();
      if (untilReset > 0) return Math.min(untilReset, MAX_WAIT_MS);
    }
    return this.retryDelayMs * 2 ** attempt;
  }

  private async get<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.waitForRateLimitWindow();
      try {
        const res = await fetch(`${this.apiBase}${path}`, {
          headers: { "X-API-Key": this.apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        this.recordRateLimit(res);

        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < this.maxRetries) {
          this.rateLimitRemaining = undefined;
          await this.sleep(this.retryDelay(res, attempt));
          continue;
        }
        if (!res.ok) throw new PlaneApiError(path, res.status, res.statusText);
        return (await res.json()) as T;
      } catch (err) {
        if (err instanceof PlaneApiError) throw err;
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelayMs * 2 ** attempt);
          continue;
        }
        if (err instanceof Error && err.name === "TimeoutError") {
          throw new Error(`Plane GET ${path} timed out after ${this.timeoutMs}ms`);
        }
        throw err;
      }
    }
  }

  private async *paginate<T>(path: string, query = ""): AsyncGenerator<T> {
    let cursor = `${PER_PAGE}:0:0`;
    while (true) {
      const params = `per_page=${PER_PAGE}&cursor=${encodeURIComponent(cursor)}${query ? `&${query}` : ""}`;
      const page = await this.get<PlanePage<T>>(`${path}?${params}`);
      for (const item of page.results ?? []) yield item;
      if (!page.next_page_results || !page.next_cursor) return;
      cursor = page.next_cursor;
    }
  }

  private projectPath(projectId: string): string {
    return `${this.workspacePath}/projects/${projectId}`;
  }

  private memberNames(): Promise<Map<string, string>> {
    this.members ??= this.get<PlaneMember[]>(`${this.workspacePath}/members/`).then((members) => {
      const names = new Map<string, string>();
      for (const member of members) {
        const name = memberName(member);
        if (name) names.set(member.id, name);
      }
      return names;
    });
    return this.members;
  }

  private integerEstimatePoints(projectId: string): Promise<Map<string, number>> {
    let points = this.estimatePoints.get(projectId);
    if (!points) {
      points = this.loadIntegerEstimatePoints(projectId);
      this.estimatePoints.set(projectId, points);
    }
    return points;
  }

  private async loadIntegerEstimatePoints(projectId: string): Promise<Map<string, number>> {
    const values = new Map<string, number>();
    let estimate: { id: string };
    try {
      estimate = await this.get<{ id: string }>(`${this.projectPath(projectId)}/estimates/`);
    } catch (err) {
      // Plane answers 404 for a project with no estimate configured.
      if (err instanceof PlaneApiError && err.status === 404) return values;
      throw err;
    }
    const points = await this.get<PlaneEstimatePoint[]>(
      `${this.projectPath(projectId)}/estimates/${estimate.id}/estimate-points/`
    );
    for (const point of points) {
      const value = Number(point.value);
      if (point.value.trim() !== "" && Number.isInteger(value)) values.set(point.id, value);
    }
    return values;
  }

  get crossProjectRelationsSkipped(): number {
    return this.crossProjectRelationsSkippedCount;
  }

  private async fetchLinks(projectId: string, itemId: string): Promise<ImportCardLink[]> {
    const links: ImportCardLink[] = [];
    for await (const link of this.paginate<PlaneLink>(`${this.projectPath(projectId)}/work-items/${itemId}/links/`)) {
      links.push({ url: link.url, title: link.title || undefined });
    }
    return links;
  }

  private async fetchRelations(projectId: string, itemId: string): Promise<ImportCardRelation[]> {
    const grouped = await this.get<Record<string, PlaneRelationTarget[] | undefined>>(
      `${this.projectPath(projectId)}/work-items/${itemId}/relations/`
    );
    const relations: ImportCardRelation[] = [];
    for (const [planeType, type] of Object.entries(RELATION_TYPES)) {
      for (const target of grouped[planeType] ?? []) {
        if (target.project_id !== projectId) {
          // Plane returns a relation from both sides, so a target in a project that
          // hasn't run yet still gets linked when that project's card reports its side.
          if (this.skipCrossProjectRelations) this.crossProjectRelationsSkippedCount++;
          if (this.skipCrossProjectRelations || !this.projectsStarted.has(target.project_id)) continue;
        }
        relations.push({ targetCardSourceId: workItemSourceId(target.project_id, target.issue_id), type });
      }
    }
    return relations;
  }

  async *fetchProjects(): AsyncGenerator<ImportProject> {
    for await (const project of this.paginate<PlaneProject>(`${this.workspacePath}/projects/`)) {
      if (this.projectIdentifiers && !this.projectIdentifiers.has(project.identifier.toUpperCase())) continue;
      yield {
        sourceId: projectSourceId(project.id),
        name: project.name,
        description: project.description || undefined,
        key: project.identifier,
      };
    }
  }

  async *fetchColumns(projectSourceIdValue: string): AsyncGenerator<ImportColumn> {
    const states: PlaneState[] = [];
    const path = `${this.projectPath(projectIdOf(projectSourceIdValue))}/states/`;
    for await (const state of this.paginate<PlaneState>(path)) states.push(state);
    states.sort((a, b) => a.sequence - b.sequence);

    for (const [rank, state] of states.entries()) {
      yield {
        sourceId: stateSourceId(state.id),
        name: state.name,
        order: rank,
        isDone: state.group === "completed",
        group: state.group.toUpperCase(),
        color: state.color || undefined,
        description: state.description || undefined,
      };
    }
  }

  // Plane's public API has no card type route, so imported projects get OPM's defaults.
  async *fetchCardTypes(projectSourceIdValue: string): AsyncGenerator<ImportCardType> {
    const projectId = projectIdOf(projectSourceIdValue);
    for (const type of DEFAULT_CARD_TYPES) {
      yield { sourceId: cardTypeSourceId(projectId, type.name), ...type };
    }
  }

  async *fetchLabels(projectSourceIdValue: string): AsyncGenerator<ImportLabel> {
    const path = `${this.projectPath(projectIdOf(projectSourceIdValue))}/labels/`;
    for await (const label of this.paginate<PlaneLabel>(path)) {
      yield { sourceId: labelSourceId(label.id), name: label.name, color: label.color || undefined };
    }
  }

  async *fetchCards(projectSourceIdValue: string): AsyncGenerator<ImportCard> {
    const projectId = projectIdOf(projectSourceIdValue);
    this.projectsStarted.add(projectId);
    const names = await this.memberNames();
    const points = await this.integerEstimatePoints(projectId);

    for await (const item of this.paginate<PlaneWorkItem>(`${this.projectPath(projectId)}/work-items/`)) {
      const assignees = (item.assignees ?? []).map((id) => names.get(id)).filter(Boolean);
      const links = await this.fetchLinks(projectId, item.id);
      const relations = await this.fetchRelations(projectId, item.id);
      yield {
        sourceId: workItemSourceId(projectId, item.id),
        columnSourceId: stateSourceId(item.state),
        title: item.name,
        description: htmlToMarkdown(item.description_html) || undefined,
        number: item.sequence_id,
        priority: mapPriority(item.priority),
        points: item.estimate_point ? points.get(item.estimate_point) : undefined,
        owner: assignees.join(", ") || undefined,
        dueDate: item.target_date || undefined,
        completedAt: item.completed_at || undefined,
        createdAt: item.created_at,
        parentSourceId: item.parent ? workItemSourceId(projectId, item.parent) : undefined,
        labelSourceIds: (item.labels ?? []).map(labelSourceId),
        links: links.length > 0 ? links : undefined,
        relations: relations.length > 0 ? relations : undefined,
      };
    }
  }

  async *fetchComments(cardSourceId: string): AsyncGenerator<ImportComment> {
    const [, , projectId, itemId] = cardSourceId.split(":");
    const names = await this.memberNames();
    const path = `${this.projectPath(projectId)}/work-items/${itemId}/comments/`;
    for await (const comment of this.paginate<PlaneComment>(path, "order_by=created_at")) {
      const authorId = comment.actor ?? comment.created_by;
      yield {
        sourceId: commentSourceId(comment.id),
        author: (authorId && names.get(authorId)) || "plane",
        content: htmlToMarkdown(comment.comment_html),
        createdAt: comment.created_at,
      };
    }
  }
}
