const baseUrl = (process.env.OPM_URL || "http://localhost:3000").replace(/\/$/, "");
const email = process.env.OPM_SMOKE_EMAIL;
const password = process.env.OPM_SMOKE_PASSWORD;

if (!email || !password) {
  console.error("Set OPM_SMOKE_EMAIL and OPM_SMOKE_PASSWORD (a dedicated test account, never a real user's).");
  process.exit(2);
}

let failures = 0;

function check(condition: unknown, label: string, detail?: unknown) {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

async function call(path: string, init: RequestInit & { token?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.cookie) headers.Cookie = init.cookie;
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "manual" });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, body, text };
}

function field(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>(
    (current, key) => (current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined),
    value
  );
}

async function main() {
  console.log(`Smoke test against ${baseUrl}\n`);
  const marker = `Smoke ${new Date().toISOString()}`;

  const unauthenticated = await call("/api/v1/mcp/resources");
  check(unauthenticated.status === 401, "unauthenticated MCP resources are refused", unauthenticated.status);

  const login = await call("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  const token = field(login.body, "token");
  check(login.status === 200 && typeof token === "string", "password login returns a token", login.status);
  if (typeof token !== "string") return;

  const created = await call("/api/v1/projects", {
    method: "POST",
    token,
    body: JSON.stringify({ name: `E2E ${marker}` }),
  });
  check(created.status === 201, "create project", created.body);
  const projectId = field(created.body, "data", "id");
  if (typeof projectId !== "string") return;

  try {
    const project = await call(`/api/v1/projects/${projectId}`, { token });
    const columnId = field(project.body, "data", "columns", 0, "id");
    const visibility = field(project.body, "data", "visibility");
    check(visibility === "PRIVATE", "new project is PRIVATE", visibility);
    check(typeof columnId === "string", "project has a column", project.body);
    if (typeof columnId !== "string") return;

    const title = `Card ${marker}`;
    const card = await call("/api/v1/cards", {
      method: "POST",
      token,
      body: JSON.stringify({ projectId, columnId, title }),
    });
    const cardId = field(card.body, "data", "id");
    check(typeof cardId === "string", "create card", card.body);
    if (typeof cardId !== "string") return;

    const restRead = await call(`/api/v1/cards/${cardId}`, { token });
    check(field(restRead.body, "data", "title") === title, "card reads back over REST", restRead.body);

    const mcpRead = await call("/api/v1/mcp/tools", {
      method: "POST",
      token,
      body: JSON.stringify({ tool: "get_card", arguments: { id: cardId } }),
    });
    check(field(mcpRead.body, "card", "title") === title, "card reads back over MCP", mcpRead.body);

    const page = await call(`/projects/${projectId}`, { cookie: `opm_session=${token}` });
    check(page.status === 200 && page.text.includes(title), "project page renders the card", page.status);
  } finally {
    const deleted = await call(`/api/v1/projects/${projectId}`, { method: "DELETE", token });
    check(deleted.status === 200, "delete project", deleted.body);
    const gone = await call(`/api/v1/projects/${projectId}`, { token });
    check(gone.status === 404, "deleted project is gone", gone.status);
  }
}

main()
  .catch((error) => {
    failures++;
    console.error(error);
  })
  .finally(() => {
    console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
    process.exit(failures === 0 ? 0 : 1);
  });
