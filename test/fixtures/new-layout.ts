// Builds FigmaNode trees in the current template layout (spec/row instances, `요소 / C-02-1 name`
// cards, `id` header frame), mirroring an export of the Figma file. Content comes from i18n.json.
import { readFileSync } from "node:fs";
import type { FigmaNode } from "../../src/spec/types.js";

const i18n = JSON.parse(readFileSync(new URL("../../figma-template/i18n.json", import.meta.url), "utf8"));
type Lang = "ko" | "en";

let seq = 0;
const id = () => `9:${++seq}`;
const text = (characters: string, name = characters): FigmaNode => ({ id: id(), name, type: "TEXT", characters });
const frame = (name: string, children: FigmaNode[] = []): FigmaNode => ({ id: id(), name, type: "FRAME", children });

export function specDoc(lang: Lang, filled: boolean): FigmaNode {
  const L = i18n[lang];
  const S = L.sample;
  const sid = filled ? S.id : L.idPlaceholder;
  const title = filled ? S.title : L.titlePlaceholder;

  const row = (label: string, value: string | null, placeholder: string): FigmaNode => ({
    id: id(), name: L.row.name, type: "INSTANCE",
    componentProperties: {
      [`${L.row.label}#1:1`]: { type: "TEXT", value: label },
      [`${L.row.value}#1:2`]: { type: "TEXT", value: value ?? placeholder },
      [L.row.prop]: { type: "VARIANT", value: value == null ? L.row.values[0] : L.row.values[1] },
    },
    children: [text(label, L.row.label), text(value ?? placeholder, L.row.value)],
  });
  const status: FigmaNode = {
    id: id(), name: "Status Chip", type: "INSTANCE",
    componentProperties: { "Property 1": { type: "VARIANT", value: L.status.variant } },
    children: [{ id: id(), name: "dot", type: "ELLIPSE" }, text(filled ? S.status : L.status.modes[0], "label")],
  };
  const items = (filled ? S.items : [{ name: null, pm: [], design: [] }]).map((it: { name: string | null; pm: (string | null)[]; design: (string | null)[] }, i: number) => {
    const no = i + 1;
    const name = it.name ?? L.items.namePlaceholder;
    return frame(`${L.items.prefix} / ${sid}-${no} ${name}`, [
      frame("header", [
        { id: id(), name: L.badge.name, type: "INSTANCE", componentProperties: { [`${L.badge.prop}#1:0`]: { type: "TEXT", value: String(no) } }, children: [text(String(no), "number")] },
        text(name), frame("spacer"), frame("sync-link", [text(`${sid}-${no} ↗`)]),
      ]),
      frame("col head", [frame("Frame", [text(L.items.pmHead)]), frame("Frame", [text(L.items.designHead)])]),
      frame("body", [
        frame("PM", L.pmRows.map(([label, ph]: string[], j: number) => row(label, it.pm[j] ?? null, ph))),
        frame("Design", L.designRows.map(([label, ph]: string[], j: number) => row(label, it.design[j] ?? null, ph))),
      ]),
    ]);
  });
  const F = L.feedback;
  const fbRows = filled
    ? S.feedback.map(([el, type, key, epic, summary, comment, flow, st, ver]: [string, string, string, string, string, string[] | null, string, string, string]) =>
        frame(`row / ${key}`, [
          frame(`cell / ${F.cols[0]}`, [text(el)]), frame(`cell / ${F.cols[1]}`, [frame(`chip / ${type}`, [text(type)])]),
          frame(`cell / ${F.cols[2]}`, [text(`${key} ↗`), text(epic)]), frame(`cell / ${F.cols[3]}`, [text(summary)]),
          frame(`cell / ${F.cols[4]}`, comment ? comment.map((c) => text(c)) : [text(F.noComment)]),
          frame(`cell / ${F.cols[5]}`, [text(flow)]), frame(`cell / ${F.cols[6]}`, [frame(`chip / ${st}`, [text(st)])]),
          frame(`cell / ${F.cols[7]}`, [text(ver)]),
        ]))
    : [frame(F.exampleRowName, F.cols.map((c: string) => frame(`cell / ${c}`, [text("…")])))];
  const clRow = (r: string[]): FigmaNode => ({
    id: id(), name: L.changelogRow.name, type: "INSTANCE",
    componentProperties: Object.fromEntries(L.changelogRow.props.map((p: string, i: number) => [`${p}#2:${i}`, { type: "TEXT", value: r[i] }])),
    children: r.map((v, i) => text(v, L.changelogRow.props[i])),
  });

  return frame(`📄 ${sid} ${title} · ${L.marker}`, [
    frame("Doc Header", [frame("id", [status, text(sid), text(filled ? S.version : "v1.0")]), text(title), text(filled ? S.summary : L.summaryPlaceholder)]),
    frame(L.overview.layer, [
      frame("title", [text(L.overview.title), frame("spacer"), text(L.overview.note)]),
      frame(L.overview.table, L.overviewRows.map(([label, ph]: string[], i: number) => row(label, filled ? S.overview[i] : null, ph))),
    ]),
    frame(L.items.layer, [frame("title", [text(L.items.title), frame("spacer"), text(L.items.note)]), ...items]),
    frame("Feedback Log", [
      frame("title", [text(F.title), frame("sync-link", [text(F.sync)]), frame("spacer"), text(filled ? S.synced : F.synced, "last-synced")]),
      frame("feedback table", [frame("head", F.cols.map((c: string) => frame(`cell / ${c}`, [text(c)]))), ...fbRows]),
    ]),
    frame("Change Log", [
      frame("title", [text(L.changeLog.title), frame("spacer"), text(L.changeLog.note)]),
      frame(L.changeLog.layer, [frame("head", L.changeLog.cols.map((c: string) => text(c))), ...(filled ? S.changeLog : L.changeLog.rows).map(clRow)]),
    ]),
  ]);
}

/** The KOR C-02 mockup as exported (absolute boxes), with spec/badge instances. */
export function cartMockup(): FigmaNode {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const badge = (no: number, x: number, y: number): FigmaNode => ({
    id: id(), name: `spec/badge ${no}`, type: "INSTANCE", absoluteBoundingBox: box(x, y, 32, 32),
    componentProperties: { "번호#1:0": { type: "TEXT", value: String(no) } },
    children: [{ id: id(), name: "number", type: "TEXT", characters: String(no), absoluteBoundingBox: box(x + 12, y + 7, 8, 19) }],
  });
  return {
    id: "21:30", name: "C-02 장바구니 목록 · 시안", type: "FRAME", absoluteBoundingBox: box(2897, -3681, 375, 812),
    children: [
      { id: "21:31", name: "screen", type: "FRAME", absoluteBoundingBox: box(2897, -3681, 375, 812), children: [
        { id: "21:34", name: "body", type: "FRAME", absoluteBoundingBox: box(2897, -3590, 375, 588), children: [
          { id: "21:40", name: "item list", type: "FRAME", absoluteBoundingBox: box(2917, -3558, 335, 231), children: [
            { id: "21:51", name: "quantity stepper", type: "FRAME", absoluteBoundingBox: box(3151, -3472, 85, 27) },
          ] },
        ] },
      ] },
      badge(1, 2901, -3574),
      { id: "21:92", name: "area / 2", type: "RECTANGLE", absoluteBoundingBox: box(3147, -3476, 93, 35) },
      badge(2, 3131, -3492),
    ],
  };
}
