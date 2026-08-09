import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";

const dbPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "dev.db");
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

async function runLoadTest() {
  console.log("⚡ Starting High-Concurrency Memory Load Test...\n");

  const startMem = process.memoryUsage();
  console.log(`[Baseline]  RSS: ${formatMB(startMem.rss)} | Heap Used: ${formatMB(startMem.heapUsed)}`);

  // 1. Create Load Test User & Project
  const hash = await bcrypt.hash("loadTestPassword123", 10);
  const user = await prisma.user.create({
    data: {
      name: "Load Tester",
      email: `load-test-${Date.now()}@example.com`,
      passwordHash: hash,
    },
  });

  const project = await prisma.project.create({
    data: {
      userId: user.id,
      name: "Load Test Workspace",
      color: "#6366f1",
    },
  });

  const column1 = await prisma.column.create({
    data: { projectId: project.id, name: "Queue", order: 0 },
  });

  const column2 = await prisma.column.create({
    data: { projectId: project.id, name: "Processing", order: 1 },
  });

  // 2. Perform 500 Concurrent Operations (Inserts, Updates, Moves, Queries)
  const TOTAL_OPS = 500;
  const CONCURRENCY_BATCH = 25;
  console.log(`\n🚀 Simulating ${TOTAL_OPS} heavy database & task operations in batches of ${CONCURRENCY_BATCH}...`);

  const startTime = Date.now();

  for (let i = 0; i < TOTAL_OPS; i += CONCURRENCY_BATCH) {
    const batch = Array.from({ length: CONCURRENCY_BATCH }).map(async (_, idx) => {
      const cardNum = i + idx;
      // Insert Card
      const card = await prisma.card.create({
        data: {
          projectId: project.id,
          columnId: column1.id,
          title: `Load Test Task ${cardNum}`,
          description: `High load stress test card #${cardNum} with description data payload`,
          priority: cardNum % 2 === 0 ? "HIGH" : "URGENT",
          points: (cardNum % 8) + 1,
          owner: `Worker-${cardNum % 5}`,
        },
      });

      // Move Card
      await prisma.card.update({
        where: { id: card.id },
        data: { columnId: column2.id, points: card.points! + 1 },
      });

      // Add Comment
      await prisma.comment.create({
        data: {
          cardId: card.id,
          author: "Load Worker",
          content: `Processed load item ${cardNum} successfully`,
        },
      });
    });

    await Promise.all(batch);
  }

  const durationMs = Date.now() - startTime;
  const rps = ((TOTAL_OPS * 3) / (durationMs / 1000)).toFixed(2); // 3 sub-ops per item

  const peakMem = process.memoryUsage();
  console.log(`\n[Peak Load] RSS: ${formatMB(peakMem.rss)} | Heap Used: ${formatMB(peakMem.heapUsed)}`);
  console.log(`⚡ Executed ${TOTAL_OPS * 3} database mutations in ${durationMs}ms (~${rps} ops/sec)`);

  // 3. Query Heavy Analytics Breakdown
  const projectWithData = await prisma.project.findUnique({
    where: { id: project.id },
    include: {
      columns: {
        include: {
          cards: {
            include: { comments: true },
          },
        },
      },
    },
  });

  const finalCardCount = projectWithData?.columns.reduce(
    (acc, col) => acc + col.cards.length,
    0
  );

  // 4. Cleanup Load Data
  await prisma.user.delete({ where: { id: user.id } });

  if (global.gc) global.gc();

  const postMem = process.memoryUsage();
  console.log(`\n[Post-Load Clean] RSS: ${formatMB(postMem.rss)} | Heap Used: ${formatMB(postMem.heapUsed)}`);

  console.log("\n=== Load Test Summary ===");
  console.log(`  Total Tasks Created & Moved: ${finalCardCount}`);
  console.log(`  Memory Delta (Peak vs Start): ${formatMB(peakMem.rss - startMem.rss)}`);
  console.log(`  Peak RAM Usage:               ${formatMB(peakMem.rss)}`);
  console.log(`  Peak Heap Used:               ${formatMB(peakMem.heapUsed)}`);
  console.log(`  Operations Per Second:        ${rps} ops/sec\n`);

  await prisma.$disconnect();
}

runLoadTest().catch((err) => {
  console.error("Load test error:", err);
  process.exit(1);
});
