#!/usr/bin/env npx tsx
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../src/mcp/core.js";

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Open Project Manager MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting MCP Server:", error);
  process.exit(1);
});
