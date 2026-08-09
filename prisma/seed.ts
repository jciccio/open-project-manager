import { db } from "../src/lib/db";
import bcrypt from "bcryptjs";

async function main() {
  console.log("Seeding database with default user accounts...");

  // Clean existing data
  await db.comment.deleteMany();
  await db.cardLabel.deleteMany();
  await db.label.deleteMany();
  await db.card.deleteMany();
  await db.column.deleteMany();
  await db.project.deleteMany();
  await db.user.deleteMany();

  // Create default admin user
  const passwordHash = await bcrypt.hash("password123", 10);
  const adminUser = await db.user.create({
    data: {
      name: "Alex Rivera",
      email: "admin@example.com",
      passwordHash,
    },
  });

  const demoUser = await db.user.create({
    data: {
      name: "Jose Ciccio",
      email: "jose@example.com",
      passwordHash,
    },
  });

  // Create labels for adminUser
  const labelFrontend = await db.label.create({
    data: { name: "Frontend", color: "#3b82f6", userId: adminUser.id },
  });
  const labelBackend = await db.label.create({
    data: { name: "Backend", color: "#10b981", userId: adminUser.id },
  });
  const labelUI = await db.label.create({
    data: { name: "UI/UX", color: "#ec4899", userId: adminUser.id },
  });
  const labelFeature = await db.label.create({
    data: { name: "Feature", color: "#8b5cf6", userId: adminUser.id },
  });

  // Project 1 for Admin
  const proj1 = await db.project.create({
    data: {
      userId: adminUser.id,
      name: "Open Project Manager MVP",
      description: "Lightweight self-hosted task & project management tool built with Next.js & SQLite.",
      color: "#6366f1",
      columns: {
        create: [
          { name: "Backlog", order: 0 },
          { name: "To Do", order: 1 },
          { name: "In Progress", order: 2 },
          { name: "Done", order: 3 },
        ],
      },
    },
    include: {
      columns: true,
    },
  });

  const backlogCol = proj1.columns.find((c) => c.name === "Backlog")!;
  const todoCol = proj1.columns.find((c) => c.name === "To Do")!;
  const inProgressCol = proj1.columns.find((c) => c.name === "In Progress")!;
  const doneCol = proj1.columns.find((c) => c.name === "Done")!;

  // Card 1
  await db.card.create({
    data: {
      projectId: proj1.id,
      columnId: inProgressCol.id,
      title: "Design Modern Kanban Board Interface",
      description: "Implement drag-and-drop column layout with customizable cards, badges, and filters.",
      priority: "HIGH",
      points: 5,
      owner: "Jose Ciccio",
      order: 0,
      labels: {
        create: [
          { labelId: labelFrontend.id },
          { labelId: labelUI.id },
        ],
      },
      comments: {
        create: [
          {
            author: "Alex Rivera",
            content: "Made sure cards show story points and priority badges nicely!",
          },
        ],
      },
    },
  });

  // Card 2
  await db.card.create({
    data: {
      projectId: proj1.id,
      columnId: todoCol.id,
      title: "User Authentication & Data Isolation",
      description: "Implement bcrypt password hashing, session cookies, and route protection.",
      priority: "URGENT",
      points: 8,
      owner: "Alex Rivera",
      order: 0,
      labels: {
        create: [
          { labelId: labelBackend.id },
          { labelId: labelFeature.id },
        ],
      },
    },
  });

  // Project for Demo User
  const proj2 = await db.project.create({
    data: {
      userId: demoUser.id,
      name: "Jose's Autonomous Systems",
      description: "Isolated workspace for Jose Ciccio's internal projects.",
      color: "#ec4899",
      columns: {
        create: [
          { name: "Ideas", order: 0 },
          { name: "Active", order: 1 },
          { name: "Completed", order: 2 },
        ],
      },
    },
  });

  console.log("Seeding complete!");
  console.log(`Admin User: admin@example.com / password123 (Project: ${proj1.name})`);
  console.log(`Demo User: jose@example.com / password123 (Project: ${proj2.name})`);
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
