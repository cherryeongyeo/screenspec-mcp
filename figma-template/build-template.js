// Builds the screenspec Figma template on the current page:
// Components + writing guide, a blank template section, and a filled sample section.
// Run with the Figma Plugin API (e.g. via the Figma MCP `use_figma` tool).
// `L` is one language block from i18n.json, injected by scripts/render-template.mjs.
// `OPTS` may set { x, y } (where to start) and { sampleMockupId } (an existing mockup frame
// to move into the sample section).
const L = __LANG__;
const OPTS = __OPTS__;

const FONT = "Inter";
await Promise.all(["Regular", "Medium", "Semi Bold", "Bold"].map((style) => figma.loadFontAsync({ family: FONT, style })));

// ---------- tokens ----------
const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const solid = (h) => [{ type: "SOLID", color: hex(h) }];
const K = {
  ink: "#1a1a1a", sub: "#777777", disable: "#b7b7b7", body: "#383838", line: "#e8e8e8", headBg: "#f5f5f5", soft: "#f7f8fa",
  pmBg: "#f1f5ff", pmFg: "#5984ff", dsBg: "#f4fae9", dsFg: "#6e9e3a", accent: "#0e4dff", link: "#0185e9",
  badge: "#eb0000", mockLine: "#dfdfdf", compLine: "#8a38f5",
};
const TONE = {
  red: ["#fdebeb", "#e53030"], blue: ["#ebf1fd", "#3a6ce8"], gray: ["#eef0f3", "#5a606e"], orange: ["#fdf2e6", "#e67814"],
  green: ["#e7f6f0", "#10966e"], neutral: ["#eeeeee", "#787878"],
};
const STATUS_CHIP = ["#121c37", "#e8a91b", "#008c1e"];
const STATUS_SECTION = ["#f2f3f6", "#fff9e9", "#f3f7f4"];
const toneOf = (list, label) => TONE[(list.find((x) => x[0] === label) || [0, "gray"])[1]];
const created = [];

// ---------- primitives ----------
function T(parent, chars, o = {}) {
  const t = figma.createText();
  t.fontName = { family: FONT, style: o.fw || "Regular" };
  t.characters = chars;
  t.fontSize = o.fs || 13;
  t.lineHeight = o.lh === "auto" ? { unit: "AUTO" } : { unit: "PERCENT", value: 150 };
  t.fills = solid(o.color || K.ink);
  t.name = o.name || chars.slice(0, 40);
  parent.appendChild(t);
  if (o.w === "FILL") { t.textAutoResize = "HEIGHT"; t.layoutSizingHorizontal = "FILL"; }
  else if (typeof o.w === "number") { t.resize(o.w, t.height); t.textAutoResize = "HEIGHT"; }
  else t.textAutoResize = "WIDTH_AND_HEIGHT";
  if (o.link) t.hyperlink = { type: "URL", value: o.link };
  return t;
}
function AL(parent, dir, o = {}) {
  const f = figma.createAutoLayout(dir === "V" ? "VERTICAL" : "HORIZONTAL");
  f.name = o.name || "Frame";
  f.itemSpacing = o.gap || 0;
  const [pt, pr, pb, pl] = o.pad || [0, 0, 0, 0];
  f.paddingTop = pt; f.paddingRight = pr; f.paddingBottom = pb; f.paddingLeft = pl;
  f.fills = o.fill ? solid(o.fill) : [];
  if (o.stroke) {
    f.strokes = solid(o.stroke);
    if (Array.isArray(o.sw)) { [f.strokeTopWeight, f.strokeRightWeight, f.strokeBottomWeight, f.strokeLeftWeight] = o.sw; }
    else f.strokeWeight = o.sw || 1;
    f.strokeAlign = "INSIDE";
  }
  if (o.dash) f.dashPattern = o.dash;
  if (o.r) f.cornerRadius = o.r;
  if (o.center) f.counterAxisAlignItems = "CENTER";
  if (o.align) f.counterAxisAlignItems = o.align;
  f.clipsContent = !!o.clip;
  if (parent) {
    parent.appendChild(f);
    if (o.w === "FILL") f.layoutSizingHorizontal = "FILL";
    else if (typeof o.w === "number") { f.resize(o.w, f.height); f.layoutSizingHorizontal = "FIXED"; f.layoutSizingVertical = "HUG"; }
    if (o.h === "FILL") f.layoutSizingVertical = "FILL";
  } else if (typeof o.w === "number") {
    f.resize(o.w, f.height);
    if (dir === "V") { f.primaryAxisSizingMode = "AUTO"; f.counterAxisSizingMode = "FIXED"; }
    else { f.primaryAxisSizingMode = "FIXED"; f.counterAxisSizingMode = "AUTO"; }
  }
  if (o.wrap) { f.layoutWrap = "WRAP"; f.counterAxisSpacing = o.wrap; }
  return f;
}
const spacer = (parent) => { const s = AL(parent, "H", { name: "spacer" }); s.resize(10, 1); s.layoutSizingHorizontal = "FILL"; s.layoutSizingVertical = "FIXED"; return s; };
function chip(parent, text, bg, fg, o = {}) {
  const c = AL(parent, "H", { name: o.name || `chip / ${text}`, fill: bg, r: 9999, pad: o.pad || [3, 9, 3, 9], center: true });
  T(c, text, { fs: o.fs || 12, fw: "Semi Bold", color: fg, lh: "auto" });
  return c;
}
function linkChip(parent, text, name) {
  const c = AL(parent, "H", { name: name || "sync-link", pad: [3, 8, 3, 8], stroke: K.line, r: 6, center: true });
  T(c, text, { fs: 11, fw: "Medium", color: K.sub, lh: "auto" });
  return c;
}
function titleRow(parent, title, note, noteColor) {
  const r = AL(parent, "H", { name: "title", gap: 12, w: "FILL", center: true });
  T(r, title, { fs: 18, fw: "Bold", lh: "auto" });
  spacer(r);
  if (note) T(r, note, { fs: 12, color: noteColor || K.sub, lh: "auto" });
  return r;
}

