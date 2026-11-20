import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LanguageProvider } from "../LanguageProvider";
import { ThemeProvider } from "../ThemeProvider";
import ProjectMembersModal from "../ProjectMembersModal";
import WebhookManagerModal from "../WebhookManagerModal";
import LabelManagerModal from "../LabelManagerModal";
import ProjectCard from "../ProjectCard";
import BurndownChart from "../views/analytics/BurndownChart";
import CumulativeFlowChart from "../views/analytics/CumulativeFlowChart";
import AnalyticsTimeFilter from "../views/analytics/AnalyticsTimeFilter";

const mocks = vi.hoisted(() => ({
  getProjectMembers: vi.fn(),
  addProjectMember: vi.fn(),
  updateMemberRole: vi.fn(),
  removeProjectMember: vi.fn(),
  updateProject: vi.fn(),
  listWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  getLabels: vi.fn(),
}));

vi.mock("@/actions/members", () => ({
  getProjectMembers: mocks.getProjectMembers,
  addProjectMember: mocks.addProjectMember,
  updateMemberRole: mocks.updateMemberRole,
  removeProjectMember: mocks.removeProjectMember,
}));
vi.mock("@/actions/projects", () => ({
  updateProject: mocks.updateProject,
  deleteProject: vi.fn(),
  archiveProject: vi.fn(),
  unarchiveProject: vi.fn(),
}));
vi.mock("@/actions/webhooks", () => ({
  listWebhooks: mocks.listWebhooks,
  createWebhook: mocks.createWebhook,
  updateWebhook: mocks.updateWebhook,
  deleteWebhook: mocks.deleteWebhook,
}));
vi.mock("@/actions/labels", () => ({
  getLabels: mocks.getLabels,
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
  updateLabel: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, { width: 800, height: 300 })
        : null,
  };
});

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function renderEs(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <LanguageProvider initialLocale="es">{ui}</LanguageProvider>
    </ThemeProvider>
  );
}

