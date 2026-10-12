// End-to-end check: spec element → Jira issue → Figma Dev Mode link.
// Usage: node scripts/jira-live-test.mjs <figma URL of a spec frame> <item> <JIRA project key> [parentKey]
// Reads FIGMA_TOKEN, JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN from .env.
// Creates ONE real issue (or returns the open one for the same element). Use a sandbox project.
import { readFileSync, existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const env = { ...process.env };
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m) env[m[1]] = m[2];
}
const [url, item, projectKey, parentKey] = process.argv.slice(2);
const missing = ["FIGMA_TOKEN", "JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"].filter((k) => !env[k]);
if (!url || !item || !projectKey || missing.length) {
  console.error("usage: node scripts/jira-live-test.mjs <figma spec URL> <item> <project key> [parent key]");
  if (missing.length) console.error("missing in .env: " + missing.join(", "));
  process.exit(1);
}

const client = new Client({ name: "jira-live-test", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env }));
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  console.log(`\n${r.isError ? "✗" : "✓"} ${name}\n${text}`);
  return r.isError ? null : JSON.parse(text);
};

const t = { url, item: Number(item) };
await call("draft_jira_ticket", t);
await call("create_jira_ticket", { ...t, projectKey, ...(parentKey ? { parentKey } : {}) });
await call("get_element", t);
await client.close();
