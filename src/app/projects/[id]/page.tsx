import { Suspense } from "react";
import KanbanBoard from "@/components/KanbanBoard";
import { getProjectById } from "@/actions/projects";
import { getSession } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";

export const revalidate = 0;

interface Props {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    [key: string]: string | string[] | undefined;
  }>;
}

export default async function ProjectBoardPage({ params, searchParams }: Props) {
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

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const cardParam =
    typeof resolvedSearchParams.card === "string"
      ? resolvedSearchParams.card
      : typeof resolvedSearchParams.cardId === "string"
      ? resolvedSearchParams.cardId
      : undefined;

  return (
    <Suspense fallback={null}>
      <KanbanBoard project={res.data} initialCardParam={cardParam} />
    </Suspense>
  );
}
