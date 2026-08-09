import Header from "@/components/Header";
import DashboardClient from "@/components/DashboardClient";
import { getProjects } from "@/actions/projects";
import { getSession } from "@/lib/auth";

export const revalidate = 0;

export default async function DashboardPage() {
  const session = await getSession();
  const res = await getProjects(false);
  const projects = res.success && res.data ? res.data : [];
  const archivedCount = res.archivedCount || 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white flex flex-col">
      <Header user={session} archivedCount={archivedCount} />
      <DashboardClient user={session} projects={projects as any[]} archivedCount={archivedCount} />
    </div>
  );
}
