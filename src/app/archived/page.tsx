import Header from "@/components/Header";
import ArchivedClient from "./ArchivedClient";
import { getProjects } from "@/actions/projects";
import { getArchivedCards } from "@/actions/cards";
import { getSession } from "@/lib/auth";

export const revalidate = 0;

export default async function ArchivedProjectsPage() {
  const session = await getSession();
  const pRes = await getProjects(true);
  const cRes = await getArchivedCards();

  const archivedProjects = pRes.success && pRes.data ? pRes.data : [];
  const archivedCards = cRes.success && cRes.data ? cRes.data : [];
  const archivedCount = pRes.archivedCount || archivedProjects.length;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white flex flex-col">
      <Header user={session} archivedCount={archivedCount} />
      <ArchivedClient
        archivedProjects={archivedProjects as any[]}
        archivedCards={archivedCards as any[]}
      />
    </div>
  );
}
