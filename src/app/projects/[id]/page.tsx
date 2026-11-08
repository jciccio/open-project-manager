import KanbanBoard from "@/components/KanbanBoard";
import { getProjectById } from "@/actions/projects";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";

export const revalidate = 0;

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function ProjectBoardPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    redirect("/api/v1/auth/session-expired");
  }
  const res = await getProjectById(id);

  if (!res.success && "kind" in res && res.kind === "internal") {
    throw new Error(res.error);
  }
  if (!res.success || !res.data) {
    notFound();
  }

  return <KanbanBoard project={res.data} />;
}
