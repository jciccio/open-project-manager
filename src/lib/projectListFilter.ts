import type { ProjectStats } from "@/lib/services/projectStats";

export const PROJECT_ROLE_FILTERS = ["all", "owned", "shared"] as const;
export const PROJECT_VISIBILITY_FILTERS = ["all", "PRIVATE", "INTERNAL"] as const;
export const PROJECT_SORTS = [
  "newest",
  "oldest",
  "nameAsc",
  "nameDesc",
  "mostOpen",
  "mostOverdue",
  "completion",
] as const;

export type ProjectRoleFilter = (typeof PROJECT_ROLE_FILTERS)[number];
export type ProjectVisibilityFilter = (typeof PROJECT_VISIBILITY_FILTERS)[number];
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export interface ProjectListQuery {
  search: string;
  role: ProjectRoleFilter;
  visibility: ProjectVisibilityFilter;
  sort: ProjectSort;
}

export const DEFAULT_PROJECT_LIST_QUERY: ProjectListQuery = {
  search: "",
  role: "all",
  visibility: "all",
  sort: "newest",
};

export interface ListableProject {
  id: string;
  userId?: string;
  name: string;
  key?: string;
  description: string | null;
  visibility?: string;
  members?: Array<{ userId: string; role: string }>;
  createdAt: Date | string;
}

type SearchParams = { [key: string]: string | string[] | undefined };

function pick<T extends string>(allowed: readonly T[], raw: string | string[] | undefined, fallback: T): T {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseProjectListQuery(params: SearchParams): ProjectListQuery {
  const search = Array.isArray(params.q) ? params.q[0] : params.q;
  return {
    search: search ?? "",
    role: pick(PROJECT_ROLE_FILTERS, params.role, DEFAULT_PROJECT_LIST_QUERY.role),
    visibility: pick(PROJECT_VISIBILITY_FILTERS, params.visibility, DEFAULT_PROJECT_LIST_QUERY.visibility),
    sort: pick(PROJECT_SORTS, params.sort, DEFAULT_PROJECT_LIST_QUERY.sort),
  };
}

export function projectListQueryString(query: ProjectListQuery, existing = ""): string {
  const params = new URLSearchParams(existing);
  const entries: Array<[string, string, string]> = [
    ["q", query.search.trim() ? query.search : "", DEFAULT_PROJECT_LIST_QUERY.search],
    ["role", query.role, DEFAULT_PROJECT_LIST_QUERY.role],
    ["visibility", query.visibility, DEFAULT_PROJECT_LIST_QUERY.visibility],
    ["sort", query.sort, DEFAULT_PROJECT_LIST_QUERY.sort],
  ];
  for (const [name, value, fallback] of entries) {
    if (value === fallback) params.delete(name);
    else params.set(name, value);
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export function isProjectListFiltered(query: ProjectListQuery): boolean {
  return (
    query.search.trim() !== "" ||
    query.role !== DEFAULT_PROJECT_LIST_QUERY.role ||
    query.visibility !== DEFAULT_PROJECT_LIST_QUERY.visibility
  );
}

function ownsProject(project: ListableProject, userId: string | undefined): boolean {
  const membership = project.members?.find((m) => m.userId === userId);
  const role = membership?.role ?? (userId && project.userId === userId ? "OWNER" : null);
  return role === "OWNER";
}

export function filterProjects<P extends ListableProject>(
  projects: P[],
  query: ProjectListQuery,
  userId: string | undefined
): P[] {
  const needle = query.search.trim().toLocaleLowerCase();
  return projects.filter((project) => {
    if (needle) {
      const haystack = [project.name, project.key, project.description]
        .filter(Boolean)
        .join("\n")
        .toLocaleLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (query.role === "owned" && !ownsProject(project, userId)) return false;
    if (query.role === "shared" && ownsProject(project, userId)) return false;
    if (query.visibility !== "all" && (project.visibility ?? "PRIVATE") !== query.visibility) return false;
    return true;
  });
}

export function sortProjects<P extends ListableProject>(
  projects: P[],
  sort: ProjectSort,
  stats: Record<string, ProjectStats> | undefined,
  locale: string
): P[] {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  const byName = (a: P, b: P) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id);
  const created = (p: P) => new Date(p.createdAt).getTime();
  const descendingBy = (value: (p: P) => number) => (a: P, b: P) => value(b) - value(a) || byName(a, b);

  const comparators: Record<ProjectSort, (a: P, b: P) => number> = {
    newest: descendingBy(created),
    oldest: (a, b) => created(a) - created(b) || byName(a, b),
    nameAsc: byName,
    nameDesc: (a, b) => byName(b, a),
    mostOpen: descendingBy((p) => stats?.[p.id]?.open ?? 0),
    mostOverdue: descendingBy((p) => stats?.[p.id]?.overdue ?? 0),
    completion: descendingBy((p) => stats?.[p.id]?.percentComplete ?? -1),
  };

  return [...projects].sort(comparators[sort]);
}
