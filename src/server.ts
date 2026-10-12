import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { markers, type Config } from "./config.js";
import { parseFigmaUrl, type FigmaSource } from "./figma/client.js";
import type { IssueTracker, JiraIssueRef } from "./jira/client.js";
import { lintScreen } from "./spec/lint.js";
import { figmaUrl, findScreenDocs, parseScreen, refNumber } from "./spec/parse.js";
import { draftTicket } from "./spec/ticket.js";
import type { FigmaNode, ScreenSpec } from "./spec/types.js";

export const VERSION = "0.2.0";

const target = {
  url: z.string().url().optional().describe("Figma URL of a screen spec frame, its section, or the file"),
  fileKey: z.string().optional().describe("Figma file key (alternative to url)"),
  nodeId: z.string().optional().describe("Node ID like 2914:18601 (alternative to url)"),
  screenId: z.string().optional().describe("Only return the screen with this ID, e.g. M-07"),
};
const targetSchema = z.object(target);
type Target = z.infer<typeof targetSchema>;

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
});

export function createServer(source: FigmaSource, cfg: Config, tracker?: IssueTracker) {
  const server = new McpServer({ name: "screenspec-mcp", version: VERSION });

  function resolve(t: Target) {
    const fromUrl = t.url ? parseFigmaUrl(t.url) : undefined;
    const fileKey = fromUrl?.fileKey ?? t.fileKey ?? "";
    const nodeId = fromUrl?.nodeId ?? t.nodeId;
    return { fileKey, nodeId };
  }

  async function loadScreens(t: Target, includeTemplate = false): Promise<ScreenSpec[]> {
    const { fileKey, nodeId } = resolve(t);
    if (!nodeId) throw new Error("A node is required. Pass a Figma URL with ?node-id=… or nodeId. Use list_screens to find one.");
    const root = await source.getNode(fileKey, nodeId);
    let screens = findScreenDocs(root, cfg).map((d) => parseScreen(d, cfg, fileKey || undefined));
    if (!includeTemplate) screens = screens.filter((s) => !s.isTemplate || screens.length === 1);
    if (t.screenId) screens = screens.filter((s) => s.screenId === t.screenId);
    if (!screens.length) throw new Error(`No screen spec found under node ${nodeId}${t.screenId ? ` with ID ${t.screenId}` : ""}.`);
    return screens;
  }

  function findItem(s: ScreenSpec, item: number) {
    const it = s.items.find((i) => i.no === item);
    if (!it) throw new Error(`${s.screenId} has no element ${item}. Elements: ${s.items.map((i) => i.no).join(", ") || "none"}`);
    return it;
  }

  server.registerTool(
    "list_screens",
    {
      title: "List screen specs",
      description:
        "Find screen spec documents (frames whose name contains the spec marker, default '화면정의서') in a Figma file or under a node. Returns screen ID, title and node links.",
      inputSchema: { url: target.url, fileKey: target.fileKey, nodeId: target.nodeId },
      annotations: { readOnlyHint: true },
    },
    async (t) => {
      try {
        const { fileKey, nodeId } = resolve(t);
        const root = nodeId ? await source.getNode(fileKey, nodeId) : await source.getFile(fileKey, cfg.scanDepth);
        const out: { screenId: string; title: string; version?: string; status?: string; nodeId: string; page?: string; url?: string; template: boolean }[] = [];
        const visit = (n: FigmaNode, page?: string) => {
          const pg = n.type === "CANVAS" ? n.name : page;
          if ((n.type === "FRAME" || n.type === "COMPONENT") && markers(cfg).some((m) => n.name.includes(m))) {
            if (n.children?.length) {
              const s = parseScreen(n, cfg, fileKey || undefined);
              out.push({ screenId: s.screenId, title: s.title, version: s.version, status: s.status, nodeId: n.id, page: pg, url: s.figmaUrl, template: s.isTemplate });
            } else {
              const m = /^\W*\s*(\S+)\s+(.+?)\s*·/.exec(n.name);
              out.push({ screenId: m?.[1] ?? "", title: m?.[2] ?? n.name, nodeId: n.id, page: pg, url: figmaUrl(fileKey || undefined, n.id), template: cfg.placeholders.includes(m?.[1] ?? "") });
            }
            return;
          }
          n.children?.forEach((c) => visit(c, pg));
        };
        visit(root);
        return ok({ count: out.length, screens: out });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_screen_spec",
    {
      title: "Get screen spec",
      description:
        "Read a screen spec as structured JSON: header (ID, version, status, owners), overview, every element with PM policy and Design spec fields, Jira feedback log and change log. Fields still holding template guide text are marked filled=false.",
      inputSchema: target,
      annotations: { readOnlyHint: true },
    },
    async (t) => {
      try {
        const screens = await loadScreens(t);
        return ok(screens.length === 1 ? screens[0] : screens);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_element",
    {
      title: "Get one element",
      description:
        "Return a single element (ITEM n) of a screen spec with its PM policy, Design spec, related Jira feedback, issues linked to the element in Figma Dev Mode, and a rendered image URL of the element card.",
      inputSchema: { ...target, item: z.number().int().positive().describe("Element number shown on the badge") },
      annotations: { readOnlyHint: true },
    },
    async ({ item, ...t }) => {
      try {
        const [s] = await loadScreens(t);
        const it = findItem(s, item);
        const { fileKey } = resolve(t);
        const images = fileKey ? await source.getImages(fileKey, [it.nodeId], 2).catch(() => ({})) : {};
        const feedback = s.feedback.filter((f) => refNumber(f.element, s.screenId) === item);
        const links = fileKey ? await source.getDevResources(fileKey, [it.nodeId]).catch(() => undefined) : undefined;
        return ok({
          screen: { screenId: s.screenId, title: s.title, version: s.version },
          ...it,
          feedback,
          imageUrl: (images as Record<string, string | null>)[it.nodeId] ?? null,
          figmaUrl: figmaUrl(fileKey || undefined, it.nodeId),
          linkedIssues: links?.map((l) => ({ name: l.name, url: l.url })),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "lint_spec",
    {
      title: "Lint screen spec",
      description:
        "Check a screen spec for gaps before hand-off: unfilled PM policy / Design fields, duplicate or skipped element numbers, feedback pointing to missing elements, header version vs change log mismatch. Returns completeness % and issues.",
      inputSchema: target,
      annotations: { readOnlyHint: true },
    },
    async (t) => {
      try {
        const screens = await loadScreens(t);
        const reports = screens.map((s) => lintScreen(s, cfg));
        return ok(reports.length === 1 ? reports[0] : reports);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "draft_jira_ticket",
    {
      title: "Draft Jira ticket from spec",
      description:
        "Draft a Jira ticket for a developer from the PM policy of one element (or the whole screen): summary, labels (screen ID included so the Feedback Log can pick it up), markdown description, acceptance criteria derived from State/Policy/Exception, open feedback, Figma link. Does not create the issue — pass the result to a Jira tool or paste it.",
      inputSchema: {
        ...target,
        item: z.number().int().positive().optional().describe("Element number; omit for a screen-level ticket"),
        intent: z.string().optional().describe("What the ticket is for, e.g. '목차 API 연동'. Default: 구현"),
        issueType: z.string().optional().describe("Jira issue type name, e.g. 작업, 버그, 하위 작업"),
        notes: z.string().optional().describe("Extra developer notes appended to the description"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ item, intent, issueType, notes, ...t }) => {
      try {
        const [s] = await loadScreens(t);
        const it = item ? findItem(s, item) : undefined;
        return ok(draftTicket(s, it, cfg, { intent, issueType, extraNotes: notes }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  const linkName = (issue: JiraIssueRef) => [issue.key, issue.summary].filter(Boolean).join(" · ").slice(0, 100);

  async function linkToElement(fileKey: string, nodeId: string, issue: JiraIssueRef, force = false) {
    if (!force && !cfg.figma.linkDevResources) return { skipped: "figma.linkDevResources is off" };
    if (!fileKey) return { skipped: "no Figma file key (offline mode)" };
    const existing = await source.getDevResources(fileKey, [nodeId]).catch(() => []);
    const dup = existing.find((l) => l.url === issue.url);
    if (dup) return { linked: true, alreadyLinked: true, name: dup.name };
    try {
      const r = await source.addDevResource({ name: linkName(issue), url: issue.url, file_key: fileKey, node_id: nodeId });
      return { linked: true, name: r.name };
    } catch (e) {
      return { linked: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const needTracker = () => {
    if (!tracker) throw new Error("Jira is not configured. Set JIRA_BASE_URL (or jira.baseUrl in the config), JIRA_EMAIL and JIRA_API_TOKEN.");
    return tracker;
  };

  server.registerTool(
    "create_jira_ticket",
    {
      title: "Create Jira ticket from spec",
      description:
        "Create a Jira issue from an element's PM policy (same content as draft_jira_ticket) and link it to the element in Figma Dev Mode, so developers see the ticket when they inspect the element. Skips creation and returns the existing issue when an open issue with the same [ref] already exists, unless allowDuplicate is true. Show the draft to the user and get confirmation before calling this.",
      inputSchema: {
        ...target,
        item: z.number().int().positive().optional().describe("Element number; omit for a screen-level ticket"),
        intent: z.string().optional().describe("What the ticket is for, e.g. 'API integration'"),
        issueType: z.string().optional().describe("Jira issue type name, e.g. Task, Bug, 작업"),
        notes: z.string().optional().describe("Extra developer notes appended to the description"),
        projectKey: z.string().optional().describe("Jira project key; defaults to ticket.projectKey in the config"),
        parentKey: z.string().optional().describe("Parent / epic issue key; defaults to jira.parentKey in the config"),
        allowDuplicate: z.boolean().optional().describe("Create even if an open issue with the same [ref] exists"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ item, intent, issueType, notes, projectKey, parentKey, allowDuplicate, ...t }) => {
      try {
        const jira = needTracker();
        const project = projectKey ?? cfg.ticket.projectKey;
        if (!project) throw new Error("No Jira project key. Pass projectKey or set ticket.projectKey in the config.");
        const [s] = await loadScreens(t);
        const it = item ? findItem(s, item) : undefined;
        const draft = draftTicket(s, it, cfg, { intent, issueType, extraNotes: notes });
        const { fileKey } = resolve(t);
        const nodeId = it?.nodeId ?? s.nodeId;

        if (cfg.jira.dedupe && !allowDuplicate) {
          const ref = it?.ref ?? s.screenId;
          const existing = await jira.findOpenBySummary(project, s.screenId, `[${ref}]`);
          if (existing) {
            const figma = await linkToElement(fileKey, nodeId, existing);
            return ok({ created: false, reason: `An open issue for [${ref}] already exists.`, issue: existing, figma, hint: "Pass allowDuplicate: true to create another one." });
          }
        }

        const issue = await jira.createIssue({
          projectKey: project,
          summary: draft.summary,
          issueType: draft.issueType,
          labels: draft.labels,
          description: draft.description,
          parentKey: parentKey ?? cfg.jira.parentKey,
          extraFields: cfg.jira.extraFields,
        });
        const figma = await linkToElement(fileKey, nodeId, issue);
        return ok({ created: true, issue, figma, acceptanceCriteria: draft.acceptanceCriteria, missingPolicy: draft.missingPolicy });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "link_jira_issue",
    {
      title: "Link a Jira issue to an element",
      description:
        "Attach an existing Jira issue to an element (ITEM n) of a screen spec as a Figma Dev Resource, so it shows up in Dev Mode next to the element. Pass issueKey (needs Jira configured) or issueUrl.",
      inputSchema: {
        ...target,
        item: z.number().int().positive().describe("Element number shown on the badge"),
        issueKey: z.string().optional().describe("Jira issue key, e.g. DEMO-128"),
        issueUrl: z.string().url().optional().describe("Issue URL, if Jira isn't configured"),
        title: z.string().optional().describe("Link title when using issueUrl"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ item, issueKey, issueUrl, title, ...t }) => {
      try {
        if (!issueKey && !issueUrl) throw new Error("Pass issueKey or issueUrl.");
        const [s] = await loadScreens(t);
        const it = findItem(s, item);
        const { fileKey } = resolve(t);
        if (!fileKey) throw new Error("A Figma file key is required to link (pass url or fileKey).");
        const issue: JiraIssueRef = issueKey
          ? await needTracker().getIssue(issueKey)
          : { key: title ?? issueUrl!.split("/").filter(Boolean).pop() ?? "link", url: issueUrl! };
        const figma = await linkToElement(fileKey, it.nodeId, issue, true);
        if (!("linked" in figma) || !figma.linked) throw new Error(("error" in figma && figma.error) || "Link was not created.");
        return ok({ element: it.ref, issue, figma });
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
