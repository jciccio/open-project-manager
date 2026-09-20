import Header from "@/components/Header";
import DashboardClient from "@/components/DashboardClient";
import { getProjects } from "@/actions/projects";
import { getSession } from "@/lib/auth";
import { getProjectStats } from "@/lib/services/projectStats";
import { redirect } from "next/navigation";

export const revalidate = 0;

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  const res = await getProjects(false);
  const projects = res.success && res.data ? res.data : [];
  const archivedCount = res.archivedCount || 0;
  const stats = await getProjectStats(
    projects.map((project) => project.id),
    session.userId
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white flex flex-col">
      <Header user={session} archivedCount={archivedCount} />
      <DashboardClient user={session} projects={projects as any[]} stats={stats} archivedCount={archivedCount} />
    </div>
  );
}
