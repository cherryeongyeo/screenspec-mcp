/**
 * Jira issues → Feedback Log rows (one way: Jira → Figma).
 * The same row shape feeds the get_jira_feedback tool and the Figma plugin's Sync button.
 */

export type Tone = "red" | "blue" | "gray" | "orange" | "green" | "neutral";
export type Lang = "ko" | "en";

export interface SyncRow {
  /** Element ref from the "[C-02-1]" summary prefix, or "" when the issue doesn't name one */
  element: string;
  type: string;
  typeTone: Tone;
  jiraKey: string;
  url: string;
  /** "에픽: 장바구니" / "Epic: Cart" (or the parent key for sub-tasks) */
  epic?: string;
  /** Summary without the "[ref]" prefix */
  summary: string;
  lastComment?: string;
  /** "이개발 · 2026.09.24 · 댓글 2" */
  lastCommentMeta?: string;
  /** "김기획 → 이개발" */
  flow: string;
  status: string;
  statusTone: Tone;
  /** "v1.2.0", or "—" */
  fixVersion: string;
}

export interface JiraUser { displayName?: string }
export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status?: { name: string; statusCategory?: { key?: string } };
    issuetype?: { name: string; subtask?: boolean };
    assignee?: JiraUser | null;
    reporter?: JiraUser | null;
    parent?: { key: string; fields?: { summary?: string; issuetype?: { name?: string; hierarchyLevel?: number } } };
    fixVersions?: { name: string }[];
    labels?: string[];
    comment?: { total?: number; comments?: { author?: JiraUser; created?: string; body?: unknown }[] };
  };
}

interface AdfNode { type?: string; text?: string; content?: AdfNode[]; attrs?: Record<string, unknown> }

/** Plain text from an Atlassian Document Format body (or a plain string). */
export function adfToText(body: unknown): string {
  if (typeof body === "string") return body;
  const out: string[] = [];
  const walk = (n: AdfNode | undefined) => {
    if (!n) return;
    if (n.type === "text" && n.text) out.push(n.text);
    else if (n.type === "mention") out.push(String(n.attrs?.text ?? ""));
    else if (n.type === "hardBreak") out.push(" ");
    n.content?.forEach(walk);
    if (n.type === "paragraph" || n.type === "listItem" || n.type === "heading") out.push(" ");
  };
  walk(body as AdfNode);
  return out.join("").replace(/\s+/g, " ").trim();
}

const STR = {
  ko: { epic: "에픽", parent: "상위", comments: (n: number) => `댓글 ${n}`, unassigned: "미배정", unknown: "알 수 없음" },
  en: { epic: "Epic", parent: "Parent", comments: (n: number) => `${n} comment${n === 1 ? "" : "s"}`, unassigned: "Unassigned", unknown: "Unknown" },
};

/** Tones match the template's legend; unknown names fall back to the Jira status category. */
const STATUS_TONES: Record<string, Tone> = {
  미해결: "gray", 진행중: "orange", 작업완료: "green", 검수요청: "blue", 검수중: "blue", 수정요청: "red", 검수완료: "green", 종료: "green", 보류: "neutral",
  "to do": "gray", "in progress": "orange", done: "green", "review requested": "blue", "in review": "blue",
  "changes requested": "red", approved: "green", closed: "green", "on hold": "neutral",
};
const CATEGORY_TONES: Record<string, Tone> = { new: "gray", indeterminate: "orange", done: "green" };

export function statusTone(name: string, category?: string): Tone {
  return STATUS_TONES[name.trim().toLowerCase()] ?? STATUS_TONES[name.trim()] ?? CATEGORY_TONES[category ?? ""] ?? "gray";
}

export function typeTone(name: string, subtask?: boolean): Tone {
  if (subtask || /sub-?task|하위/i.test(name)) return "gray";
  if (/bug|버그/i.test(name)) return "red";
  return "blue";
}

