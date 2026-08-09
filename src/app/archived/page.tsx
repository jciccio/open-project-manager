import Header from "@/components/Header";
import ArchivedClient from "./ArchivedClient";
import { getProjects } from "@/actions/projects";
import { getSession } from "@/lib/auth";

export const revalidate = 0;

export default async function ArchivedProjectsPage() {
  const session = await getSession();
  const res = await getProjects(true);
  const archivedProjects = res.success && res.data ? res.data : [];
  const archivedCount = res.archivedCount || archivedProjects.length;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white flex flex-col">
      <Header user={session} archivedCount={archivedCount} />
      <ArchivedClient archivedProjects={archivedProjects as any[]} />
    </div>
  );
}
