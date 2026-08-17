import { db } from "../lib/db";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required to run tests.");
}
const JWT_SECRET = Uint8Array.from(Buffer.from(process.env.JWT_SECRET));

export async function createTestUser(suffix = Date.now().toString()) {
  const email = `test-${suffix}@example.com`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const user = await db.user.create({
    data: {
      name: `Test User ${suffix}`,
      email,
      passwordHash,
    },
  });

  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    name: user.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(JWT_SECRET);

  return { user, token };
}

import { generateProjectKey } from "../actions/projects";

export async function createTestProject(userId: string, name = "Test Project", key?: string) {
  const projectKey = await generateProjectKey(name, key);
  return await db.project.create({
    data: {
      userId,
      name,
      key: projectKey,
      description: "A project created during automated testing",
      color: "#6366f1",
    },
  });
}

export async function createTestColumn(projectId: string, name = "To Do", order = 0) {
  return await db.column.create({
    data: {
      projectId,
      name,
      order,
    },
  });
}

export async function createTestCard(
  projectId: string,
  columnId: string,
  title = "Test Card"
) {
  return await db.card.create({
    data: {
      projectId,
      columnId,
      title,
      description: "Card details for automated testing",
      priority: "MEDIUM",
      points: 5,
    },
  });
}

export async function createTestCardType(
  projectId: string,
  name = "Bug",
  icon = "Bug",
  color = "#ef4444"
) {
  return await db.cardType.create({
    data: {
      projectId,
      name,
      icon,
      color,
    },
  });
}

export async function cleanupTestUser(userId: string) {
  try {
    await db.user.delete({
      where: { id: userId },
    });
  } catch (error) {
    // Ignore if already deleted
  }
}
