import { db } from "../src/lib/db";

export async function backfillProjectMembers() {
  const projects = await db.project.findMany({
    select: { id: true, userId: true },
  });

  let added = 0;
  for (const proj of projects) {
    const existing = await db.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: proj.id,
          userId: proj.userId,
        },
      },
    });

    if (!existing) {
      await db.projectMember.create({
        data: {
          projectId: proj.id,
          userId: proj.userId,
          role: "OWNER",
        },
      });
      added++;
    }
  }

  return { totalProjects: projects.length, backfilledMembers: added };
}

if (require.main === module || process.argv[1]?.endsWith("backfill-project-members.ts")) {
  backfillProjectMembers()
    .then((res) => {
      console.log("Backfill result:", res);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
