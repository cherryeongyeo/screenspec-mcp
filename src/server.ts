import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { markers, type Config } from "./config.js";
import { parseFigmaUrl, type FigmaSource } from "./figma/client.js";
import { lintScreen } from "./spec/lint.js";
import { figmaUrl, findScreenDocs, parseScreen, refNumber } from "./spec/parse.js";
import { draftTicket } from "./spec/ticket.js";
import type { FigmaNode, ScreenSpec } from "./spec/types.js";

export const VERSION = "0.1.0";

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

export function createServer(source: FigmaSource, cfg: Config) {
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
        "Return a single element (ITEM n) of a screen spec with its PM policy, Design spec, related Jira feedback and a rendered image URL of the element card.",
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
        return ok({
          screen: { screenId: s.screenId, title: s.title, version: s.version },
          ...it,
          feedback,
          imageUrl: (images as Record<string, string | null>)[it.nodeId] ?? null,
          figmaUrl: figmaUrl(fileKey || undefined, it.nodeId),
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

  return server;
}