// ---------- variables ----------
async function collection(name, modeNames) {
  const all = await figma.variables.getLocalVariableCollectionsAsync();
  let col = all.find((c) => c.name === name);
  if (!col) { col = figma.variables.createVariableCollection(name); col.renameMode(col.modes[0].modeId, modeNames[0]); }
  modeNames.forEach((m, i) => {
    if (col.modes.some((x) => x.name === m)) return;
    if (i === 0) col.renameMode(col.modes[0].modeId, m); else col.addMode(m);
  });
  const modeIds = modeNames.map((m) => col.modes.find((x) => x.name === m).modeId);
  return { col, modeIds };
}
async function variable(col, name, type, scopes) {
  for (const id of col.variableIds) { const v = await figma.variables.getVariableByIdAsync(id); if (v && v.name === name) return v; }
  const v = figma.variables.createVariable(name, col, type); v.scopes = scopes; return v;
}
const boundPaint = (v, h) => [figma.variables.setBoundVariableForPaint({ type: "SOLID", color: hex(h) }, "color", v)];

let statusVars = null;
try {
  const { col, modeIds } = await collection(L.status.collection, L.status.modes);
  const vLabel = await variable(col, "status/label", "STRING", ["TEXT_CONTENT"]);
  const vFg = await variable(col, "status/chip-fg", "COLOR", ["SHAPE_FILL", "TEXT_FILL"]);
  const vBg = await variable(col, "status/chip-bg", "COLOR", ["FRAME_FILL"]);
  const vSec = await variable(col, "status/section-bg", "COLOR", ["FRAME_FILL"]);
  L.status.modes.forEach((label, i) => {
    vLabel.setValueForMode(modeIds[i], label);
    vFg.setValueForMode(modeIds[i], hex("#ffffff"));
    vBg.setValueForMode(modeIds[i], hex(STATUS_CHIP[i]));
    vSec.setValueForMode(modeIds[i], hex(STATUS_SECTION[i]));
  });
  statusVars = { col, modeIds, vLabel, vFg, vBg, vSec };
} catch (e) { statusVars = null; } // free plans allow one mode: fall back to fixed variants

