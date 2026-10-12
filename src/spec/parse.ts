import { markers, type Config } from "../config.js";
import type {
  ChangeLogRow,
  FeedbackRow,
  Field,
  FigmaNode,
  ScreenSpec,
  SpecItem,
} from "./types.js";

// ---------- tree helpers ----------

const kids = (n?: FigmaNode) => n?.children ?? [];

export function walk(n: FigmaNode, visit: (n: FigmaNode) => void) {
  visit(n);
  for (const c of kids(n)) walk(c, visit);
}

export function find(n: FigmaNode | undefined, pred: (n: FigmaNode) => boolean): FigmaNode | undefined {
  if (!n) return undefined;
  if (pred(n)) return n;
  for (const c of kids(n)) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return undefined;
}

const byName = (...names: string[]) => (n: FigmaNode) => names.includes(n.name);

/** Text of all TEXT descendants, in document order. */
export function texts(n: FigmaNode | undefined): string[] {
  const out: string[] = [];
  if (!n) return out;
  walk(n, (x) => {
    if (x.type === "TEXT") out.push(clean(x.characters ?? x.name));
  });
  return out;
}

const directTexts = (n?: FigmaNode) =>
  kids(n).filter((c) => c.type === "TEXT").map((c) => clean(c.characters ?? c.name));

const clean = (s: string) => s.replace(/[\u2028\u2029]/g, "\n").trim();
const stripArrow = (s: string) => s.replace(/\s*↗\s*$/, "").trim();

// ---------- section parsers ----------

/** `row / <label>` frames: first text = label, last text = value. */
function parseRows(container: FigmaNode | undefined, cfg: Config): Field[] {
  return kids(container)
    .filter((c) => /^row\s*\/\s*/.test(c.name))
    .map((row) => {
      const label = row.name.replace(/^row\s*\/\s*/, "").trim();
      const t = texts(row);
      const value = t.length > 1 ? t.slice(1).join("\n") : "";
      return { label, value, filled: isFilled(value, cfg) };
    });
}

export function isFilled(value: string, cfg: Config): boolean {
  const v = value.trim();
  return v.length > 0 && !cfg.placeholders.includes(v);
}

function parseItems(doc: FigmaNode, screenId: string, cfg: Config): SpecItem[] {
  const items: SpecItem[] = [];
  walk(doc, (n) => {
    const m = /^ITEM\s*\/\s*(\d+)/.exec(n.name);
    if (!m) return;
    const no = Number(m[1]);
    const titleBar = find(n, byName("TitleBar"));
    const name = directTexts(titleBar)[0] ?? n.name.split("/").pop()!.trim();
    items.push({
      no,
      ref: `${screenId}-${no}`,
      name,
      nodeId: n.id,
      pm: parseRows(find(n, byName("PM column")), cfg),
      design: parseRows(find(n, byName("Design column")), cfg),
    });
  });
  return items;
}

function parseFeedback(doc: FigmaNode, cfg: Config): FeedbackRow[] {
  const table = find(doc, byName("feedback table"));
  if (!table) return [];
  const head = find(table, byName("head"));
  const columns = kids(head).map((c) => {
    const label = texts(c)[0] ?? c.name.replace(/^cell\s*\/\s*/, "");
    return cfg.feedback.columns[label] ?? label;
  });

  return kids(table)
    .filter((r) => r.name.startsWith("row") && !/예시|example/i.test(r.name))
    .map((row) => {
      const cells = kids(row).map((c) => texts(c));
      const get = (key: string) => cells[columns.indexOf(key)] ?? [];
      const jira = get("jira");
      const comment = get("comment");
      const hasComment = comment.length > 0 && !/^(댓글 없음|No comments?)$/i.test(comment[0]);
      return {
        element: get("element")[0] ?? "",
        type: get("type")[0] ?? "",
        jiraKey: stripArrow(jira[0] ?? row.name.replace(/^row\s*\/\s*/, "")),
        epic: jira[1],
        summary: get("summary").join(" "),
        lastComment: hasComment ? comment[0].replace(/^[“"]|[”"]$/g, "") : undefined,
        lastCommentMeta: hasComment ? comment[1] : undefined,
        flow: get("flow")[0],
        status: get("status")[0] ?? "",
        fixVersion: get("fixVersion")[0],
        nodeId: row.id,
      };
    });
}

