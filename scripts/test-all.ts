import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { db as prisma, getDatabaseProvider } from "../src/lib/db";

const JWT_SECRET = new TextEncoder().encode("opm-test-secret-key-2026");

async function runTests() {
  console.log(`🧪 Starting Automated Test Suite for Open Project Manager (DB: ${getDatabaseProvider()})...\n`);
  let passedCount = 0;
  let totalCount = 0;

  function assert(condition: boolean, testName: string) {
    totalCount++;
    if (condition) {
      console.log(`  ✓ PASSED: ${testName}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAILED: ${testName}`);
    }
  }

  try {
    // Test 1: Password Hashing & Verification
    console.log("▶ Testing Authentication & Hashing...");
    const rawPassword = "securePassword123!";
    const hash = await bcrypt.hash(rawPassword, 10);
    const isValid = await bcrypt.compare(rawPassword, hash);
    assert(isValid, "bcrypt password hashing and comparison");

    // Test 2: JWT Sign & Verification
    console.log("\n▶ Testing JWT Session Token Handling...");
    const payload = { userId: "test-user-id", email: "test@example.com", name: "Test User" };
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(JWT_SECRET);

    const verified = await jwtVerify(token, JWT_SECRET);
    assert(verified.payload.email === "test@example.com", "JWT signing and verification");

    // Test 3: Database Connection & CRUD
    console.log(`\n▶ Testing Database CRUD & Multi-Account Scoping on ${getDatabaseProvider()}...`);
    const testUserEmail = `test-user-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        name: "Automated Test User",
        email: testUserEmail,
        passwordHash: hash,
      },
    });
    assert(!!user.id, `User creation in ${getDatabaseProvider()}`);

    // Create Project
    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: "Test Project",
        description: "Benchmark testing workspace",
        color: "#6366f1",
      },
    });
    assert(project.userId === user.id, "Project creation with user isolation");

    // Create Column
    const column = await prisma.column.create({
      data: {
        projectId: project.id,
        name: "In Testing",
        order: 0,
      },
    });
    assert(column.projectId === project.id, "Column creation in project");

    // Create Card
    const card = await prisma.card.create({
      data: {
        projectId: project.id,
        columnId: column.id,
        title: "Test Task Card",
        number: 1,
        priority: "HIGH",
        points: 8,
        owner: "Automation Bot",
      },
    });
    assert(card.points === 8 && card.priority === "HIGH", "Task card creation with metadata");

    // Move Card
    const updatedCard = await prisma.card.update({
      where: { id: card.id },
      data: { priority: "URGENT", points: 10 },
    });
    assert(updatedCard.priority === "URGENT" && updatedCard.points === 10, "Task card update");

    // Cleanup Test User & Cascade Data
    await prisma.user.delete({ where: { id: user.id } });
    const checkDeleted = await prisma.project.findUnique({ where: { id: project.id } });
    assert(checkDeleted === null, "Cascading delete cleanup");

    console.log(`\n🎉 Test Suite Completed: ${passedCount}/${totalCount} tests passed.\n`);
    if (passedCount !== totalCount) {
      process.exit(1);
    }
  } catch (error) {
    console.error("Test execution error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