let logVar = null;
try {
  const { col, modeIds } = await collection(L.logToggle.collection, L.logToggle.modes);
  const v = await variable(col, L.logToggle.variable, "BOOLEAN", ["ALL_SCOPES"]);
  v.setValueForMode(modeIds[0], true); v.setValueForMode(modeIds[1], false);
  logVar = v;
} catch (e) { logVar = null; }

// ---------- layout origin ----------
let X0 = OPTS.x, Y0 = OPTS.y;
if (X0 === undefined) {
  const existing = figma.currentPage.children;
  let maxY = 0, minX = existing.length ? Infinity : 0;
  for (const n of existing) { maxY = Math.max(maxY, n.y + n.height); minX = Math.min(minX, n.x); }
  X0 = minX; Y0 = existing.length ? maxY + 400 : 0;
}

// ---------- components ----------
const comps = AL(null, "V", { name: L.components.frame, gap: 20, pad: [28, 32, 28, 32], fill: K.headBg, stroke: K.compLine, r: 16, w: 1000 });
comps.x = X0; comps.y = Y0; created.push(comps.id);
T(comps, L.components.title, { fs: 18, fw: "Bold", lh: "auto" });
T(comps, L.components.desc, { fs: 13, color: K.sub, w: "FILL" });
const compList = AL(comps, "H", { name: "list", gap: 32, align: "MIN" });
const cell = (label) => { const f = AL(compList, "V", { name: label, gap: 8 }); T(f, label, { fs: 12, fw: "Semi Bold", color: K.sub, lh: "auto" }); return f; };

// badge
const badge = figma.createComponent();
badge.name = L.badge.name;
badge.layoutMode = "HORIZONTAL"; badge.primaryAxisAlignItems = "CENTER"; badge.counterAxisAlignItems = "CENTER";
badge.resize(32, 32); badge.primaryAxisSizingMode = "FIXED"; badge.counterAxisSizingMode = "FIXED";
badge.cornerRadius = 999; badge.fills = solid(K.badge);
const badgeText = T(badge, "1", { fs: 16, fw: "Bold", color: "#ffffff", lh: "auto", name: "number" });
const badgeProp = badge.addComponentProperty(L.badge.prop, "TEXT", "1");
badgeText.componentPropertyReferences = { characters: badgeProp };
badge.description = L.badge.desc;
cell(L.badge.name).appendChild(badge);

// spec row: variant 작성=미작성|완료 (Filled=Empty|Done), text props label/value
const rowVariant = (state, valueColor) => {
  const c = figma.createComponent();
  c.name = `${L.row.prop}=${state}`;
  c.layoutMode = "HORIZONTAL"; c.itemSpacing = 16; c.counterAxisAlignItems = "MIN";
  c.paddingTop = 12; c.paddingBottom = 12; c.paddingLeft = 16; c.paddingRight = 16;
  c.primaryAxisSizingMode = "FIXED"; c.counterAxisSizingMode = "AUTO"; c.resize(560, 46); c.counterAxisSizingMode = "AUTO";
  c.fills = solid("#ffffff");
  c.strokes = solid(K.line); c.strokeTopWeight = 0; c.strokeRightWeight = 0; c.strokeLeftWeight = 0; c.strokeBottomWeight = 1; c.strokeAlign = "INSIDE";
  T(c, L.row.label, { fs: 13, fw: "Medium", color: K.sub, w: 112, name: L.row.label });
  const v = T(c, L.row.value, { fs: 14, color: valueColor, name: L.row.value });
  v.textAutoResize = "HEIGHT"; v.layoutSizingHorizontal = "FILL";
  return c;
};
const rowSetHolder = cell(`${L.row.name} · ${L.row.prop} = ${L.row.values.join(" | ")}`);
const rowSet = figma.combineAsVariants([rowVariant(L.row.values[0], K.disable), rowVariant(L.row.values[1], K.ink)], rowSetHolder);
rowSet.name = L.row.name;
rowSet.layoutMode = "VERTICAL"; rowSet.primaryAxisSizingMode = "AUTO"; rowSet.counterAxisSizingMode = "AUTO";
rowSet.strokes = solid(K.line); rowSet.cornerRadius = 8;
const kLabel = rowSet.addComponentProperty(L.row.label, "TEXT", L.row.label);
const kValue = rowSet.addComponentProperty(L.row.value, "TEXT", L.row.value);
for (const v of rowSet.children) {
  v.findOne((n) => n.name === L.row.label).componentPropertyReferences = { characters: kLabel };
  v.findOne((n) => n.name === L.row.value).componentPropertyReferences = { characters: kValue };
}
rowSet.description = L.row.desc;
const kState = Object.keys(rowSet.componentPropertyDefinitions).find((k) => rowSet.componentPropertyDefinitions[k].type === "VARIANT");

