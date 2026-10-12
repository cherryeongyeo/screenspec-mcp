import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { FigmaRestClient, FixtureSource } from "../src/figma/client.js";
import { markdownToAdf } from "../src/jira/adf.js";
import { JiraClient, type CreateIssueInput, type IssueTracker, type JiraIssueRef } from "../src/jira/client.js";
import { createServer } from "../src/server.js";

type Call = { url: string; init?: RequestInit };
function mockFetch(responses: ((c: Call) => { status?: number; body: unknown }) | { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  let i = 0;
  const fn = (async (url: string, init?: RequestInit) => {
    const c = { url: String(url), init };
    calls.push(c);
    const r = typeof responses === "function" ? responses(c) : responses[i++];
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("markdownToAdf", () => {
  const doc = markdownToAdf(
    "> Screen: C-02\n\n## Policy\n**Policy**: Sold-out items can't be selected\n\n- [ ] Default state\n- [x] Done one\n- plain\n\n[Open in Figma](https://figma.com/x)",
  );
  it("maps block types", () => {
    expect(doc.content.map((b) => b.type)).toEqual(["blockquote", "heading", "paragraph", "bulletList", "paragraph"]);
  });
  it("keeps bold, checkboxes and links", () => {
    expect(JSON.stringify(doc.content[2])).toContain('"marks":[{"type":"strong"}]');
    const items = JSON.stringify(doc.content[3]);
    expect(items).toContain("☐ Default state");
    expect(items).toContain("☑ Done one");
    expect(JSON.stringify(doc.content[4])).toContain('"href":"https://figma.com/x"');
  });
});

describe("JiraClient", () => {
  const input: CreateIssueInput = {
    projectKey: "DEMO", summary: "[C-02-1] Item list implementation", issueType: "Task",
    labels: ["C-02", "screen spec"], description: "## Policy\n- [ ] one", parentKey: "DEMO-1",
  };

  it("creates an issue with ADF description, labels and parent", async () => {
    const { fn, calls } = mockFetch([{ status: 201, body: { id: "1", key: "DEMO-200" } }]);
    const jira = new JiraClient("https://team.atlassian.net/", "me@x.com", "tok", fn);
    const r = await jira.createIssue(input);
    expect(r).toMatchObject({ key: "DEMO-200", url: "https://team.atlassian.net/browse/DEMO-200" });
    expect(calls[0].url).toBe("https://team.atlassian.net/rest/api/3/issue");
    const headers = calls[0].init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Basic " + Buffer.from("me@x.com:tok").toString("base64"));
    const fields = JSON.parse(String(calls[0].init!.body)).fields;
    expect(fields).toMatchObject({ project: { key: "DEMO" }, issuetype: { name: "Task" }, parent: { key: "DEMO-1" }, labels: ["C-02", "screen_spec"] });
    expect(fields.description.type).toBe("doc");
  });

  it("finds an open issue by [ref] prefix", async () => {
    const { fn, calls } = mockFetch([{ body: { issues: [
      { key: "DEMO-9", fields: { summary: "[C-02-2] Quantity stepper", status: { name: "To Do" } } },
      { key: "DEMO-7", fields: { summary: "[C-02-1] Item list implementation", status: { name: "In Progress" } } },
    ] } }]);
    const jira = new JiraClient("https://team.atlassian.net", "a", "b", fn);
    const hit = await jira.findOpenBySummary("DEMO", "C-02", "[C-02-1]");
    expect(hit).toMatchObject({ key: "DEMO-7", status: "In Progress" });
    expect(decodeURIComponent(calls[0].url)).toContain('labels = "C-02" AND statusCategory != Done');
  });

  it("surfaces Jira error messages", async () => {
    const { fn } = mockFetch([{ status: 400, body: { errorMessages: [], errors: { issuetype: "Specify a valid issue type" } } }]);
    const jira = new JiraClient("https://team.atlassian.net", "a", "b", fn);
    await expect(jira.createIssue(input)).rejects.toThrow("issuetype: Specify a valid issue type");
  });
});

describe("Figma dev resources", () => {
  it("posts a dev resource and reports API errors", async () => {
    const ok = mockFetch([{ body: { links_created: [{ id: "x", name: "DEMO-1", url: "u", file_key: "F", node_id: "1:2" }], errors: [] } }]);
    const figma = new FigmaRestClient("tok", 0, ok.fn);
    await figma.addDevResource({ name: "DEMO-1", url: "u", file_key: "F", node_id: "1:2" });
    expect(ok.calls[0].url).toBe("https://api.figma.com/v1/dev_resources");
    expect(JSON.parse(String(ok.calls[0].init!.body)).dev_resources[0].node_id).toBe("1:2");

    const bad = mockFetch([{ status: 403, body: { message: "Invalid scope" } }]);
    await expect(new FigmaRestClient("tok", 0, bad.fn).addDevResource({ name: "n", url: "u", file_key: "F", node_id: "1:2" }))
      .rejects.toThrow("Invalid scope");
  });
});

describe("create_jira_ticket / link_jira_issue tools", () => {
  class FakeTracker implements IssueTracker {
    created: CreateIssueInput[] = [];
    async findOpenBySummary(_p: string, _l: string, prefix: string) {
      const c = this.created.find((i) => i.summary.startsWith(prefix));
      return c && { key: "DEMO-1", url: "https://t/browse/DEMO-1", summary: c.summary };
    }
    async createIssue(input: CreateIssueInput): Promise<JiraIssueRef> {
      this.created.push(input);
      return { key: `DEMO-${this.created.length}`, url: `https://t/browse/DEMO-${this.created.length}`, summary: input.summary };
    }
    async getIssue(key: string) { return { key, url: `https://t/browse/${key}`, summary: "Existing" }; }
  }

  async function connect(tracker?: IssueTracker) {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.ticket.projectKey = "DEMO";
    const source = new FixtureSource(new URL("./fixtures/sample-section.json", import.meta.url).pathname);
    const server = createServer(source, cfg, tracker);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as { text: string }[])[0].text;
      return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
    };
    return { call, source };
  }
  const t = { fileKey: "FILE", nodeId: "2914:18601", screenId: "M-07" };

  it("creates the issue, links it to the element, and dedupes the second call", async () => {
    const tracker = new FakeTracker();
    const { call, source } = await connect(tracker);
    const first = await call("create_jira_ticket", { ...t, item: 1, intent: "API 연동" });
    expect(first.data).toMatchObject({ created: true, issue: { key: "DEMO-1" }, figma: { linked: true } });
    expect(tracker.created[0]).toMatchObject({ projectKey: "DEMO", summary: "[M-07-1] 목차 리스트 API 연동", labels: ["M-07"] });
    expect(await source.getDevResources("FILE", ["2956:18656"])).toHaveLength(1);

    const second = await call("create_jira_ticket", { ...t, item: 1 });
    expect(second.data).toMatchObject({ created: false, issue: { key: "DEMO-1" }, figma: { alreadyLinked: true } });
    expect(tracker.created).toHaveLength(1);

    const el = await call("get_element", { ...t, item: 1 });
    expect(el.data.linkedIssues[0].url).toBe("https://t/browse/DEMO-1");
  });

  it("links an existing issue by key", async () => {
    const { call } = await connect(new FakeTracker());
    const r = await call("link_jira_issue", { ...t, item: 1, issueKey: "DEMO-42" });
    expect(r.data).toMatchObject({ element: "M-07-1", issue: { key: "DEMO-42" }, figma: { linked: true } });
  });

  it("lists usable project keys when the project is wrong", async () => {
    const tracker = new FakeTracker();
    tracker.createIssue = async () => { throw new Error("Jira 400 on POST /rest/api/3/issue: project: 대상 프로젝트가 존재하지 않거나 …"); };
    (tracker as IssueTracker).listProjectKeys = async () => ["SCRUM"];
    const { call } = await connect(tracker);
    const r = await call("create_jira_ticket", { ...t, item: 1 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Projects you can use: SCRUM/);
  });

  it("explains how to configure Jira when it is missing", async () => {
    const { call } = await connect();
    const r = await call("create_jira_ticket", { ...t, item: 1 });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/JIRA_BASE_URL/);
  });
});
