import type { Config } from "../config.js";
import { refNumber } from "./parse.js";
import { detectLang } from "./ticket.js";
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

const MSG = {
  ko: {
    template: "화면ID가 비어 있거나 템플릿 값 그대로입니다.",
    summary: "화면 한 줄 설명이 작성되지 않았습니다.",
    version: "버전 칩(v1.0 등)을 찾지 못했습니다.",
    statusMode: "상태 칩에 변수 모드가 따로 지정되어 프레임의 정의서 상태와 다르게 보입니다. 칩의 모드를 해제하세요.",
    overview: (l: string) => `화면 개요 · '${l}' 미작성`,
    noItems: "요소 카드(ITEM / n / 요소명)가 없습니다.",
    dupNo: (n: number) => `요소 번호 ${n}가 중복됩니다.`,
    gap: (a: number, b: number) => `요소 번호가 ${a} 다음 ${b}로 건너뜁니다. 시안 뱃지와 맞는지 확인하세요.`,
    itemName: "요소명이 템플릿 값 그대로입니다.",
    pm: (f: string) => `PM 정책 미작성: ${f}`,
    ds: (f: string) => `Design 스펙 미작성: ${f}`,
    fbScreen: (e: string, id: string) => `피드백 요소 '${e}'가 이 화면ID(${id})와 다릅니다.`,
    fbItem: (e: string) => `피드백이 가리키는 요소 ${e}에 해당하는 요소 카드가 없습니다.`,
    clEmpty: "Change Log가 비어 있습니다.",
    clVer: (h: string, l: string) => `헤더 버전(${h})과 마지막 Change Log 버전(${l})이 다릅니다.`,
    clDate: (v: string) => `${v} 날짜가 비어 있거나 형식(YYYY-MM-DD)이 다릅니다.`,
    noMockup: (id: string) => `'${id}'와 '시안'이 이름에 들어간 시안 프레임을 찾지 못했습니다. 요소별 시안 이미지를 쓰려면 프레임 이름을 맞춰 주세요.`,
    noBadge: (ref: string) => `${ref}: 시안 위에 같은 번호의 뱃지가 없습니다.`,
    orphanBadge: (n: number) => `시안의 뱃지 ${n}에 해당하는 요소 카드가 없습니다.`,
    dupBadge: (n: number) => `시안에 뱃지 ${n}이 여러 개 있습니다.`,
  },
  en: {
    template: "Screen ID is empty or still the template value.",
    summary: "One-line screen description is missing.",
    version: "Version chip (v1.0, …) not found.",
    statusMode: "The status chip pins its own variable mode, so it may not match the frame's spec status. Clear the chip's mode.",
    overview: (l: string) => `Screen overview · '${l}' not written`,
    noItems: "No element cards (ITEM / n / name) found.",
    dupNo: (n: number) => `Element number ${n} is duplicated.`,
    gap: (a: number, b: number) => `Element numbers skip from ${a} to ${b}. Check the mockup badges.`,
    itemName: "Element name is still the template value.",
    pm: (f: string) => `PM policy missing: ${f}`,
    ds: (f: string) => `Design spec missing: ${f}`,
    fbScreen: (e: string, id: string) => `Feedback element '${e}' doesn't belong to this screen (${id}).`,
    fbItem: (e: string) => `Feedback points to ${e}, but there is no such element card.`,
    clEmpty: "Change Log is empty.",
    clVer: (h: string, l: string) => `Header version (${h}) differs from the latest Change Log version (${l}).`,
    clDate: (v: string) => `${v}: date is empty or not YYYY-MM-DD.`,
    noMockup: (id: string) => `No mockup frame found with '${id}' and 'Mockup' in its name. Name it that way to get per-element mockup images.`,
    noBadge: (ref: string) => `${ref}: no badge with this number on the mockup.`,
    orphanBadge: (n: number) => `Badge ${n} on the mockup has no element card.`,
    dupBadge: (n: number) => `Badge ${n} appears more than once on the mockup.`,
  },
};

