import Header from "@/components/Header";
import KanbanBoard from "@/components/KanbanBoard";
import { getProjectById } from "@/actions/projects";
import { getSession } from "@/lib/auth";
import { notFound } from "next/navigation";

export const revalidate = 0;

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function ProjectBoardPage({ params }: Props) {
  const { id } = await params;
  const session = await getSession();
  const res = await getProjectById(id);

  if (!res.success || !res.data) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white flex flex-col overflow-hidden">
      <Header user={session} />
      <KanbanBoard project={res.data} />
    </div>
  );
}
