import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROJECT_LIST_QUERY,
  filterProjects,
  isProjectListFiltered,
  parseProjectListQuery,
  projectListQueryString,
  sortProjects,
  type ListableProject,
  type ProjectListQuery,
} from "../projectListFilter";
import type { ProjectStats } from "../services/projectStats";

const ME = "user-me";

function project(id: string, overrides: Partial<ListableProject> = {}): ListableProject {
  return {
    id,
    userId: ME,
    name: `Project ${id}`,
    key: id.toUpperCase(),
    description: null,
    visibility: "PRIVATE",
    members: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function stats(overrides: Partial<ProjectStats>): ProjectStats {
  return { total: 0, done: 0, open: 0, overdue: 0, archived: 0, percentComplete: null, ...overrides };
}

const query = (overrides: Partial<ProjectListQuery>): ProjectListQuery => ({
  ...DEFAULT_PROJECT_LIST_QUERY,
  ...overrides,
});

const ids = (projects: ListableProject[]) => projects.map((p) => p.id);

describe("parseProjectListQuery", () => {
  it("reads valid values and falls back to defaults for unknown ones", () => {
    expect(parseProjectListQuery({ q: "web", role: "shared", visibility: "INTERNAL", sort: "nameDesc" })).toEqual({
      search: "web",
      role: "shared",
      visibility: "INTERNAL",
      sort: "nameDesc",
    });
    expect(parseProjectListQuery({ role: "admin", visibility: "public", sort: "random" })).toEqual(
      DEFAULT_PROJECT_LIST_QUERY
    );
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseProjectListQuery({ sort: ["oldest", "nameAsc"] }).sort).toBe("oldest");
  });
});

describe("projectListQueryString", () => {
  it("omits defaults so the plain dashboard URL stays clean", () => {
    expect(projectListQueryString(DEFAULT_PROJECT_LIST_QUERY)).toBe("");
  });

  it("round-trips non-default values and keeps unrelated parameters", () => {
    const value = query({ search: "api ", role: "owned", sort: "mostOverdue" });
    const serialized = projectListQueryString(value, "?sso_link=ok&sort=oldest");
    expect(serialized).toBe("?sso_link=ok&sort=mostOverdue&q=api+&role=owned");
    expect(parseProjectListQuery(Object.fromEntries(new URLSearchParams(serialized)))).toEqual(value);
  });

  it("drops a whitespace-only search", () => {
    expect(projectListQueryString(query({ search: "   " }), "?q=old")).toBe("");
  });
});

describe("isProjectListFiltered", () => {
  it("ignores sort and whitespace-only search", () => {
    expect(isProjectListFiltered(query({ sort: "nameAsc", search: "  " }))).toBe(false);
    expect(isProjectListFiltered(query({ visibility: "PRIVATE" }))).toBe(true);
  });
});

describe("filterProjects", () => {
  const projects = [
    project("alpha", { name: "Website Redesign", description: "Marketing site" }),
    project("beta", { name: "Mobile App", key: "MOB", visibility: "INTERNAL" }),
    project("gamma", {
      name: "Shared Board",
      userId: "someone-else",
      members: [{ userId: ME, role: "MEMBER" }],
    }),
    project("delta", {
      name: "Co-owned",
      userId: "someone-else",
      members: [{ userId: ME, role: "OWNER" }],
    }),
  ];

  it("matches the search against name, key and description, ignoring case", () => {
    expect(ids(filterProjects(projects, query({ search: "website" }), ME))).toEqual(["alpha"]);
    expect(ids(filterProjects(projects, query({ search: "mob" }), ME))).toEqual(["beta"]);
    expect(ids(filterProjects(projects, query({ search: "MARKETING" }), ME))).toEqual(["alpha"]);
  });

  it("splits owned from shared by the caller's role", () => {
    expect(ids(filterProjects(projects, query({ role: "owned" }), ME))).toEqual(["alpha", "beta", "delta"]);
    expect(ids(filterProjects(projects, query({ role: "shared" }), ME))).toEqual(["gamma"]);
  });

  it("filters by visibility and combines with the other filters", () => {
    expect(ids(filterProjects(projects, query({ visibility: "INTERNAL" }), ME))).toEqual(["beta"]);
    expect(ids(filterProjects(projects, query({ visibility: "PRIVATE", role: "shared" }), ME))).toEqual(["gamma"]);
    expect(filterProjects(projects, query({ visibility: "INTERNAL", search: "website" }), ME)).toEqual([]);
  });
});

describe("sortProjects", () => {
  const projects = [
    project("a", { name: "beta", createdAt: new Date("2026-03-01") }),
    project("b", { name: "Alpha", createdAt: new Date("2026-01-01") }),
    project("c", { name: "gamma", createdAt: new Date("2026-02-01") }),
    project("d", { name: "delta", createdAt: new Date("2026-02-01") }),
  ];
  const projectStats: Record<string, ProjectStats> = {
    a: stats({ open: 2, overdue: 0, percentComplete: 50 }),
    b: stats({ open: 5, overdue: 1, percentComplete: null }),
    c: stats({ open: 2, overdue: 3, percentComplete: 90 }),
    d: stats({ open: 0, overdue: 0, percentComplete: 0 }),
  };
  const sorted = (sort: ProjectListQuery["sort"]) => ids(sortProjects(projects, sort, projectStats, "en"));

  it("orders by creation date with name as the tiebreak", () => {
    expect(sorted("newest")).toEqual(["a", "d", "c", "b"]);
    expect(sorted("oldest")).toEqual(["b", "d", "c", "a"]);
  });

  it("orders by name without regard to case", () => {
    expect(sorted("nameAsc")).toEqual(["b", "a", "d", "c"]);
    expect(sorted("nameDesc")).toEqual(["c", "d", "a", "b"]);
  });

  it("orders by open and overdue counts, highest first", () => {
    expect(sorted("mostOpen")).toEqual(["b", "a", "c", "d"]);
    expect(sorted("mostOverdue")).toEqual(["c", "b", "a", "d"]);
  });

  it("puts projects without a completion percent after 0%", () => {
    expect(sorted("completion")).toEqual(["c", "a", "d", "b"]);
  });

  it("does not mutate the input", () => {
    const before = ids(projects);
    sortProjects(projects, "nameAsc", projectStats, "en");
    expect(ids(projects)).toEqual(before);
  });
});