// status chip
const statusHolder = AL(comps, "V", { name: L.status.collection, gap: 8 });
T(statusHolder, L.status.caption, { fs: 12, fw: "Semi Bold", color: K.sub, lh: "auto" });
const statusVariant = (name, label, i, bound) => {
  const c = figma.createComponent();
  c.name = `${L.status.prop}=${name}`;
  c.layoutMode = "HORIZONTAL"; c.itemSpacing = 4; c.counterAxisAlignItems = "CENTER";
  c.paddingTop = 6; c.paddingBottom = 6; c.paddingLeft = 10; c.paddingRight = 12;
  c.primaryAxisSizingMode = "AUTO"; c.counterAxisSizingMode = "AUTO"; c.cornerRadius = 9999;
  c.fills = bound ? boundPaint(statusVars.vBg, STATUS_CHIP[i]) : solid(STATUS_CHIP[i]);
  const dot = figma.createEllipse(); dot.name = "dot"; dot.resize(8, 8);
  dot.fills = bound ? boundPaint(statusVars.vFg, "#ffffff") : solid("#ffffff"); c.appendChild(dot);
  const t = T(c, label, { fs: 13, fw: "Semi Bold", color: "#ffffff", lh: "auto", name: "label" });
  if (bound) { t.fills = boundPaint(statusVars.vFg, "#ffffff"); t.setBoundVariable("characters", statusVars.vLabel); }
  return c;
};
// With variables: the default variant follows the section's mode; the other variants pin a mode
// (same as the original design). Without variables (free plan): one fixed-color variant per status.
const statusComps = [];
if (statusVars) {
  statusComps.push(statusVariant(L.status.variant, L.status.modes[0], 0, true));
  L.status.modes.slice(1).forEach((m, j) => {
    const c = statusVariant(m, m, j + 1, true);
    c.setExplicitVariableModeForCollection(statusVars.col, statusVars.modeIds[j + 1]);
    statusComps.push(c);
  });
} else L.status.modes.forEach((m, i) => statusComps.push(statusVariant(m, m, i, false)));
const statusSet = figma.combineAsVariants(statusComps, statusHolder);
statusSet.name = L.status.comp;
statusSet.layoutMode = "HORIZONTAL"; statusSet.itemSpacing = 20;
statusSet.paddingTop = statusSet.paddingBottom = statusSet.paddingLeft = statusSet.paddingRight = 20;
statusSet.primaryAxisSizingMode = "AUTO"; statusSet.counterAxisSizingMode = "AUTO";
statusSet.strokes = solid(K.compLine); statusSet.dashPattern = [6, 4]; statusSet.cornerRadius = 8;
statusSet.description = L.status.desc;
const statusInstance = (label) => {
  const auto = statusSet.children.find((c) => c.name.endsWith("=" + L.status.variant));
  const fixed = statusSet.children.find((c) => c.name.endsWith("=" + label));
  return (auto || fixed || statusSet.defaultVariant).createInstance();
};