function expectNoneOf(texts: string[]) {
  for (const text of texts) expect(screen.queryByText(text, { exact: false })).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProjectMembersModal in Spanish", () => {
  const owner = { id: "m1", userId: "u-owner", role: "OWNER", user: { name: "Olivia Owner", email: "olivia@example.com" } };
  const member = { id: "m2", userId: "u-member", role: "MEMBER", user: { name: null, email: "mia@example.com" } };
  const project = (currentUserRole: string) => ({ id: "p1", name: "Apollo", userId: "u-owner", visibility: "PRIVATE", currentUserRole });

  async function renderMembers(currentUserRole: string) {
    mocks.getProjectMembers.mockResolvedValue({ success: true, data: [owner, member], currentUserRole });
    renderEs(<ProjectMembersModal project={project(currentUserRole)} onClose={vi.fn()} />);
    await screen.findByText("mia@example.com");
  }

  it("shows the headings, visibility options, invite form, member list and controls in Spanish", async () => {
    await renderMembers("OWNER");

    expect(screen.getByRole("heading", { name: "Miembros y Privacidad" })).toBeInTheDocument();
    expect(screen.getByText("Privacidad y Visibilidad del Proyecto")).toBeInTheDocument();
    expect(screen.getByText("Solo los miembros añadidos explícitamente pueden acceder a este proyecto.")).toBeInTheDocument();
    expect(screen.getByText("Todos los usuarios autenticados en esta instancia pueden ver este proyecto.")).toBeInTheDocument();
    expect(screen.getByText("Invitar Colaborador")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Lector (Solo lectura)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Propietario (Control total)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir" })).toBeInTheDocument();
    expect(screen.getByText("Miembros del Proyecto (2)")).toBeInTheDocument();
    expect(screen.getByText("(Creador)")).toBeInTheDocument();
    expect(screen.getByText("Miembro", { selector: "p" })).toBeInTheDocument();
    const memberRow = screen.getByText("mia@example.com").closest(".justify-between") as HTMLElement;
    expect(within(memberRow).getByRole("option", { name: "Administrador" })).toBeInTheDocument();
    expect(within(memberRow).getByTitle("Quitar miembro")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cerrar" })).toHaveLength(2);
    expectNoneOf(["Members & Privacy", "Invite Collaborator", "Project Members", "(Creator)", "Only explicitly"]);
  });

  it("tells a non-owner in Spanish that only owners change visibility", async () => {
    await renderMembers("VIEWER");

    expect(screen.getByText("* Solo los propietarios del proyecto pueden cambiar la visibilidad.")).toBeInTheDocument();
  });

  it("confirms a visibility change in Spanish", async () => {
    mocks.updateProject.mockResolvedValue({ success: true });
    await renderMembers("OWNER");

    fireEvent.click(screen.getByText("Interno").closest("button")!);

    expect(await screen.findByText("Visibilidad del proyecto cambiada a interno")).toBeInTheDocument();
  });

  it("falls back to a Spanish error when loading members fails without a message", async () => {
    mocks.getProjectMembers.mockResolvedValue({ success: false });
    renderEs(<ProjectMembersModal project={project("OWNER")} onClose={vi.fn()} />);

    expect(await screen.findByText("Error al cargar los miembros del proyecto")).toBeInTheDocument();
  });
});

describe("WebhookManagerModal in Spanish", () => {
  const project = { id: "p1", name: "Apollo", userId: "u1", currentUserRole: "OWNER" };
  const events = ["card_created", "moved", "card_updated", "card_archived", "comment_added", "card_deleted"];

  it("shows the form, the webhook list and its controls in Spanish", async () => {
    mocks.listWebhooks.mockResolvedValue({
      success: true,
      data: [{ id: "h1", projectId: "p1", url: "https://ci.example.com/hook", eventsJson: JSON.stringify(events), isActive: true, createdAt: new Date(), updatedAt: new Date() }],
    });
    renderEs(<WebhookManagerModal project={project} onClose={vi.fn()} />);
    await screen.findByText("https://ci.example.com/hook");

    expect(screen.getByRole("heading", { name: "Webhooks del Proyecto" })).toBeInTheDocument();
    expect(screen.getByText("Añadir Webhook Saliente")).toBeInTheDocument();
    expect(screen.getByLabelText("URL de Destino")).toBeInTheDocument();
    expect(screen.getByText(/^Eventos Suscritos \(\d+\/\d+\)$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seleccionar todos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpiar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear Webhook" })).toBeInTheDocument();
    expect(screen.getByText("Webhooks Configurados (1)")).toBeInTheDocument();
    expect(screen.getByText("Eventos:")).toBeInTheDocument();
    expect(screen.getByText("+1 más")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pausar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar webhook" })).toBeInTheDocument();
    expectNoneOf(["Project Webhooks", "Add Outbound Webhook", "Payload URL", "Configured Webhooks", "Pause"]);
  });

  it("shows the empty state and the no-event error in Spanish", async () => {
    mocks.listWebhooks.mockResolvedValue({ success: true, data: [] });
    renderEs(<WebhookManagerModal project={project} onClose={vi.fn()} />);

    expect(await screen.findByText("Aún no hay webhooks configurados para este proyecto.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("URL de Destino"), { target: { value: "https://ci.example.com/new" } });
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    fireEvent.click(screen.getByRole("button", { name: "Crear Webhook" }));

    expect(await screen.findByText("Selecciona al menos un tipo de evento.")).toBeInTheDocument();
    expect(mocks.createWebhook).not.toHaveBeenCalled();
  });
});

describe("Other surfaces in Spanish", () => {
  it("falls back to a Spanish error when labels fail to load", async () => {
    mocks.getLabels.mockRejectedValue(new Error("offline"));
    renderEs(<LabelManagerModal onClose={vi.fn()} />);

    expect(await screen.findByText("Error al cargar las etiquetas.")).toBeInTheDocument();
  });

  it("shows a project without a description in Spanish", () => {
    renderEs(
      <ProjectCard
        project={{ id: "p1", name: "Apollo", description: null, color: "#6366f1", createdAt: new Date("2026-01-01T00:00:00Z"), _count: { cards: 0, columns: 0 } }}
      />
    );

    expect(screen.getByText("Sin descripción.")).toBeInTheDocument();
  });

  it("labels the burndown header, cumulative flow axis and time filter in Spanish", () => {
    renderEs(
      <>
        <BurndownChart
          points={[{ date: "2026-11-01", label: "1 nov", idealRemaining: 4, actualRemaining: 3 }]}
          startRemaining={4}
          currentRemaining={3}
          metricMode="cards"
          isDark={false}
        />
        <CumulativeFlowChart
          points={[{ date: "2026-11-01", label: "1 nov", Hecho: 1 }]}
          columns={[{ id: "c1", name: "Hecho", isDone: true }]}
          metricMode="points"
          isDark={false}
        />
        <AnalyticsTimeFilter timeRange="30d" setTimeRange={vi.fn()} metricMode="cards" setMetricMode={vi.fn()} />
      </>
    );

    expect(screen.getByText("Restante / Alcance")).toBeInTheDocument();
    expect(screen.getByText(/^3 \/ 4/)).toHaveTextContent("3 / 4 tarjetas");
    expect(screen.getByText("Puntos")).toBeInTheDocument();
    expect(screen.getByText("Rango de Tiempo:")).toBeInTheDocument();
    expectNoneOf(["Remaining / Scope", "Time Range:"]);
  });
});
