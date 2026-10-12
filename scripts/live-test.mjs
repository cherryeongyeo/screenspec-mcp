// Live check against a real Figma file.
// Usage: node scripts/live-test.mjs <figma file URL or key>
// Reads FIGMA_TOKEN from .env, runs every read tool, saves mockup crops as live-mockup-*.png
// and writes live-test-output.json.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const env = { ...process.env };
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2];
}
if (!env.FIGMA_TOKEN) { console.error("FIGMA_TOKEN missing (.env)"); process.exit(1); }
const arg = process.argv[2] ?? "";
const fileKey = arg.includes("figma.com") ? new URL(arg).pathname.split("/")[2] : arg;
if (!fileKey) { console.error("usage: node scripts/live-test.mjs <figma file URL>"); process.exit(1); }

const client = new Client({ name: "live-test", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env }));
const out = { fileKey, ranAt: new Date().toISOString(), calls: [] };
const call = async (name, args) => {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  let data; try { data = JSON.parse(text); } catch { data = text; }
  const img = r.content?.find((c) => c.type === "image");
  if (img) {
    const file = `live-mockup-${args.screenId ?? args.nodeId.replace(":", "-")}-${args.item}.png`;
    writeFileSync(file, Buffer.from(img.data, "base64"));
    console.log(`  saved ${file}`);
  }
  out.calls.push({ name, args, ms: Date.now() - t0, isError: !!r.isError, data });
  console.log(`${r.isError ? "✗" : "✓"} ${name} ${JSON.stringify(args)} (${Date.now() - t0}ms)`);
  return r.isError ? null : data;
};

const list = await call("list_screens", { fileKey });
const screens = (list?.screens ?? []).filter((s) => !s.template);
for (const s of screens) {
  const t = { fileKey, nodeId: s.nodeId };
  await call("get_screen_spec", t);
  await call("lint_spec", t);
  for (const item of [1, 2]) await call("get_element", { ...t, item });
  await call("diff_spec", t);
  await call("draft_jira_ticket", { ...t, item: 1 });
}
const tpl = (list?.screens ?? []).find((s) => s.template);
if (tpl) await call("lint_spec", { fileKey, nodeId: tpl.nodeId });
await client.close();
writeFileSync("live-test-output.json", JSON.stringify(out, null, 2));
console.log(`\nwrote live-test-output.json (${out.calls.length} calls, ${out.calls.filter((c) => c.isError).length} errors)`);
