import type {
  Importer,
  ImportProject,
  ImportColumn,
  ImportCardType,
  ImportLabel,
  ImportCard,
  ImportComment,
} from "./types";

export interface VikunjaImporterConfig {
  /** e.g. "http://localhost:3456/api/v1" or "https://vikunja.example.com/api/v1" — trailing slash optional. */
  baseUrl: string;
  /** Vikunja API token (Bearer). Needs read scopes on projects, tasks, labels and comments. */
  token: string;
  /** Vikunja project ids to import. Empty means every project the token can see. */
  projectIds?: number[];
}

const PER_PAGE = 50;

/** Vikunja returns this sentinel instead of null for unset dates. */
function isUnsetDate(value: string | undefined | null): boolean {
  return !value || value.startsWith("0001-01-01");
}

/** Vikunja serialises unset ids (no done bucket, no bucket outside a view) as `0`. */
function setId(id: number | undefined | null): number | undefined {
  return id && id > 0 ? id : undefined;
}

/** Vikunja priority (0 unset … 5 DO NOW) → OPM priority enum. */
export function mapPriority(priority: number | undefined): string {
  switch (priority) {
    case 1:
      return "LOW";
    case 2:
      return "MEDIUM";
    case 3:
      return "HIGH";
    case 4:
    case 5:
      return "URGENT";
    default:
      return "NONE";
  }
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Vikunja stores descriptions and comments as HTML; OPM renders them as Markdown
 * (react-markdown). This covers the subset the board actually contains — prose,
 * lists, links, emphasis and code — and drops any other markup rather than
 * leaking raw tags into the card body.
 */
export function htmlToMarkdown(html: string | undefined | null): string {
  if (!html) return "";

  let out = html.replace(/\r\n/g, "\n");

  // Block-level code first, so its contents are not touched by the inline rules.
  out = out.replace(/<pre[^>]*>\s*(?:<code[^>]*>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>/gi, (_m, code) => `\n\n\`\`\`\n${code}\n\`\`\`\n\n`);
  out = out.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, code) => `\`${code}\``);

  out = out.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => `[${text}](${href})`);
  out = out.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_m, text) => `**${text}**`);
  out = out.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_m, text) => `*${text}*`);

  // Ordered lists get real numbers; unordered lists get dashes.
  out = out.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, body: string) => {
    let n = 0;
    return `\n${body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_li, item) => `${++n}. ${String(item).trim()}\n`)}\n`;
  });
  out = out.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, body: string) => `\n${body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_li, item) => `- ${String(item).trim()}\n`)}\n`);
  out = out.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, item) => `- ${String(item).trim()}\n`);

  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<\/p>/gi, "\n\n");
  out = out.replace(/<\/(?:div|h[1-6]|blockquote)>/gi, "\n\n");
  out = out.replace(/<[^>]+>/g, "");

  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    out = out.split(entity).join(char);
  }
  out = out.replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

interface VikunjaProject {
  id: number;
  title: string;
  description?: string;
  hex_color?: string;
}

interface VikunjaView {
  id: number;
  view_kind: string;
  default_bucket_id?: number;
  done_bucket_id?: number;
}

interface VikunjaBucket {
  id: number;
  title: string;
  position?: number;
  /** Total tasks in the bucket; `tasks` holds only the first page of them. */
  count?: number;
  tasks?: VikunjaTask[] | null;
}

interface VikunjaTask {
  id: number;
  index: number;
  title: string;
  description?: string;
  done?: boolean;
  done_at?: string;
  priority?: number;
  due_date?: string;
  percent_done?: number;
  bucket_id?: number;
  labels?: { id: number }[] | null;
  assignees?: { username?: string; name?: string }[] | null;
}

interface VikunjaComment {
  id: number;
  comment: string;
  created?: string;
  author?: { username?: string; name?: string };
}

interface BucketLayout {
  buckets: VikunjaBucket[];
  /** taskId → bucketId, from the kanban view. */
  taskBucket: Map<number, number>;
  bucketRank: Map<number, number>;
  defaultBucketId?: number;
  doneBucketId?: number;
}