// change log row
const clHolder = AL(comps, "V", { name: L.changelogRow.name, gap: 8, w: "FILL" });
T(clHolder, L.changelogRow.name, { fs: 12, fw: "Semi Bold", color: K.sub, lh: "auto" });
const clRow = figma.createComponent();
clRow.name = L.changelogRow.name;
clRow.layoutMode = "HORIZONTAL"; clRow.itemSpacing = 16; clRow.counterAxisAlignItems = "MIN";
clRow.paddingTop = 12; clRow.paddingBottom = 12; clRow.paddingLeft = 16; clRow.paddingRight = 16;
clRow.primaryAxisSizingMode = "FIXED"; clRow.counterAxisSizingMode = "AUTO"; clRow.resize(936, 45); clRow.counterAxisSizingMode = "AUTO";
clRow.fills = solid("#ffffff");
clRow.strokes = solid(K.line); clRow.strokeTopWeight = 0; clRow.strokeRightWeight = 0; clRow.strokeLeftWeight = 0; clRow.strokeBottomWeight = 1; clRow.strokeAlign = "INSIDE";
const clWidths = [80, 120, 80, 120, "FILL"];
const clKeys = L.changelogRow.props.map((p, i) => {
  const t = T(clRow, L.changeLog.rows[0][i], { fs: 13, w: clWidths[i] === "FILL" ? 440 : clWidths[i], name: p });
  if (clWidths[i] === "FILL") t.layoutSizingHorizontal = "FILL";
  const k = clRow.addComponentProperty(p, "TEXT", L.changeLog.rows[0][i]);
  t.componentPropertyReferences = { characters: k };
  return k;
});
clRow.description = L.changelogRow.desc;
clHolder.appendChild(clRow); clRow.layoutSizingHorizontal = "FILL";

// ---------- writing guide ----------
const G = L.guide;
const guide = AL(null, "V", { name: G.frame, gap: 18, pad: [28, 32, 28, 32], fill: "#ffffff", r: 16, w: 1000 });
guide.x = X0; guide.y = comps.y + comps.height + 60; created.push(guide.id);
T(guide, G.title, { fs: 18, fw: "Bold", lh: "auto" });
const editTable = AL(guide, "V", { name: "edit", stroke: K.line, r: 8, clip: true, w: "FILL" });
const eh = AL(editTable, "H", { pad: [10, 16, 10, 16], fill: K.headBg, stroke: K.line, sw: [0, 0, 1, 0], w: "FILL" });
T(eh, G.editHead, { fs: 13, fw: "Semi Bold", lh: "auto" });
G.edit.forEach(([k, v], i) => {
  const r = AL(editTable, "H", { gap: 16, pad: [10, 16, 10, 16], stroke: K.line, sw: [0, 0, i === G.edit.length - 1 ? 0 : 1, 0], w: "FILL" });
  T(r, k, { fs: 13, fw: "Medium", color: K.sub, w: 112 });
  T(r, v, { fs: 13, w: "FILL" });
});
const rules = AL(guide, "V", { name: "rules", gap: 6, w: "FILL" });
T(rules, G.rulesHead, { fs: 13, fw: "Semi Bold", lh: "auto" });
G.rules.forEach((line) => T(rules, line, { fs: 13, color: K.body, w: "FILL" }));

// ---------- spec document ----------
function rowInstance(parent, label, value, placeholder) {
  const inst = rowSet.defaultVariant.createInstance();
  const done = value != null;
  inst.setProperties({ [kLabel]: label, [kValue]: done ? value : placeholder, [kState]: done ? L.row.values[1] : L.row.values[0] });
  inst.name = L.row.name;
  parent.appendChild(inst);
  inst.layoutSizingHorizontal = "FILL";
  return inst;
}
const lastRowNoLine = (container) => {
  const last = container.children[container.children.length - 1];
  if (last && last.type === "INSTANCE") last.strokeBottomWeight = 0;
};

