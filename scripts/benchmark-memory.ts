import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import fs from "fs";
import path from "path";

const dbPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "dev.db");
const adapter = new PrismaBetterSqlite3({ url: dbPath });
const prisma = new PrismaClient({ adapter });

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

function formatKB(bytes: number): string {
  return (bytes / 1024).toFixed(2) + " KB";
}

async function runBenchmark() {
  console.log("📊 Running Open Project Manager System & Memory Profiler...\n");

  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  const memUsage = process.memoryUsage();
  const dbStats = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null;

  // DB Record Counts
  const userCount = await prisma.user.count();
  const projectCount = await prisma.project.count();
  const columnCount = await prisma.column.count();
  const cardCount = await prisma.card.count();
  const labelCount = await prisma.label.count();
  const commentCount = await prisma.comment.count();

  console.log("=== Node.js Process Memory Footprint ===");
  console.log(`  RSS (Resident Set Size):  ${formatMB(memUsage.rss)}`);
  console.log(`  Heap Total:               ${formatMB(memUsage.heapTotal)}`);
  console.log(`  Heap Used:                ${formatMB(memUsage.heapUsed)}`);
  console.log(`  External Memory:          ${formatMB(memUsage.external)}`);
  console.log(`  ArrayBuffers:             ${formatMB(memUsage.arrayBuffers)}`);

  console.log("\n=== Storage & Database Metrics ===");
  console.log(`  SQLite File Path:         ${dbPath}`);
  console.log(`  SQLite Database Size:     ${dbStats ? formatKB(dbStats.size) : "N/A"}`);
  console.log(`  Total Users:              ${userCount}`);
  console.log(`  Total Projects:           ${projectCount}`);
  console.log(`  Total Columns:            ${columnCount}`);
  console.log(`  Total Task Cards:         ${cardCount}`);
  console.log(`  Total Labels:             ${labelCount}`);
  console.log(`  Total Comments:           ${commentCount}`);

  console.log("\n=== System Environment Summary ===");
  console.log(`  Node.js Version:          ${process.version}`);
  console.log(`  Platform / Arch:          ${process.platform} (${process.arch})`);
  console.log(`  Execution Mode:           ${process.env.NODE_ENV || "development"}\n`);

  await prisma.$disconnect();
}

runBenchmark().catch((err) => {
  console.error("Benchmark error:", err);
  process.exit(1);
});
