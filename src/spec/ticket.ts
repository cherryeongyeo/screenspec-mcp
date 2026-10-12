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

function stateList(text: string): string[] {
  return text.split(/\s*[/,·]\s*/).map((s) => s.trim()).filter(Boolean);
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
  const pm = item?.pm ?? [];
  const ref = item?.ref ?? s.screenId;
  const name = item?.name ?? s.title;
  const intent = opts.intent ?? "구현";
  const link = item ? s.figmaUrl?.replace(/node-id=[^&]+/, `node-id=${item.nodeId.replace(":", "-")}`) : s.figmaUrl;

  const background = [...s.overview.filter((f) => f.filled), ...pick(pm, sec.background)];
  const scope = pick(pm, sec.scope);
  const policy = pick(pm, sec.policy);
  const states = pick(pm, sec.states);
  const exceptions = pick(pm, sec.exceptions);

  const ac: string[] = [
    ...states.flatMap((f) => stateList(f.value).map((st) => `${st} 상태가 정의대로 표시된다`)),
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
  md.push(`> 화면: ${s.screenId} ${s.title}${item ? ` · 요소 ${item.no}. ${item.name}` : ""} (정의서 ${s.version || "-"})`, "");
  section("배경 / 목적", background);
  section("구현 범위", scope);
  section("정책", policy);
  section("상태", states);
  section("예외 처리", exceptions);
  if (ac.length) {
    md.push("## 완료 조건");
    ac.forEach((a) => md.push(`- [ ] ${a}`));
    md.push("");
  }
  const design = (item?.design ?? []).filter((f) => f.filled);
  if (design.length) {
    md.push("## 디자인 참고");
    design.forEach((f) => md.push(`- ${f.label}: ${f.value}`));
    md.push("");
  }
  if (relatedFb.length) {
    md.push("## 열린 피드백");
    relatedFb.forEach((fb) => md.push(`- ${fb.jiraKey} (${fb.status}) ${fb.summary}`));
    md.push("");
  }
  if (opts.extraNotes) md.push("## 메모", opts.extraNotes, "");
  if (link) md.push(`[Figma에서 보기](${link})`);

  const labels = [...new Set([s.screenId, ...cfg.ticket.labels].filter(Boolean))];

  return {
    summary: fill(cfg.ticket.summaryTemplate, { screenId: s.screenId, ref, itemName: name, intent }),
    issueType: opts.issueType ?? cfg.ticket.defaultIssueType,
    projectKey: cfg.ticket.projectKey,
    labels,
    description: md.join("\n").trim(),
    acceptanceCriteria: ac,
    missingPolicy: pm.filter((f) => !f.filled).map((f) => f.label),
    figmaUrl: link,
  };
}
