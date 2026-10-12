import type { Config } from "../config.js";
import { refNumber } from "./parse.js";
import type { ScreenSpec } from "./types.js";

export type Level = "error" | "warn" | "info";
export interface LintIssue {
  level: Level;
  where: string;
  message: string;
  nodeId?: string;
}

export interface LintReport {
  screenId: string;
  title: string;
  completeness: { pm: number; design: number };
  counts: Record<Level, number>;
  issues: LintIssue[];
}

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 100));

export function lintScreen(s: ScreenSpec, cfg: Config): LintReport {
  const issues: LintIssue[] = [];
  const add = (level: Level, where: string, message: string, nodeId?: string) =>
    issues.push({ level, where, message, nodeId });

  // header
  if (s.isTemplate) add("error", "header", "화면ID가 비어 있거나 템플릿 값([화면ID]) 그대로입니다.", s.nodeId);
  if (!s.summary) add("warn", "header", "화면 한 줄 설명이 작성되지 않았습니다.", s.nodeId);
  if (!s.version) add("warn", "header", "버전 칩(v1.0 등)을 찾지 못했습니다.", s.nodeId);
  for (const f of s.overview) if (!f.filled) add("error", "overview", `화면 개요 · '${f.label}' 미작성`, s.nodeId);

  // items
  if (s.items.length === 0) add("error", "items", "요소 카드(ITEM / n / 요소명)가 없습니다.", s.nodeId);
  const seen = new Set<number>();
  s.items.forEach((it, i) => {
    if (seen.has(it.no)) add("error", it.ref, `요소 번호 ${it.no}가 중복됩니다.`, it.nodeId);
    seen.add(it.no);
    const prev = s.items[i - 1];
    if (prev && it.no > prev.no + 1)
      add("warn", it.ref, `요소 번호가 ${s.items[i - 1].no} 다음 ${it.no}로 건너뜁니다. 시안 뱃지와 맞는지 확인하세요.`, it.nodeId);
    if (!it.name || cfg.placeholders.includes(it.name)) add("error", it.ref, "요소명이 템플릿 값 그대로입니다.", it.nodeId);
    const pmMissing = it.pm.filter((f) => !f.filled).map((f) => f.label);
    const dsMissing = it.design.filter((f) => !f.filled).map((f) => f.label);
    if (pmMissing.length) add("error", it.ref, `PM 정책 미작성: ${pmMissing.join(", ")}`, it.nodeId);
    if (dsMissing.length) add("warn", it.ref, `Design 스펙 미작성: ${dsMissing.join(", ")}`, it.nodeId);
  });

  // feedback ↔ items
  const itemNos = new Set(s.items.map((i) => i.no));
  for (const fb of s.feedback) {
    if (!fb.element.startsWith(s.screenId))
      add("warn", fb.jiraKey, `피드백 요소 '${fb.element}'가 이 화면ID(${s.screenId})와 다릅니다.`, fb.nodeId);
    const n = refNumber(fb.element, s.screenId);
    if (n !== undefined && !itemNos.has(n))
      add("info", fb.jiraKey, `피드백이 가리키는 요소 ${fb.element}에 해당하는 요소 카드가 없습니다.`, fb.nodeId);
  }

  // change log
  const last = s.changeLog.at(-1);
  if (!last) add("warn", "changeLog", "Change Log가 비어 있습니다.", s.nodeId);
  else {
    if (s.version && last.version !== s.version)
      add("warn", "changeLog", `헤더 버전(${s.version})과 마지막 Change Log 버전(${last.version})이 다릅니다.`, s.nodeId);
    s.changeLog.forEach((r) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) add("info", "changeLog", `${r.version} 날짜가 비어 있거나 형식(YYYY-MM-DD)이 다릅니다.`, s.nodeId);
    });
  }

  const pmAll = s.items.flatMap((i) => i.pm);
  const dsAll = s.items.flatMap((i) => i.design);
  const counts = { error: 0, warn: 0, info: 0 } as Record<Level, number>;
  issues.forEach((i) => counts[i.level]++);

  return {
    screenId: s.screenId,
    title: s.title,
    completeness: {
      pm: pct(pmAll.filter((f) => f.filled).length, pmAll.length),
      design: pct(dsAll.filter((f) => f.filled).length, dsAll.length),
    },
    counts,
    issues,
  };
}
