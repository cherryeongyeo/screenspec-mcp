// Spawns the built server over stdio (fixture mode) and calls every tool.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: { ...process.env, SCREENSPEC_FIXTURE: "test/fixtures/sample-section.json" },
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const t = { fileKey: "", nodeId: "2914:18601" };
const calls = [
  ["list_screens", t],
  ["lint_spec", { ...t, screenId: "M-07" }],
  ["get_element", { ...t, screenId: "M-07", item: 1 }],
  ["draft_jira_ticket", { ...t, screenId: "M-07", item: 1, intent: "API 연동" }],
  ["get_element", { ...t, screenId: "M-07", item: 9 }],
];
for (const [name, args] of calls) {
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n=== ${name} ${r.isError ? "(error)" : ""}\n${r.content[0].text.slice(0, 1800)}`);
}
await client.close();