function buildDoc(S) {
  const filled = !!S;
  const id = filled ? S.id : L.idPlaceholder;
  const title = filled ? S.title : L.titlePlaceholder;
  const doc = AL(null, "V", { name: `📄 ${id} ${title} · ${L.marker}`, gap: 48, pad: [48, 48, 56, 48], fill: "#ffffff", r: 16, clip: true, w: 1400 });

  // header
  const head = AL(doc, "V", { name: "Doc Header", gap: 12, w: "FILL" });
  const idRow = AL(head, "H", { name: "id", gap: 10, center: true });
  const st = statusInstance(filled ? S.status : L.status.modes[0]); st.name = "Status Chip"; idRow.appendChild(st);
  T(idRow, id, { fs: 16, fw: "Bold", lh: "auto", name: id });
  T(idRow, filled ? S.version : "v1.0", { fs: 16, fw: "Medium", color: K.sub, lh: "auto" });
  T(head, title, { fs: 32, fw: "Bold", lh: "auto", name: title });
  T(head, filled ? S.summary : L.summaryPlaceholder, { fs: 15, color: K.sub, w: "FILL" });

  // overview
  const ov = AL(doc, "V", { name: L.overview.layer, gap: 14, w: "FILL" });
  titleRow(ov, L.overview.title, L.overview.note, K.accent);
  const ovTable = AL(ov, "V", { name: L.overview.table, stroke: K.line, r: 10, clip: true, w: "FILL" });
  L.overviewRows.forEach(([label, ph], i) => rowInstance(ovTable, label, filled ? S.overview[i] : null, ph));
  lastRowNoLine(ovTable);

  // elements
  const I = L.items;
  const items = AL(doc, "V", { name: I.layer, gap: 14, w: "FILL" });
  titleRow(items, I.title, I.note);
  const list = filled ? S.items : [{ name: null, pm: [], design: [] }];
  list.forEach((it, idx) => {
    const no = idx + 1;
    const name = it.name || I.namePlaceholder;
    const card = AL(items, "V", { name: `${I.prefix} / ${id}-${no} ${name}`, stroke: K.line, r: 10, clip: true, w: "FILL" });
    const bar = AL(card, "H", { name: "header", gap: 10, pad: [14, 16, 14, 16], stroke: K.line, sw: [0, 0, 1, 0], center: true, w: "FILL" });
    const b = badge.createInstance(); b.setProperties({ [badgeProp]: String(no) }); bar.appendChild(b);
    T(bar, name, { fs: 16, fw: "Bold", lh: "auto", name });
    spacer(bar);
    linkChip(bar, `${id}-${no} ↗`);
    const ch = AL(card, "H", { name: "col head", stroke: K.line, sw: [0, 0, 1, 0], w: "FILL" });
    const hp = AL(ch, "H", { pad: [12, 16, 12, 16], fill: K.pmBg }); hp.layoutSizingHorizontal = "FILL";
    T(hp, I.pmHead, { fs: 12, fw: "Bold", color: K.pmFg, lh: "auto" });
    const hd = AL(ch, "H", { pad: [12, 16, 12, 16], fill: K.dsBg, stroke: K.line, sw: [0, 0, 0, 1] }); hd.layoutSizingHorizontal = "FILL";
    T(hd, I.designHead, { fs: 12, fw: "Bold", color: K.dsFg, lh: "auto" });
    const body = AL(card, "H", { name: "body", w: "FILL" });
    const pm = AL(body, "V", { name: "PM" }); pm.layoutSizingHorizontal = "FILL";
    const ds = AL(body, "V", { name: "Design", stroke: K.line, sw: [0, 0, 0, 1] }); ds.layoutSizingHorizontal = "FILL";
    L.pmRows.forEach(([label, ph], i) => rowInstance(pm, label, it.pm[i] ?? null, ph));
    L.designRows.forEach(([label, ph], i) => rowInstance(ds, label, it.design[i] ?? null, ph));
    // both columns hug their rows; only the shorter one stretches, so deleting rows shrinks the card
    (pm.height < ds.height ? pm : ds).layoutSizingVertical = "FILL";
    lastRowNoLine(ds);
  });

  // feedback log
  const F = L.feedback;
  const fb = AL(doc, "V", { name: "Feedback Log", gap: 14, w: "FILL" });
  const ft = AL(fb, "H", { name: "title", gap: 12, center: true, w: "FILL" });
  T(ft, F.title, { fs: 18, fw: "Bold", lh: "auto" });
  linkChip(ft, F.sync);
  spacer(ft);
  T(ft, filled ? S.synced : F.synced, { fs: 12, color: K.sub, lh: "auto", name: "last-synced" });
  const table = AL(fb, "V", { name: "feedback table", stroke: K.line, r: 10, clip: true, w: "FILL" });
  const widths = [100, 64, 140, "FILL", "FILL", 110, 120, 90];
  const cellOf = (row, i) => {
    const c = AL(row, "V", { name: `cell / ${F.cols[i]}`, gap: 2 });
    if (widths[i] === "FILL") c.layoutSizingHorizontal = "FILL"; else { c.resize(widths[i], c.height); c.layoutSizingHorizontal = "FIXED"; c.layoutSizingVertical = "HUG"; }
    return c;
  };
  const th = AL(table, "H", { name: "head", gap: 16, pad: [10, 16, 10, 16], fill: K.headBg, stroke: K.line, sw: [0, 0, 1, 0], w: "FILL" });
  F.cols.forEach((label, i) => T(cellOf(th, i), label, { fs: 12, fw: "Semi Bold", color: K.sub, w: "FILL" }));
  const rowsData = filled
    ? S.feedback.map(([el, type, key, epic, summary, comment, flow, status, ver]) =>
        ({ name: `row / ${key}`, element: [el], type, jira: [`${key} ↗`, epic], summary, comment, flow, status, version: [ver] }))
    : [{ name: F.exampleRowName, ...F.example }];
  rowsData.forEach((d, ri) => {
    const row = AL(table, "H", { name: d.name, gap: 16, pad: [14, 16, 14, 16], stroke: K.line, sw: [0, 0, ri === rowsData.length - 1 ? 0 : 1, 0], w: "FILL" });
    let c = cellOf(row, 0); T(c, d.element[0], { fs: 13, fw: "Medium", w: "FILL" });
    if (d.element[1]) T(c, d.element[1], { fs: 12, color: K.sub, w: "FILL" });
    c = cellOf(row, 1); const tt = toneOf(F.types, d.type); chip(c, d.type, tt[0], tt[1]);
    c = cellOf(row, 2); T(c, d.jira[0], { fs: 13, color: K.link, w: "FILL" }); if (d.jira[1]) T(c, d.jira[1], { fs: 12, color: K.sub, w: "FILL" });
    c = cellOf(row, 3); T(c, d.summary, { fs: 13, w: "FILL" });
    c = cellOf(row, 4);
    if (d.comment) { T(c, d.comment[0], { fs: 13, w: "FILL" }); T(c, d.comment[1], { fs: 12, color: K.sub, w: "FILL" }); }
    else T(c, F.noComment, { fs: 13, color: K.disable, w: "FILL" });
    c = cellOf(row, 5); T(c, d.flow, { fs: 13, w: "FILL" });
    c = cellOf(row, 6); const ts = toneOf(F.states, d.status); chip(c, d.status, ts[0], ts[1]);
    c = cellOf(row, 7); T(c, d.version[0], { fs: 13, w: "FILL" });
  });
  const lg = AL(fb, "V", { name: "legend", gap: 16, pad: [14, 20, 14, 20], fill: K.soft, r: 10, w: "FILL" });
  const lt = AL(lg, "H", { gap: 8, center: true, wrap: 8 });
  T(lt, F.legendType, { fs: 12, fw: "Semi Bold", color: K.sub });
  F.types.forEach(([l, t]) => chip(lt, l, TONE[t][0], TONE[t][1]));
  const ls = AL(lg, "H", { gap: 8, center: true, wrap: 8 });
  T(ls, F.legendStatus, { fs: 12, fw: "Semi Bold", color: K.sub });
  F.states.forEach(([l, t]) => chip(ls, l, TONE[t][0], TONE[t][1]));
  T(ls, F.legendNote, { fs: 12, color: K.sub, lh: "auto" });
  if (logVar) lg.setBoundVariable("visible", logVar);

  // change log
  const C = L.changeLog;
  const cl = AL(doc, "V", { name: "Change Log", gap: 14, w: "FILL" });
  titleRow(cl, C.title, C.note);
  const ct = AL(cl, "V", { name: C.layer, stroke: K.line, r: 10, clip: true, w: "FILL" });
  const chd = AL(ct, "H", { name: "head", gap: 16, pad: [10, 16, 10, 16], fill: K.headBg, stroke: K.line, sw: [0, 0, 1, 0], w: "FILL" });
  C.cols.forEach((label, i) => {
    const t = T(chd, label, { fs: 12, fw: "Semi Bold", color: K.sub, lh: "auto", w: clWidths[i] === "FILL" ? 400 : clWidths[i] });
    if (clWidths[i] === "FILL") t.layoutSizingHorizontal = "FILL";
  });
  (filled ? S.changeLog : C.rows).forEach((r) => {
    const inst = clRow.createInstance();
    inst.setProperties(Object.fromEntries(clKeys.map((k, i) => [k, r[i]])));
    ct.appendChild(inst); inst.layoutSizingHorizontal = "FILL";
  });
  lastRowNoLine(ct);
  return doc;
}