function parseChangeLog(doc: FigmaNode, cfg: Config): ChangeLogRow[] {
  const log = find(doc, byName("변경 이력", "Change history")) ?? find(doc, byName("Change Log"));
  return kids(log)
    .filter((r) => r.name === "row" || r.name.startsWith("row /"))
    .map((r) => {
      const [version = "", date = "", role = "", author = "", change = ""] = texts(r);
      return { version, date, role, author, change };
    })
    .filter((r) => [r.version, r.change].some((v) => isFilled(v, cfg)));
}

function parseStatus(header: FigmaNode | undefined): string {
  const inst = find(header, (n) => n.type === "INSTANCE" && (n.name === "상태" || /^status$/i.test(n.name))) ??
    find(header, (n) => n.type === "INSTANCE" && /status/i.test(n.name));
  if (!inst) return "";
  const variant = Object.values(inst.componentProperties ?? {}).find((p) => p.type === "VARIANT");
  if (variant) return String(variant.value);
  return (texts(inst)[0] ?? "").replace(/^[●•]\s*/, "");
}

// ---------- public API ----------

export function isScreenDoc(n: FigmaNode, cfg: Config): boolean {
  return (n.type === "FRAME" || n.type === "COMPONENT") &&
    markers(cfg).some((m) => n.name.includes(m)) &&
    !!find(n, byName("Doc Header"));
}

/** Every screen spec document inside `root` (root itself may be one). */
export function findScreenDocs(root: FigmaNode, cfg: Config): FigmaNode[] {
  const out: FigmaNode[] = [];
  const visit = (n: FigmaNode) => {
    if (isScreenDoc(n, cfg)) return void out.push(n);
    kids(n).forEach(visit);
  };
  visit(root);
  return out;
}

export function figmaUrl(fileKey: string | undefined, nodeId: string) {
  return fileKey ? `https://www.figma.com/design/${fileKey}?node-id=${nodeId.replace(":", "-")}` : undefined;
}

export function parseScreen(doc: FigmaNode, cfg: Config, fileKey?: string): ScreenSpec {
  const header = find(doc, byName("Doc Header"));
  const idChip = find(header, (n) => n.name.startsWith("chip / [") || n.name === "chip / id");
  const verChip = find(header, (n) => /^chip\s*\/\s*v\d/i.test(n.name));
  const fromName = /^\W*\s*(\S+)\s+(.+?)\s*·/.exec(doc.name);

  const screenId = texts(idChip)[0] ?? fromName?.[1] ?? "";
  const [title = fromName?.[2] ?? "", summary = ""] = directTexts(header);
  const owners = kids(find(header, byName("owners"))).map((c) => {
    const [role = "", name = ""] = (texts(c)[0] ?? "").split(/\s+(?=@)|\s+/, 2);
    return { role, name: name.replace(/^@/, "") };
  }).filter((o) => o.role && isFilled(`@${o.name}`, cfg) && o.name !== "담당자");

  const fbSection = find(doc, byName("Feedback Log"));
  const synced = find(fbSection, byName("last-synced"));
  const syncedText = synced ? texts(synced)[0] : undefined;

  return {
    screenId,
    title,
    summary: isFilled(summary, cfg) ? summary : "",
    version: texts(verChip)[0] ?? "",
    status: parseStatus(header),
    owners,
    nodeId: doc.id,
    figmaUrl: figmaUrl(fileKey, doc.id),
    isTemplate: !isFilled(screenId, cfg),
    overview: parseRows(find(doc, byName("개요", "Overview")), cfg),
    items: parseItems(doc, screenId, cfg).sort((a, b) => a.no - b.no),
    feedback: parseFeedback(doc, cfg),
    feedbackLastSynced: syncedText && syncedText !== "last-synced" ? syncedText : undefined,
    changeLog: parseChangeLog(doc, cfg),
  };
}

/** Element number from refs like "M-07-009", "M-07-1 ↗", "[M-07]-3". */
export function refNumber(ref: string, screenId: string): number | undefined {
  const r = stripArrow(ref).replace(/[[\]]/g, "");
  if (!r.startsWith(screenId)) return undefined;
  const m = /-(\d+)$/.exec(r.slice(screenId.length));
  return m ? Number(m[1]) : undefined;
}
