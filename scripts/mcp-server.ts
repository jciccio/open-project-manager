#!/usr/bin/env npx tsx
// stdout carries the MCP protocol; every message for humans goes to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../src/mcp/core.js";
import { resolveStdioUser } from "../src/mcp/stdioUser.js";

async function main() {
  const pinned = process.env.OPM_MCP_USER;
  let userId: string | undefined;
  if (pinned) {
    const user = await resolveStdioUser(pinned);
    if (!user) {
      console.error(`OPM_MCP_USER="${pinned}" matches no user (pass an email or a user id).`);
      process.exit(1);
    }
    userId = user.id;
    console.error(`Open Project Manager MCP Server acting as ${user.email}`);
  } else {
    console.error(
      "OPM_MCP_USER is not set: each tool call acts as the userId the client sends. Set OPM_MCP_USER to pin this server to one account."
    );
  }

  const server = createMcpServer({ userId });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Open Project Manager MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting MCP Server:", error);
  process.exit(1);
});
