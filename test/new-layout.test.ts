import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG as cfg } from "../src/config.js";
import { lintScreen } from "../src/spec/lint.js";
import { findBadges, regionFor } from "../src/spec/mockup.js";
import { findScreenDocs, nameParts, parseScreen } from "../src/spec/parse.js";
import { draftTicket } from "../src/spec/ticket.js";
import { cartMockup, specDoc } from "./fixtures/new-layout.js";

const parse = (lang: "ko" | "en", filled: boolean) => {
  const docs = findScreenDocs({ id: "0:0", name: "page", type: "CANVAS", children: [specDoc(lang, filled)] }, cfg);
  expect(docs).toHaveLength(1);
  return parseScreen(docs[0], cfg);
};

describe("current template layout (spec/row instances)", () => {
  const ko = parse("ko", true);

  it("reads the header from the id frame and the status chip label", () => {
    expect(ko).toMatchObject({ screenId: "C-02", title: "장바구니 목록", version: "v1.2", status: "검토중", isTemplate: false });
  });

  it("reads overview rows and uses the 작성 variant for unfilled lines", () => {
    expect(ko.overview.map((f) => [f.label, f.filled])).toEqual([["화면 목적", true], ["진입 경로", true], ["화면 설명", true], ["화면 흐름 / 이벤트", false]]);
  });

  it("reads element cards named `요소 / C-02-1 name`", () => {
    expect(ko.items.map((i) => [i.no, i.ref, i.name])).toEqual([[1, "C-02-1", "상품 리스트"], [2, "C-02-2", "수량 변경"]]);
    expect(ko.items[0].pm.map((f) => f.label)).toEqual(["기능", "콘텐츠", "동작", "상태", "정책", "예외"]);
    expect(ko.items[0].design.find((f) => f.label === "모션")).toMatchObject({ filled: false });
    expect(ko.items[1].design.every((f) => !f.filled)).toBe(true);
  });

  it("reads feedback and change log rows", () => {
    expect(ko.feedback.map((r) => r.jiraKey)).toEqual(["DEMO-128", "DEMO-131", "DEMO-119"]);
    expect(ko.feedback[1].lastComment).toBeUndefined();
    expect(ko.feedbackLastSynced).toBe("최종 동기화 2026.10.12 10:30");
    expect(ko.changeLog.map((r) => r.version)).toEqual(["v1.0", "v1.1", "v1.2"]);
    expect(ko.changeLog[2]).toMatchObject({ role: "PM", author: "@김기획" });
  });

  it("lints and drafts tickets from Korean labels", () => {
    const r = lintScreen(ko, cfg);
    expect(r.completeness.design).toBeLessThan(100);
    expect(r.issues.some((i) => i.message.includes("모션"))).toBe(true);
    const t = draftTicket(ko, ko.items[0], cfg);
    expect(t.description).toContain("최대 100개까지");
    expect(t.acceptanceCriteria.length).toBeGreaterThan(2);
  });

  it("treats the blank templates as templates, in both languages", () => {
    for (const lang of ["ko", "en"] as const) {
      const s = parse(lang, false);
      expect(s.isTemplate).toBe(true);
      expect(s.items).toHaveLength(1);
      expect(s.items[0].pm.every((f) => !f.filled)).toBe(true);
    }
  });

  it("reads the English sample", () => {
    const en = parse("en", true);
    expect(en).toMatchObject({ screenId: "C-02", status: "In review", version: "v1.2" });
    expect(en.items[0].pm.map((f) => f.label)).toContain("Policy");
    expect(draftTicket(en, en.items[0], cfg).summary).toMatch(/^\[C-02-1\] Item list/);
  });
});

describe("screen ID from the frame name", () => {
  it("keeps bracketed template IDs, with or without spaces", () => {
    expect(nameParts("📄 [화면ID] 화면명 · 화면정의서")?.slice(1)).toEqual(["[화면ID]", "화면명"]);
    expect(nameParts("📄 [Screen ID] Screen name · Screen Spec")?.slice(1)).toEqual(["[Screen ID]", "Screen name"]);
    expect(nameParts("📄 C-02 Cart list · Screen Spec")?.slice(1)).toEqual(["C-02", "Cart list"]);
  });
});

describe("spec/badge on the mockup", () => {
  const mock = cartMockup();
  it("finds `spec/badge n` instances and their regions", () => {
    expect(findBadges(mock).map((b) => b.no)).toEqual([1, 2]);
    expect(regionFor(mock, 1)).toMatchObject({ source: "badge-node", nodeId: "21:40" });
    expect(regionFor(mock, 2)).toMatchObject({ source: "area", nodeId: "21:92" });
  });
});