export function lintScreen(s: ScreenSpec, cfg: Config): LintReport {
  const issues: LintIssue[] = [];
  const add = (level: Level, where: string, message: string, nodeId?: string) =>
    issues.push({ level, where, message, nodeId });
  const M = MSG[detectLang(s)];

  // header
  if (s.isTemplate) add("error", "header", M.template, s.nodeId);
  if (!s.summary) add("warn", "header", M.summary, s.nodeId);
  if (!s.version) add("warn", "header", M.version, s.nodeId);
  if (s.statusModeConflict) add("warn", "header", M.statusMode, s.nodeId);
  for (const f of s.overview) if (!f.filled) add("error", "overview", M.overview(f.label), s.nodeId);

  // items
  if (s.items.length === 0) add("error", "items", M.noItems, s.nodeId);
  const seen = new Set<number>();
  s.items.forEach((it, i) => {
    if (seen.has(it.no)) add("error", it.ref, M.dupNo(it.no), it.nodeId);
    seen.add(it.no);
    const prev = s.items[i - 1];
    if (prev && it.no > prev.no + 1) add("warn", it.ref, M.gap(prev.no, it.no), it.nodeId);
    if (!it.name || cfg.placeholders.includes(it.name)) add("error", it.ref, M.itemName, it.nodeId);
    const pmMissing = it.pm.filter((f) => !f.filled).map((f) => f.label);
    const dsMissing = it.design.filter((f) => !f.filled).map((f) => f.label);
    if (pmMissing.length) add("error", it.ref, M.pm(pmMissing.join(", ")), it.nodeId);
    if (dsMissing.length) add("warn", it.ref, M.ds(dsMissing.join(", ")), it.nodeId);
  });

  // feedback ↔ items
  const itemNos = new Set(s.items.map((i) => i.no));
  for (const fb of s.feedback) {
    if (!fb.element.startsWith(s.screenId)) add("warn", fb.jiraKey, M.fbScreen(fb.element, s.screenId), fb.nodeId);
    const n = refNumber(fb.element, s.screenId);
    if (n !== undefined && !itemNos.has(n)) add("info", fb.jiraKey, M.fbItem(fb.element), fb.nodeId);
  }

  // change log
  const last = s.changeLog.at(-1);
  if (!last) add("warn", "changeLog", M.clEmpty, s.nodeId);
  else {
    if (s.version && last.version !== s.version) add("warn", "changeLog", M.clVer(s.version, last.version), s.nodeId);
    s.changeLog.forEach((r) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) add("info", "changeLog", M.clDate(r.version), s.nodeId);
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

/** Badges on the mockup(s) vs element cards in the spec (1:1). State screens may repeat badges across frames. */
export function lintMockup(s: ScreenSpec, mockup: { found: boolean; badges: { no: number; frameId: string }[] }): LintIssue[] {
  const M = MSG[detectLang(s)];
  if (!mockup.found) return [{ level: "info", where: "mockup", message: M.noMockup(s.screenId), nodeId: s.nodeId }];
  const issues: LintIssue[] = [];
  const nos = new Set(mockup.badges.map((b) => b.no));
  const perFrame = new Map<string, number>();
  mockup.badges.forEach((b) => perFrame.set(`${b.frameId}#${b.no}`, (perFrame.get(`${b.frameId}#${b.no}`) ?? 0) + 1));
  const itemNos = new Set(s.items.map((i) => i.no));
  for (const it of s.items) if (!nos.has(it.no)) issues.push({ level: "warn", where: it.ref, message: M.noBadge(it.ref), nodeId: it.nodeId });
  for (const n of [...nos].sort((a, b) => a - b)) if (!itemNos.has(n)) issues.push({ level: "warn", where: "mockup", message: M.orphanBadge(n) });
  const dups = new Set([...perFrame].filter(([, c]) => c > 1).map(([k]) => Number(k.split("#")[1])));
  for (const n of dups) issues.push({ level: "info", where: "mockup", message: M.dupBadge(n) });
  return issues;
}
