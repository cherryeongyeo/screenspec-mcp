#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { FigmaRestClient, FixtureSource, type FigmaSource } from "./figma/client.js";
import { createServer } from "./server.js";
import { JiraClient } from "./jira/client.js";

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

const cfg = loadConfig();
const jiraBase = process.env.JIRA_BASE_URL ?? cfg.jira.baseUrl;
const tracker =
  jiraBase && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN
    ? new JiraClient(jiraBase, process.env.JIRA_EMAIL, process.env.JIRA_API_TOKEN)
    : undefined;

const server = createServer(source, cfg, tracker);
await server.connect(new StdioServerTransport());
console.error("screenspec-mcp running on stdio");