export function projectSourceId(id: number): string {
  return `vikunja:project:${id}`;
}
export function bucketSourceId(id: number): string {
  return `vikunja:bucket:${id}`;
}
export function labelSourceId(id: number): string {
  return `vikunja:label:${id}`;
}
export function taskSourceId(id: number): string {
  return `vikunja:task:${id}`;
}
export function commentSourceId(id: number): string {
  return `vikunja:comment:${id}`;
}

function numericId(sourceId: string): number {
  return Number(sourceId.split(":").pop());
}

export class VikunjaImporter implements Importer {
  readonly name = "vikunja";

  private readonly baseUrl: string;
  private readonly token: string;
  private readonly projectIds?: number[];

  /** Per-project kanban layout, resolved once and shared by fetchColumns/fetchCards. */
  private layouts = new Map<number, BucketLayout>();

  constructor(config: VikunjaImporterConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.projectIds = config.projectIds?.length ? config.projectIds : undefined;
  }

  private async request<T>(path: string): Promise<{ body: T; totalPages?: number }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Vikunja GET ${path} failed: ${res.status} ${res.statusText}`);
    }
    const totalPages = Number.parseInt(res.headers.get("x-pagination-total-pages") ?? "", 10);
    return { body: (await res.json()) as T, totalPages: Number.isNaN(totalPages) ? undefined : totalPages };
  }

  private async get<T>(path: string): Promise<T> {
    return (await this.request<T>(path)).body;
  }

  /**
   * Walks Vikunja's `page=` pagination. The server silently caps `per_page` at its
   * `service.maxitemsperpage`, so a short page alone doesn't mean the end: the
   * `x-pagination-total-pages` header decides, with the short-page rule only as a fallback.
   */
  private async *paginate<T>(path: string): AsyncGenerator<T> {
    const separator = path.includes("?") ? "&" : "?";
    for (let page = 1; ; page++) {
      const { body, totalPages } = await this.request<T[] | null>(`${path}${separator}per_page=${PER_PAGE}&page=${page}`);
      const items = body || [];
      for (const item of items) yield item;
      if (totalPages !== undefined ? page >= totalPages : items.length < PER_PAGE) return;
    }
  }

  private async layoutFor(projectId: number): Promise<BucketLayout> {
    const cached = this.layouts.get(projectId);
    if (cached) return cached;

    const views = await this.get<VikunjaView[]>(`/projects/${projectId}/views`);
    const kanban = (views || []).find((v) => v.view_kind === "kanban");
    if (!kanban) {
      throw new Error(`Vikunja project ${projectId} has no kanban view — cannot map buckets to columns`);
    }

    // The kanban *view tasks* endpoint returns buckets each carrying their tasks,
    // which is the only place the bucket a task sits in is exposed reliably. Each
    // bucket carries only its first page; the rest come from the same endpoint
    // filtered to that bucket, which returns a flat, paginated task list.
    const viewTasksPath = `/projects/${projectId}/views/${kanban.id}/tasks`;
    const buckets = (await this.get<VikunjaBucket[] | null>(`${viewTasksPath}?per_page=${PER_PAGE}`)) || [];
    const taskBucket = new Map<number, number>();
    for (const bucket of buckets) {
      const firstPage = bucket.tasks || [];
      for (const task of firstPage) taskBucket.set(task.id, bucket.id);
      if (firstPage.length < (bucket.count ?? 0)) {
        const filter = encodeURIComponent(`bucket_id = ${bucket.id}`);
        for await (const task of this.paginate<VikunjaTask>(`${viewTasksPath}?filter=${filter}`)) {
          taskBucket.set(task.id, bucket.id);
        }
      }
    }

    const byPosition = [...buckets].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const layout: BucketLayout = {
      buckets,
      taskBucket,
      bucketRank: new Map(byPosition.map((bucket, rank) => [bucket.id, rank])),
      // Vikunja itself falls back to the leftmost bucket when no default is set.
      defaultBucketId: setId(kanban.default_bucket_id) ?? byPosition[0]?.id,
      doneBucketId: setId(kanban.done_bucket_id),
    };
    this.layouts.set(projectId, layout);
    return layout;
  }

  async *fetchProjects(): AsyncGenerator<ImportProject> {
    const seen = new Set<number>();
    for await (const project of this.paginate<VikunjaProject>(`/projects`)) {
      // Saved filters come back as pseudo-projects with negative ids, repeated on every page.
      if (project.id <= 0 || seen.has(project.id)) continue;
      seen.add(project.id);
      if (this.projectIds && !this.projectIds.includes(project.id)) continue;
      yield {
        sourceId: projectSourceId(project.id),
        name: project.title,
        description: htmlToMarkdown(project.description) || undefined,
        color: project.hex_color ? `#${project.hex_color.replace(/^#/, "")}` : undefined,
      };
    }
  }

  async *fetchColumns(projectSourceIdValue: string): AsyncGenerator<ImportColumn> {
    const layout = await this.layoutFor(numericId(projectSourceIdValue));
    for (const bucket of layout.buckets) {
      yield {
        sourceId: bucketSourceId(bucket.id),
        name: bucket.title,
        order: layout.bucketRank.get(bucket.id) ?? 0,
        isDone: bucket.id === layout.doneBucketId,
      };
    }
  }

  // Vikunja has no equivalent of OPM card types.
  async *fetchCardTypes(): AsyncGenerator<ImportCardType> {}

  async *fetchLabels(projectSourceIdValue: string): AsyncGenerator<ImportLabel> {
    const projectId = numericId(projectSourceIdValue);
    // Labels are instance-wide in Vikunja, so scope them to the labels actually
    // used by this project's tasks — otherwise every board's labels come along.
    const used = new Set<number>();
    for await (const task of this.paginate<VikunjaTask>(`/projects/${projectId}/tasks`)) {
      for (const label of task.labels || []) used.add(label.id);
    }
    if (used.size === 0) return;

    for await (const label of this.paginate<{ id: number; title: string; hex_color?: string }>(`/labels`)) {
      if (!used.has(label.id)) continue;
      yield {
        sourceId: labelSourceId(label.id),
        name: label.title,
        color: label.hex_color ? `#${label.hex_color.replace(/^#/, "")}` : undefined,
      };
    }
  }

  async *fetchCards(projectSourceIdValue: string): AsyncGenerator<ImportCard> {
    const projectId = numericId(projectSourceIdValue);
    const layout = await this.layoutFor(projectId);

    for await (const task of this.paginate<VikunjaTask>(`/projects/${projectId}/tasks`)) {
      // A done task lands in the done column when the view has one, wherever the kanban view left it.
      const bucketId =
        (task.done ? layout.doneBucketId : undefined) ??
        layout.taskBucket.get(task.id) ??
        setId(task.bucket_id) ??
        layout.defaultBucketId;

      const owner = task.assignees?.[0]?.username || task.assignees?.[0]?.name;
      const body = htmlToMarkdown(task.description);
      const description = [`> Imported from Vikunja #${task.index}`, body].filter(Boolean).join("\n\n");

      yield {
        sourceId: taskSourceId(task.id),
        columnSourceId: bucketSourceId(bucketId ?? -1),
        title: task.title,
        description,
        priority: mapPriority(task.priority),
        owner: owner || undefined,
        dueDate: isUnsetDate(task.due_date) ? undefined : task.due_date,
        completedAt: isUnsetDate(task.done_at) ? undefined : task.done_at,
        labelSourceIds: (task.labels || []).map((l) => labelSourceId(l.id)),
      };
    }
  }

  async *fetchComments(cardSourceId: string): AsyncGenerator<ImportComment> {
    const taskId = numericId(cardSourceId);
    for await (const comment of this.paginate<VikunjaComment>(`/tasks/${taskId}/comments`)) {
      yield {
        sourceId: commentSourceId(comment.id),
        author: comment.author?.username || comment.author?.name || "vikunja",
        content: htmlToMarkdown(comment.comment),
        createdAt: isUnsetDate(comment.created) ? undefined : comment.created,
      };
    }
  }
}
