import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { FixtureSource } from "../src/figma/client.js";
import { JiraClient, type IssueTracker } from "../src/jira/client.js";
import { adfToText, compareFeedback, toSyncRow, type FeedbackSource, type JiraIssue, type SyncRow } from "../src/jira/feedback.js";
import { createServer } from "../src/server.js";
import { allowedOrigin, createSyncServer } from "../src/sync-server.js";

const browse = (k: string) => `https://team.atlassian.net/browse/${k}`;
const issue = (key: string, over: Partial<JiraIssue["fields"]> = {}): JiraIssue => ({
  key,
  fields: {
    summary: "[C-02-1] Item list implementation",
    status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    issuetype: { name: "Bug", subtask: false },
    reporter: { displayName: "Kim PM" },
    assignee: { displayName: "Lee Dev" },
    parent: { key: "DEMO-1", fields: { summary: "Cart", issuetype: { name: "Epic", hierarchyLevel: 1 } } },
    fixVersions: [{ name: "v1.2.0" }],
    labels: ["C-02"],
    comment: {
      total: 2,
      comments: [
        { author: { displayName: "Kim PM" }, created: "2026-09-20T01:00:00.000+0900", body: "first" },
        { author: { displayName: "Lee Dev" }, created: "2026-09-24T10:00:00.000+0900", body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Disabled the " }, { type: "text", text: "checkbox." }] }] } },
      ],
    },
    ...over,
  },
});

describe("Jira → Feedback Log rows", () => {
  it("flattens ADF comments", () => {
    expect(adfToText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "paragraph", content: [{ type: "mention", attrs: { text: "@Lee" } }, { type: "text", text: " b" }] }] }))
      .toBe("a @Lee b");
  });

  it("maps an issue to a row", () => {
    expect(toSyncRow(issue("DEMO-7"), "en", browse)).toEqual({
      element: "C-02-1", type: "Bug", typeTone: "red", jiraKey: "DEMO-7", url: browse("DEMO-7"),
      epic: "Epic: Cart", summary: "Item list implementation",
      lastComment: "Disabled the checkbox.", lastCommentMeta: "Lee Dev · 2026.09.24 · 2 comments", commentCount: 2,
      flow: "Kim PM → Lee Dev", status: "In Progress", statusTone: "orange", fixVersion: "v1.2.0",
    });
  });

  it("writes Korean labels and handles empty fields", () => {
    const r = toSyncRow(issue("DEMO-8", { summary: "장바구니 개선", status: { name: "검수요청" }, issuetype: { name: "하위 작업", subtask: true },
      assignee: null, parent: { key: "DEMO-7", fields: { issuetype: { name: "작업" } } }, fixVersions: [], comment: { total: 0, comments: [] } }), "ko", browse);
    expect(r).toMatchObject({ element: "", typeTone: "gray", epic: "상위: DEMO-7", flow: "Kim PM → 미배정", statusTone: "blue", fixVersion: "—" });
    expect(r.lastComment).toBeUndefined();
  });
});

describe("JiraClient.searchFeedback", () => {
  it("searches by label/summary plus existing keys, keeps only this screen's issues, sorts by element", async () => {
    const urls: string[] = [];
    const http = (async (url: string) => {
      urls.push(decodeURIComponent(String(url)));
      return new Response(JSON.stringify({ issues: [
        issue("DEMO-9", { summary: "[C-02-2] Stepper" }),
        issue("DEMO-3", { summary: "[C-021-1] Other screen", labels: [] }),
        issue("DEMO-7"),
        issue("DEMO-5", { summary: "Unlabelled but already in the table", labels: [] }),
      ] }));
    }) as unknown as typeof fetch;
    const rows = await new JiraClient("https://team.atlassian.net", "a", "b", http).searchFeedback("C-02", { projectKey: "DEMO", keys: ["DEMO-5", "bad key"], lang: "en" });
    expect(rows.map((r) => r.jiraKey)).toEqual(["DEMO-7", "DEMO-9", "DEMO-5"]);
    expect(urls[0]).toContain('((labels = "C-02" OR summary ~ "\\"C-02\\"") AND project = "DEMO") OR key in (DEMO-5) ORDER BY created ASC');
  });

  it("retries without keys when one of them no longer exists", async () => {
    const urls: string[] = [];
    const http = (async (url: string) => {
      urls.push(decodeURIComponent(String(url)));
      return urls.length === 1
        ? new Response(JSON.stringify({ errorMessages: ["An issue with key 'DEMO-128' does not exist"] }), { status: 400 })
        : new Response(JSON.stringify({ issues: [issue("DEMO-7")] }));
    }) as unknown as typeof fetch;
    const rows = await new JiraClient("https://t.atlassian.net", "a", "b", http).searchFeedback("C-02", { keys: ["DEMO-128"] });
    expect(rows).toHaveLength(1);
    expect(urls[1]).not.toContain("key in");
  });
});

describe("commentCountOf", () => {
  it("reads the comment total from the meta line", async () => {
    const { commentCountOf } = await import("../src/jira/feedback.js");
    expect(commentCountOf("새 댓글 2 · 이개발 · 2026.09.24 · 댓글 3")).toBe(3);
    expect(commentCountOf("Lee · 2026.09.24 · 1 comment")).toBe(1);
    expect(commentCountOf(undefined)).toBe(0);
    expect(commentCountOf("odd text")).toBeUndefined();
  });
});