const dateOf = (iso?: string) => (iso ? iso.slice(0, 10).replace(/-/g, ".") : "");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export function toSyncRow(issue: JiraIssue, lang: Lang, browseUrl: (key: string) => string): SyncRow {
  const S = STR[lang];
  const f = issue.fields;
  const ref = /^\s*\[([^\]]+)\]\s*/.exec(f.summary);
  const type = f.issuetype?.name ?? "";
  const status = f.status?.name ?? "";

  let epic: string | undefined;
  if (f.parent) {
    const isEpic = /epic|에픽/i.test(f.parent.fields?.issuetype?.name ?? "") || f.parent.fields?.issuetype?.hierarchyLevel === 1;
    epic = isEpic && f.parent.fields?.summary ? `${S.epic}: ${f.parent.fields.summary}` : `${S.parent}: ${f.parent.key}`;
  }

  const comments = f.comment?.comments ?? [];
  const last = comments.at(-1);
  const total = f.comment?.total ?? comments.length;
  const text = last ? clip(adfToText(last.body), 120) : "";

  return {
    element: ref ? ref[1] : "",
    type,
    typeTone: typeTone(type, f.issuetype?.subtask),
    jiraKey: issue.key,
    url: browseUrl(issue.key),
    epic,
    summary: ref ? f.summary.slice(ref[0].length) : f.summary,
    ...(text
      ? { lastComment: text, lastCommentMeta: [last?.author?.displayName, dateOf(last?.created), S.comments(total)].filter(Boolean).join(" · ") }
      : {}),
    flow: `${f.reporter?.displayName ?? S.unknown} → ${f.assignee?.displayName ?? S.unassigned}`,
    status,
    statusTone: statusTone(status, f.status?.statusCategory?.key),
    fixVersion: f.fixVersions?.length ? f.fixVersions.map((v) => v.name).join(", ") : "—",
  };
}

/** Does this issue belong to the screen? Label, "[C-02-…]" summary prefix, or an explicit key. */
export function belongsTo(issue: JiraIssue, screenId: string, keys: string[] = []): boolean {
  if (keys.includes(issue.key)) return true;
  if (issue.fields.labels?.includes(screenId)) return true;
  const ref = /^\s*\[([^\]]+)\]/.exec(issue.fields.summary)?.[1] ?? "";
  return ref === screenId || ref.startsWith(`${screenId}-`);
}

/** Order rows by element number, then key, so the table reads like the spec. */
export function sortRows(rows: SyncRow[]): SyncRow[] {
  const num = (r: SyncRow) => Number(/-(\d+)$/.exec(r.element)?.[1] ?? 9999);
  const keyNum = (k: string) => Number(/-(\d+)$/.exec(k)?.[1] ?? 0);
  return [...rows].sort((a, b) => num(a) - num(b) || keyNum(a.jiraKey) - keyNum(b.jiraKey));
}

export interface FeedbackSource {
  searchFeedback(screenId: string, opts?: { projectKey?: string; keys?: string[]; lang?: Lang }): Promise<SyncRow[]>;
}

export interface FeedbackChanges {
  added: string[];
  updated: { key: string; fields: { field: string; figma: string; jira: string }[] }[];
  /** In the Figma table but not returned by Jira (deleted, moved, or label removed) */
  notInJira: string[];
  unchanged: boolean;
}

interface FigmaFeedbackRow { jiraKey: string; type: string; summary: string; status: string; flow?: string; fixVersion?: string; lastComment?: string }

/** What a Sync would change in the Figma Feedback Log. */
export function compareFeedback(figma: FigmaFeedbackRow[], jira: SyncRow[]): FeedbackChanges {
  const norm = (s?: string) => (s ?? "").replace(/\s+/g, " ").replace(/^[“"]|[”"]$/g, "").trim();
  const inFigma = new Map(figma.map((r) => [r.jiraKey, r]));
  const keys = new Set(jira.map((r) => r.jiraKey));
  const added = jira.filter((r) => !inFigma.has(r.jiraKey)).map((r) => r.jiraKey);
  const updated: FeedbackChanges["updated"] = [];
  for (const j of jira) {
    const f = inFigma.get(j.jiraKey);
    if (!f) continue;
    const pairs: [string, string | undefined, string | undefined][] = [
      ["type", f.type, j.type], ["summary", f.summary, j.summary], ["status", f.status, j.status],
      ["flow", f.flow, j.flow], ["fixVersion", f.fixVersion, j.fixVersion], ["lastComment", f.lastComment, j.lastComment],
    ];
    const fields = pairs.filter(([, a, b]) => norm(a) !== norm(b)).map(([field, a, b]) => ({ field, figma: norm(a), jira: norm(b) }));
    if (fields.length) updated.push({ key: j.jiraKey, fields });
  }
  const notInJira = figma.map((r) => r.jiraKey).filter((k) => !keys.has(k));
  return { added, updated, notInJira, unchanged: !added.length && !updated.length };
}
