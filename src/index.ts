#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { FigmaRestClient, FixtureSource, type FigmaSource } from "./figma/client.js";
import { JiraClient } from "./jira/client.js";
import { createServer, VERSION } from "./server.js";
import { createSyncServer, DEFAULT_SYNC_PORT } from "./sync-server.js";

/** Read KEY=value lines from ./.env without overriding variables that are already set. */
function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadDotEnv();

const cfg = loadConfig();
const jiraBase = process.env.JIRA_BASE_URL ?? cfg.jira.baseUrl;
const jira =
  jiraBase && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN
    ? new JiraClient(jiraBase, process.env.JIRA_EMAIL, process.env.JIRA_API_TOKEN)
    : undefined;

if (process.argv[2] === "sync") {
  // Local helper for the Figma plugin's Sync button (Jira → Feedback Log).
  const i = process.argv.indexOf("--port");
  const port = Number(i > 0 ? process.argv[i + 1] : process.env.SCREENSPEC_SYNC_PORT ?? DEFAULT_SYNC_PORT);
  const server = createSyncServer({ source: jira, version: VERSION, projectKey: cfg.ticket.projectKey });
  server.listen(port, "127.0.0.1", () => {
    console.error(`screenspec-mcp sync helper on http://127.0.0.1:${port}`);
    console.error(jira ? `Jira: ${jiraBase}` : "Jira is not configured: set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN (e.g. in .env).");
    console.error("Leave this running and press Sync in the Figma plugin. Ctrl+C to stop.");
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    console.error(e.code === "EADDRINUSE" ? `Port ${port} is busy. Is the helper already running? Try --port <n>.` : e.message);
    process.exit(1);
  });
} else {
  const fixture = process.env.SCREENSPEC_FIXTURE;
  const token = process.env.FIGMA_TOKEN ?? process.env.FIGMA_ACCESS_TOKEN;

  let source: FigmaSource;
  if (fixture) {
    source = new FixtureSource(fixture);
  } else if (token) {
    source = new FigmaRestClient(token);
  } else {
    console.error(
      "screenspec-mcp: set FIGMA_TOKEN (Figma personal access token, file_content:read scope) " +
        "or SCREENSPEC_FIXTURE=<path to saved nodes JSON> to run offline.",
    );
    process.exit(1);
  }

  const server = createServer(source, cfg, jira);
  await server.connect(new StdioServerTransport());
  console.error("screenspec-mcp running on stdio");
}