describe("compareFeedback", () => {
  const jira = [toSyncRow(issue("DEMO-7"), "en", browse), toSyncRow(issue("DEMO-9", { summary: "[C-02-2] Stepper" }), "en", browse)];
  it("reports new, changed and vanished rows", () => {
    const figma = [
      { jiraKey: "DEMO-7", type: "Bug", summary: "Item list implementation", status: "To Do", flow: "Kim PM → Lee Dev", fixVersion: "v1.2.0", lastComment: "Disabled the checkbox.", lastCommentMeta: "Lee Dev · 2026.09.20 · 1 comment" },
      { jiraKey: "DEMO-1", type: "Task", summary: "Old", status: "Done" },
    ];
    expect(compareFeedback(figma, jira)).toEqual({
      added: ["DEMO-9"],
      updated: [{ key: "DEMO-7", fields: [{ field: "status", figma: "To Do", jira: "In Progress" }] }],
      notInJira: ["DEMO-1"],
      newComments: [{ key: "DEMO-7", count: 1, latest: "Disabled the checkbox." }],
      unchanged: false,
    });
  });
});

describe("sync helper server", () => {
  const rows: SyncRow[] = [toSyncRow(issue("DEMO-7"), "ko", browse)];
  const calls: unknown[] = [];
  const source: FeedbackSource = { async searchFeedback(screenId, opts) { calls.push({ screenId, ...opts }); return rows; } };
  const server = createSyncServer({ source, version: "test", projectKey: "DEMO" });
  let base = "";
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("only answers Figma (and local tools)", () => {
    expect(allowedOrigin("null")).toBe(true);
    expect(allowedOrigin("https://www.figma.com")).toBe(true);
    expect(allowedOrigin(undefined)).toBe(true);
    expect(allowedOrigin("https://evil.example")).toBe(false);
    expect(allowedOrigin("https://figma.com.evil.example")).toBe(false);
  });

  it("returns feedback rows with CORS for the plugin iframe", async () => {
    const res = await fetch(`${base}/feedback?screenId=C-02&lang=ko&keys=DEMO-7,DEMO-9`, { headers: { Origin: "null" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("null");
    const body = await res.json();
    expect(body.rows[0].jiraKey).toBe("DEMO-7");
    expect(calls.at(-1)).toEqual({ screenId: "C-02", projectKey: "DEMO", keys: ["DEMO-7", "DEMO-9"], lang: "ko" });
  });

  it("refuses other web pages and bad input", async () => {
    expect((await fetch(`${base}/health`, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await fetch(`${base}/feedback?screenId=`, { headers: { Origin: "null" } })).status).toBe(400);
    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toMatchObject({ ok: true, jira: true });
  });

  it("explains missing Jira settings", async () => {
    const bare = createSyncServer({ version: "test" });
    await new Promise<void>((r) => bare.listen(0, "127.0.0.1", r));
    const res = await fetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}/feedback?screenId=C-02`);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/JIRA_BASE_URL/);
    await new Promise<void>((r) => bare.close(() => r()));
  });
});

describe("get_jira_feedback tool", () => {
  it("compares Jira with the Feedback Log in Figma", async () => {
    const tracker: IssueTracker & FeedbackSource = {
      async findOpenBySummary() { return undefined; },
      async createIssue() { throw new Error("no"); },
      async getIssue(key) { return { key, url: browse(key) }; },
      async searchFeedback(_id, opts) {
        expect(opts?.keys).toContain("DEMO-475");
        expect(opts?.lang).toBe("ko");
        return [toSyncRow(issue("DEMO-475", { summary: "[M-07-1] 목차에서 기사 닫으면 목차로 복귀하지 않음", status: { name: "종료" } }), "ko", browse)];
      },
    };
    const server = createServer(new FixtureSource(new URL("./fixtures/sample-section.json", import.meta.url).pathname), structuredClone(DEFAULT_CONFIG), tracker);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);
    const r = await client.callTool({ name: "get_jira_feedback", arguments: { fileKey: "F", nodeId: "2914:18601", screenId: "M-07" } });
    const data = JSON.parse((r.content as { text: string }[])[0].text);
    expect(data.screenId).toBe("M-07");
    expect(data.changes.notInJira).toContain("DEMO-493");
    expect(data.changes.updated[0]).toMatchObject({ key: "DEMO-475" });
    expect(data.rows[0].element).toBe("M-07-1");
  });
});

describe("sync --install", () => {
  it("writes a launchd agent that runs the helper from the project folder", async () => {
    const { launchAgentPlist, LABEL } = await import("../src/autostart.js");
    const xml = launchAgentPlist({ node: "/usr/local/bin/node", script: "/Users/me/screenspec-mcp/dist/index.js", cwd: "/Users/me/screenspec-mcp", port: 3917, logDir: "/Users/me/Library/Logs" });
    expect(xml).toContain(`<string>${LABEL}</string>`);
    expect(xml).toContain("<string>/Users/me/screenspec-mcp/dist/index.js</string>\n    <string>sync</string>");
    expect(xml).toContain("<key>WorkingDirectory</key><string>/Users/me/screenspec-mcp</string>");
    expect(xml).toContain("<key>RunAtLoad</key><true/>");
  });
});