function makeSection(name, statusIndex) {
  const s = figma.createSection();
  s.name = name;
  if (statusVars) {
    s.fills = boundPaint(statusVars.vSec, STATUS_SECTION[statusIndex]);
    s.setExplicitVariableModeForCollection(statusVars.col, statusVars.modeIds[statusIndex]);
  } else s.fills = solid(STATUS_SECTION[statusIndex]);
  created.push(s.id);
  return s;
}

// ---------- blank template section ----------
const tplSec = makeSection(L.section, 0);
tplSec.x = X0 + 1000 + 88; tplSec.y = Y0;
const mock = figma.createFrame();
mock.name = L.mock.name; mock.resize(1920, 1080); mock.fills = solid("#ffffff");
mock.strokes = solid(K.mockLine); mock.dashPattern = [6, 6]; mock.strokeAlign = "INSIDE"; mock.cornerRadius = 8;
tplSec.appendChild(mock); mock.x = 60; mock.y = 60;
const mt = T(mock, L.mock.title, { fs: 24, fw: "Medium", color: K.sub, lh: "auto" });
mt.x = (1920 - mt.width) / 2; mt.y = (1080 - mt.height) / 2;
const mb = badge.createInstance(); mock.appendChild(mb); mb.x = 40; mb.y = 40;
const tpl = buildDoc(null);
tplSec.appendChild(tpl); tpl.x = 2040; tpl.y = 60;
tplSec.resizeWithoutConstraints(3500, Math.max(1140, tpl.height) + 120);

