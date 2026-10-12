import { detectLang } from "./ticket.js";
import type { Field, ScreenSpec, SpecItem } from "./types.js";

export interface FieldChange {
  side: "overview" | "pm" | "design";
  label: string;
  before: string;
  after: string;
}

export interface ItemChange {
  ref: string;
  no: number;
  name: string;
  /** previous name when the element was renamed */
  renamedFrom?: string;
  changes: FieldChange[];
}

export interface SpecDiff {
  screenId: string;
  title: string;
  from: { version: string; status: string };
  to: { version: string; status: string };
  header: { field: string; before: string; after: string }[];
  overview: FieldChange[];
  added: { ref: string; no: number; name: string }[];
  removed: { ref: string; no: number; name: string }[];
  changed: ItemChange[];
  /** Elements whose PM policy changed. Their tickets may need updating. */
  policyChanged: string[];
  unchanged: boolean;
  suggestedChangeLog?: { version: string; role: string; change: string };
}

/** Value used for comparison: unfilled template text counts as empty. */
const val = (f?: Field) => (f && f.filled ? f.value.trim() : "");

function diffFields(side: FieldChange["side"], before: Field[], after: Field[]): FieldChange[] {
  const labels = [...new Set([...before, ...after].map((f) => f.label))];
  const out: FieldChange[] = [];
  for (const label of labels) {
    const b = val(before.find((f) => f.label === label));
    const a = val(after.find((f) => f.label === label));
    if (a !== b) out.push({ side, label, before: b, after: a });
  }
  return out;
}

/** "v1.2" → "v1.3"; anything unparsable gets " (next)". */
export function bumpVersion(v: string): string {
  const m = /^(v?)(\d+)\.(\d+)(.*)$/.exec(v.trim());
  return m ? `${m[1]}${m[2]}.${Number(m[3]) + 1}` : v ? `${v} (next)` : "v1.0";
}

export function diffScreens(before: ScreenSpec, after: ScreenSpec): SpecDiff {
  const header = (["title", "summary", "version", "status"] as const)
    .filter((k) => (before[k] ?? "") !== (after[k] ?? ""))
    .map((k) => ({ field: k, before: before[k] ?? "", after: after[k] ?? "" }));

  const byNo = (items: SpecItem[]) => new Map(items.map((i) => [i.no, i]));
  const b = byNo(before.items);
  const a = byNo(after.items);

  const added = after.items.filter((i) => !b.has(i.no)).map(({ ref, no, name }) => ({ ref, no, name }));
  const removed = before.items.filter((i) => !a.has(i.no)).map(({ ref, no, name }) => ({ ref, no, name }));
  const changed: ItemChange[] = [];
  for (const it of after.items) {
    const prev = b.get(it.no);
    if (!prev) continue;
    const changes = [...diffFields("pm", prev.pm, it.pm), ...diffFields("design", prev.design, it.design)];
    const renamed = prev.name !== it.name;
    if (changes.length || renamed) {
      changed.push({ ref: it.ref, no: it.no, name: it.name, ...(renamed ? { renamedFrom: prev.name } : {}), changes });
    }
  }
  const overview = diffFields("overview", before.overview, after.overview);
  const policyChanged = changed.filter((c) => c.changes.some((x) => x.side === "pm")).map((c) => c.ref);

  const unchanged = !header.length && !overview.length && !added.length && !removed.length && !changed.length;
  const diff: SpecDiff = {
    screenId: after.screenId,
    title: after.title,
    from: { version: before.version, status: before.status },
    to: { version: after.version, status: after.status },
    header, overview, added, removed, changed, policyChanged, unchanged,
  };
  if (!unchanged) diff.suggestedChangeLog = suggestChangeLog(after, diff);
  return diff;
}

function suggestChangeLog(s: ScreenSpec, d: SpecDiff): SpecDiff["suggestedChangeLog"] {
  const ko = detectLang(s) === "ko";
  const sides = new Set([
    ...d.changed.flatMap((c) => c.changes.map((x) => x.side)),
    ...(d.overview.length || d.added.length || d.removed.length ? ["pm" as const] : []),
  ]);
  const role = sides.has("pm") && sides.has("design") ? "PM/Design" : sides.has("design") ? "Design" : "PM";

  const parts: string[] = [];
  if (d.overview.length) parts.push(ko ? `화면 개요 수정(${d.overview.map((o) => o.label).join(", ")})` : `overview updated (${d.overview.map((o) => o.label).join(", ")})`);
  for (const c of d.changed) {
    const labels = c.changes.map((x) => x.label).join(", ");
    const rename = c.renamedFrom ? (ko ? `'${c.renamedFrom}'→'${c.name}' 이름 변경` : `renamed from '${c.renamedFrom}'`) : "";
    const what = [rename, labels && (ko ? `${labels} 수정` : `${labels} updated`)].filter(Boolean).join(", ");
    parts.push(ko ? `요소 ${c.no} ${c.name}: ${what}` : `element ${c.no} ${c.name}: ${what}`);
  }
  for (const x of d.added) parts.push(ko ? `요소 ${x.no} ${x.name} 추가` : `element ${x.no} ${x.name} added`);
  for (const x of d.removed) parts.push(ko ? `요소 ${x.no} ${x.name} 삭제` : `element ${x.no} ${x.name} removed`);

  // Bump from whichever is newer: the header chip or the last change log row.
  const base = s.changeLog.at(-1)?.version ?? s.version;
  const version = d.header.some((h) => h.field === "version") ? s.version : bumpVersion(base);
  const change = parts.join(ko ? " / " : "; ");
  return { version, role, change: ko ? change : change.charAt(0).toUpperCase() + change.slice(1) };
}
