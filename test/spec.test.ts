import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG as cfg } from "../src/config.js";
import { parseFigmaUrl } from "../src/figma/client.js";
import { lintScreen } from "../src/spec/lint.js";
import { findScreenDocs, parseScreen, refNumber } from "../src/spec/parse.js";
import { draftTicket, splitStatements, stateList } from "../src/spec/ticket.js";

const json = JSON.parse(readFileSync(new URL("./fixtures/sample-section.json", import.meta.url), "utf8"));
const section = json.nodes["2914:18601"].document;
const docs = findScreenDocs(section, cfg);
const [template, m07] = docs.map((d) => parseScreen(d, cfg, "FILEKEY"));

describe("parse", () => {
  it("finds the template and the filled example", () => {
    expect(docs).toHaveLength(2);
    expect(template.isTemplate).toBe(true);
    expect(m07.isTemplate).toBe(false);
  });

  it("reads the header", () => {
    expect(m07.screenId).toBe("M-07");
    expect(m07.title).toBe("목차 패널");
    expect(m07.version).toBe("v1.0");
    expect(m07.status).toBe("작성중");
    expect(m07.figmaUrl).toBe("https://www.figma.com/design/FILEKEY?node-id=2956-18603");
  });

  it("reads elements with PM and Design fields", () => {
    expect(m07.items).toHaveLength(1);
    const it = m07.items[0];
    expect(it).toMatchObject({ no: 1, ref: "M-07-1", name: "목차 리스트" });
    expect(it.pm.map((f) => f.label)).toEqual(["기능", "콘텐츠", "Interaction", "State", "Policy", "Exception"]);
    expect(it.pm.every((f) => f.filled)).toBe(true);
    expect(it.design.find((f) => f.label === "Responsive")?.filled).toBe(false);
  });

  it("reads the feedback log and skips the example row", () => {
    expect(m07.feedback).toHaveLength(5);
    expect(m07.feedback[0]).toMatchObject({ element: "M-07-009", jiraKey: "DEMO-475", type: "버그", status: "종료", fixVersion: "v2.1.0" });
    expect(m07.feedback[2].lastComment).toBeUndefined();
    expect(template.feedback).toHaveLength(0);
  });

  it("drops empty change log rows", () => {
    expect(m07.changeLog.map((r) => r.version)).toEqual(["v1.0", "v1.1"]);
  });

  it("matches element refs", () => {
    expect(refNumber("M-07-009", "M-07")).toBe(9);
    expect(refNumber("M-07-1 ↗", "M-07")).toBe(1);
    expect(refNumber("M-07", "M-07")).toBeUndefined();
    expect(refNumber("D-02-1", "M-07")).toBeUndefined();
  });
});

describe("lint", () => {
  it("flags the untouched template", () => {
    const r = lintScreen(template, cfg);
    expect(r.counts.error).toBeGreaterThan(0);
    expect(r.completeness.pm).toBe(0);
  });

  it("reports partial completeness for the example", () => {
    const r = lintScreen(m07, cfg);
    expect(r.completeness.pm).toBe(100);
    expect(r.completeness.design).toBe(50);
    expect(r.issues.some((i) => i.message.includes("Design 스펙 미작성"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("M-07-009"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("v1.1"))).toBe(true);
  });
});

describe("ticket draft", () => {
  it("builds a ticket from PM policy", () => {
    const t = draftTicket(m07, m07.items[0], cfg, { intent: "API 연동" });
    expect(t.summary).toBe("[M-07-1] 목차 리스트 API 연동");
    expect(t.labels).toEqual(["M-07"]);
    expect(t.issueType).toBe("작업");
    expect(t.missingPolicy).toEqual([]);
    expect(t.acceptanceCriteria).toContain("Empty(기사 없음) 상태가 정의대로 표시된다");
    expect(t.acceptanceCriteria).toContain("목차 API 실패 시 재시도 버튼 노출");
    expect(t.description).toContain("## 완료 조건");
    expect(t.figmaUrl).toContain("node-id=2956-18656");
  });

  it("keeps parenthesised state details together", () => {
    expect(stateList("Default / Disabled (min · max quantity)")).toEqual(["Default", "Disabled (min · max quantity)"]);
    expect(stateList("Default / Disabled(최소·최대 수량)")).toEqual(["Default", "Disabled(최소·최대 수량)"]);
  });

  it("splits statements", () => {
    expect(splitStatements("A 정책. B 정책\n• C")).toEqual(["A 정책", "B 정책", "C"]);
  });
});

describe("url", () => {
  it("parses design and branch URLs", () => {
    expect(parseFigmaUrl("https://www.figma.com/design/abc123/Name?node-id=2914-18601&m=draw")).toEqual({ fileKey: "abc123", nodeId: "2914:18601" });
    expect(parseFigmaUrl("https://www.figma.com/design/abc/branch/br1/Name").fileKey).toBe("br1");
  });
});