// ---------- filled sample section ----------
const S = L.sample;
const smpSec = makeSection(`📄 ${S.id} ${S.title}`, Math.max(0, L.status.modes.indexOf(S.status)));
smpSec.x = tplSec.x + tplSec.width + 200; smpSec.y = Y0;
let docX = 60;
const existingMock = OPTS.sampleMockupId ? await figma.getNodeByIdAsync(OPTS.sampleMockupId) : null;
if (existingMock) {
  existingMock.name = `${S.id} ${S.title} · ${L.mock.suffix}`;
  smpSec.appendChild(existingMock); existingMock.x = 60; existingMock.y = 60;
  // badges on the mockup use the shared spec/badge component
  existingMock.findAll((n) => n.type === "INSTANCE" && /badge/i.test(n.name)).forEach((old) => {
    const t = old.findOne((n) => n.type === "TEXT");
    const no = t ? t.characters : "1";
    const nb = badge.createInstance(); nb.setProperties({ [badgeProp]: no });
    nb.name = `${L.badge.name} ${no}`;
    old.parent.insertChild(old.parent.children.indexOf(old), nb);
    nb.x = old.x + old.width / 2 - 16; nb.y = old.y + old.height / 2 - 16;
    old.remove();
  });
  docX = existingMock.x + existingMock.width + 100;
}
const smp = buildDoc(S);
smpSec.appendChild(smp); smp.x = docX; smp.y = 60;
smpSec.resizeWithoutConstraints(docX + 1400 + 80, Math.max(smp.height, existingMock ? existingMock.height : 0) + 120);

return {
  createdIds: created, componentsId: comps.id, guideId: guide.id, templateSectionId: tplSec.id, templateDocId: tpl.id,
  sampleSectionId: smpSec.id, sampleDocId: smp.id, rowSetId: rowSet.id, badgeId: badge.id, statusSetId: statusSet.id, changelogRowId: clRow.id,
  statusVariables: !!statusVars, logToggle: !!logVar, bottom: Y0 + Math.max(tplSec.height, smpSec.height, guide.y - Y0 + guide.height),
};
