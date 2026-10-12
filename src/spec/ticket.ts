import type { Config } from "../config.js";
import { refNumber } from "./parse.js";
import type { Field, ScreenSpec, SpecItem } from "./types.js";

export interface TicketDraft {
  summary: string;
  issueType: string;
  projectKey?: string;
  labels: string[];
  /** Markdown body, ready to paste into Jira or pass to an Atlassian MCP */
  description: string;
  /** Acceptance criteria derived from PM policy */
  acceptanceCriteria: string[];
  /** PM fields that were empty — the developer should confirm these with PM */
  missingPolicy: string[];
  figmaUrl?: string;
}

const pick = (fields: Field[], labels: string[]) =>
  fields.filter((f) => labels.includes(f.label) && f.filled);

/** Split a policy paragraph into checklist-sized statements. */
export function splitStatements(text: string): string[] {
  return text
    .split(/\n|•|(?<=[.。])\s+|;\s*/)
    .map((s) => s.replace(/^[-–·\s]+/, "").replace(/[.。]\s*$/, "").trim())
    .filter((s) => s.length > 0);
}

/** Split "Default / Empty (no items) / Disabled (min · max)" on / , · — but not inside parentheses. */
export function stateList(text: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of text) {
    if (ch === "(" || ch === "（") depth++;
    if (ch === ")" || ch === "）") depth = Math.max(0, depth - 1);
    if (depth === 0 && "/,·".includes(ch)) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const STR = {
  ko: { intent: "구현", state: (st: string) => `${st} 상태가 정의대로 표시된다`, screen: "화면", element: "요소", spec: "정의서",
    bg: "배경 / 목적", scope: "구현 범위", policy: "정책", states: "상태", exc: "예외 처리", ac: "완료 조건", design: "디자인 참고",
    fb: "열린 피드백", notes: "메모", link: "Figma에서 보기", type: "작업" },
  en: { intent: "implementation", state: (st: string) => `${st} state is shown as specified`, screen: "Screen", element: "Element", spec: "spec",
    bg: "Background", scope: "Scope", policy: "Policy", states: "States", exc: "Edge cases", ac: "Acceptance criteria", design: "Design reference",
    fb: "Open feedback", notes: "Notes", link: "Open in Figma", type: "Task" },
};

/** English when the spec uses the English template (no Hangul in field labels). */
export function detectLang(s: ScreenSpec): "ko" | "en" {
  const labels = [...s.overview, ...s.items.flatMap((i) => i.pm)].map((f) => f.label).join(" ");
  return /[가-힣]/.test(labels) ? "ko" : "en";
}

function fill(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "").replace(/\s+/g, " ").trim();
}

export function draftTicket(
  s: ScreenSpec,
  item: SpecItem | undefined,
  cfg: Config,
  opts: { intent?: string; issueType?: string; extraNotes?: string } = {},
): TicketDraft {
  const sec = cfg.ticket.sections;
  const lang = detectLang(s);
  const t = STR[lang];
  const pm = item?.pm ?? [];
  const ref = item?.ref ?? s.screenId;
  const name = item?.name ?? s.title;
  const intent = opts.intent ?? t.intent;
  const link = item ? s.figmaUrl?.replace(/node-id=[^&]+/, `node-id=${item.nodeId.replace(":", "-")}`) : s.figmaUrl;

  const background = [...s.overview.filter((f) => f.filled), ...pick(pm, sec.background)];
  const scope = pick(pm, sec.scope);
  const policy = pick(pm, sec.policy);
  const states = pick(pm, sec.states);
  const exceptions = pick(pm, sec.exceptions);

  const ac: string[] = [
    ...states.flatMap((f) => stateList(f.value).map(t.state)),
    ...policy.flatMap((f) => splitStatements(f.value)),
    ...exceptions.flatMap((f) => splitStatements(f.value)),
  ];

  const relatedFb = item
    ? s.feedback.filter(
        (fb) => refNumber(fb.element, s.screenId) === item.no && !cfg.feedback.doneStatuses.includes(fb.status),
      )
    : s.feedback.filter((fb) => !cfg.feedback.doneStatuses.includes(fb.status));

  const md: string[] = [];
  const section = (title: string, fields: Field[]) => {
    if (!fields.length) return;
    md.push(`## ${title}`);
    fields.forEach((f) => md.push(`**${f.label}**: ${f.value}`));
    md.push("");
  };
  md.push(`> ${t.screen}: ${s.screenId} ${s.title}${item ? ` · ${t.element} ${item.no}. ${item.name}` : ""} (${t.spec} ${s.version || "-"})`, "");
  section(t.bg, background);
  section(t.scope, scope);
  section(t.policy, policy);
  section(t.states, states);
  section(t.exc, exceptions);
  if (ac.length) {
    md.push(`## ${t.ac}`);
    ac.forEach((a) => md.push(`- [ ] ${a}`));
    md.push("");
  }
  const design = (item?.design ?? []).filter((f) => f.filled);
  if (design.length) {
    md.push(`## ${t.design}`);
    design.forEach((f) => md.push(`- ${f.label}: ${f.value}`));
    md.push("");
  }
  if (relatedFb.length) {
    md.push(`## ${t.fb}`);
    relatedFb.forEach((fb) => md.push(`- ${fb.jiraKey} (${fb.status}) ${fb.summary}`));
    md.push("");
  }
  if (opts.extraNotes) md.push(`## ${t.notes}`, opts.extraNotes, "");
  if (link) md.push(`[${t.link}](${link})`);

  const labels = [...new Set([s.screenId, ...cfg.ticket.labels].filter(Boolean))];

  return {
    summary: fill(cfg.ticket.summaryTemplate, { screenId: s.screenId, ref, itemName: name, intent }),
    issueType: opts.issueType ?? (lang === "en" && cfg.ticket.defaultIssueType === "작업" ? t.type : cfg.ticket.defaultIssueType),
    projectKey: cfg.ticket.projectKey,
    labels,
    description: md.join("\n").trim(),
    acceptanceCriteria: ac,
    missingPolicy: pm.filter((f) => !f.filled).map((f) => f.label),
    figmaUrl: link,
  };
}
