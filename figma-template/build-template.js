// Builds the screenspec Figma template (blank template + filled sample) on the current page.
// Run with the Figma Plugin API (e.g. via the Figma MCP `use_figma` tool).
// `L` is one language block from i18n.json — injected by scripts/render-template.mjs.
const L = __LANG__;

const FONT = "Inter";
await Promise.all(["Regular", "Medium", "Semi Bold", "Bold"].map((style) => figma.loadFontAsync({ family: FONT, style })));

// ---------- tokens (taken from the original template) ----------
const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const solid = (h) => [{ type: "SOLID", color: hex(h) }];
const K = {
  ink: "#1a1a1a", sub: "#777777", ph: "#969caa", body: "#464c5a", line: "#e4e7ec", rowLine: "#eef0f3", headBg: "#edeff4",
  pm: "#3a6ce8", pmBg: "#ebf1fd", ds: "#d628a0", dsBg: "#fcecf7", dev: "#e67814", devBg: "#fdf2e6", qa: "#10966e", qaBg: "#e7f6f0",
  brand: "#2a6049", brandBg: "#eef4f1", refBg: "#e0e9e5", badge: "#e53030", link: "#0052cc", sectionBg: "#e2eafc", soft: "#f7f8fa",
};
const TONE = {
  red: ["#fdebeb", "#e53030"], blue: ["#ebf1fd", "#3a6ce8"], gray: ["#eef0f3", "#5a606e"], orange: ["#fdf2e6", "#e67814"],
  green: ["#e7f6f0", "#10966e"], neutral: ["#eeeeee", "#787878"],
};
const toneOf = (list, label) => TONE[(list.find((x) => x[0] === label) || [0, "gray"])[1]];

// ---------- primitives ----------
function T(parent, chars, o = {}) {
  const t = figma.createText();
  t.fontName = { family: FONT, style: o.fw || "Regular" };
  t.characters = chars;
  t.fontSize = o.fs || 15;
  t.lineHeight = { unit: "PERCENT", value: 150 };
  t.fills = solid(o.color || K.ink);
  if (o.name) t.name = o.name;
  parent.appendChild(t);
  if (o.w === "FILL") { t.textAutoResize = "HEIGHT"; t.layoutSizingHorizontal = "FILL"; }
  else if (typeof o.w === "number") { t.resize(o.w, t.height); t.textAutoResize = "HEIGHT"; }
  else t.textAutoResize = "WIDTH_AND_HEIGHT";
  if (o.align) t.textAlignHorizontal = o.align;
  return t;
}
function AL(parent, dir, o = {}) {
  const f = figma.createAutoLayout(dir === "V" ? "VERTICAL" : "HORIZONTAL");
  f.name = o.name || "frame";
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
  if (o.mid) f.primaryAxisAlignItems = "CENTER";
  f.clipsContent = !!o.clip;
  if (parent) {
    parent.appendChild(f);
    if (o.w === "FILL") f.layoutSizingHorizontal = "FILL";
    else if (typeof o.w === "number") { f.resize(o.w, f.height); f.layoutSizingHorizontal = "FIXED"; }
    if (o.h === "FILL") f.layoutSizingVertical = "FILL";
  } else if (typeof o.w === "number") { f.resize(o.w, f.height); f.primaryAxisSizingMode = dir === "V" ? "AUTO" : "FIXED"; f.counterAxisSizingMode = dir === "V" ? "FIXED" : "AUTO"; }
  if (o.wrap) { f.layoutWrap = "WRAP"; f.counterAxisSpacing = o.wrap; }
  return f;
}
function chip(parent, text, bg, fg, o = {}) {
  const c = AL(parent, "H", { name: o.name || `chip / ${text}`, fill: bg, r: 9999, pad: o.pad || [4, 10, 4, 10], center: true });
  T(c, text, { fs: o.fs || 13, fw: "Semi Bold", color: fg });
  return c;
}

// ---------- local components ----------
function makeBadge(name, size, fs) {
  const c = figma.createComponent();
  c.name = name;
  c.layoutMode = "HORIZONTAL"; c.primaryAxisAlignItems = "CENTER"; c.counterAxisAlignItems = "CENTER";
  c.resize(size, size); c.primaryAxisSizingMode = "FIXED"; c.counterAxisSizingMode = "FIXED";
  c.cornerRadius = 9999; c.fills = solid(K.badge);
  const t = T(c, "1", { fs, fw: "Bold", color: "#ffffff" });
  const prop = c.addComponentProperty("No", "TEXT", "1");
  t.componentPropertyReferences = { characters: prop };
  c.description = "Element number badge. Must match ITEM / n in the spec.";
  return { comp: c, prop };
}
function makeStatusSet() {
  const variants = L.statuses.map(([label, tone]) => {
    const c = figma.createComponent();
    c.name = `${L.statusProp}=${label}`;
    c.layoutMode = "HORIZONTAL"; c.itemSpacing = 6; c.counterAxisAlignItems = "CENTER";
    c.paddingTop = 7; c.paddingBottom = 7; c.paddingLeft = 12; c.paddingRight = 12;
    c.primaryAxisSizingMode = "AUTO"; c.counterAxisSizingMode = "AUTO";
    c.cornerRadius = 9999; c.fills = solid(TONE[tone][0]);
    const dot = figma.createEllipse(); dot.name = "dot"; dot.resize(8, 8); dot.fills = solid(TONE[tone][1]); c.appendChild(dot);
    T(c, label, { fs: 13, fw: "Semi Bold", color: TONE[tone][1] });
    return c;
  });
  const set = figma.combineAsVariants(variants, figma.currentPage);
  set.name = `Status Chip / ${L.statusProp}`;
  set.layoutMode = "HORIZONTAL"; set.itemSpacing = 12;
  set.paddingTop = set.paddingBottom = set.paddingLeft = set.paddingRight = 16;
  set.primaryAxisSizingMode = "AUTO"; set.counterAxisSizingMode = "AUTO";
  set.cornerRadius = 12; set.fills = solid("#ffffff");
  set.strokes = [{ type: "SOLID", color: hex("#9747ff") }]; set.dashPattern = [6, 4];
  set.description = "Spec status. The MCP server reads the variant value.";
  return set;
}

// ---------- section ----------
let maxY = 0;
for (const n of figma.currentPage.children) maxY = Math.max(maxY, n.y + n.height);
const section = figma.createSection();
section.name = L.section;
section.x = 0; section.y = figma.currentPage.children.length > 1 ? maxY + 200 : 0;
section.fills = solid(K.sectionBg);

// components frame
const compFrame = AL(null, "V", { name: L.components, gap: 16, pad: [20, 20, 20, 20], fill: "#ffffff", r: 16, stroke: K.line });
section.appendChild(compFrame);
T(compFrame, L.components, { fs: 15, fw: "Bold" });
const badgeRow = AL(compFrame, "H", { name: "badges", gap: 16, center: true });
const badgeL = makeBadge(L.badgeMock, 36, 16);
const badgeS = makeBadge(L.badgeItem, 26, 13);
badgeRow.appendChild(badgeL.comp); badgeRow.appendChild(badgeS.comp);
const statusSet = makeStatusSet();
compFrame.appendChild(statusSet);
compFrame.x = 60; compFrame.y = 260;

// mockup placeholder
const mock = AL(null, "V", { name: L.mock.name, gap: 12, pad: [24, 24, 24, 24], fill: "#fafafc", stroke: "#aab0be", sw: 2, dash: [10, 8], r: 16, center: true, mid: true, w: 900 });
section.appendChild(mock);
mock.x = 60; mock.y = 60;
T(mock, L.mock.title, { fs: 28, fw: "Bold", color: "#787e8c" });
T(mock, L.mock.body, { fs: 16, color: "#8c92a0", w: "FILL", align: "CENTER" });
const mockBadge = badgeL.comp.createInstance();
section.appendChild(mockBadge); mockBadge.x = 42; mockBadge.y = 42;

// ---------- spec document ----------
function buildDoc(S) {
  const filled = !!S;
  const id = filled ? S.id : L.idPlaceholder;
  const doc = AL(null, "V", { name: `📄 ${id} ${filled ? S.title : L.titlePlaceholder} · ${L.marker}`, gap: 36, pad: [48, 48, 56, 48], fill: "#ffffff", stroke: "#e8e8e8", r: 20, clip: true, w: 1400 });
  section.appendChild(doc);
  const val = (v, ph) => (v == null ? [ph, K.ph] : [v, K.ink]);

  // header
  const head = AL(doc, "V", { name: "Doc Header", gap: 12, w: "FILL" });
  const idRow = AL(head, "H", { name: "id", gap: 8, center: true });
  chip(idRow, id, K.brand, "#ffffff", { name: `chip / ${L.idPlaceholder}`, fs: 16 });
  chip(idRow, filled ? S.version : "v1.0", K.brandBg, K.brand, { name: `chip / ${filled ? S.version : "v1.0"}` });
  const st = statusSet.children.find((c) => c.name.endsWith("=" + (filled ? S.status : L.statuses[0][0]))) || statusSet.defaultVariant;
  const stInst = st.createInstance(); stInst.name = L.statusProp; idRow.appendChild(stInst);
  T(head, filled ? S.title : L.titlePlaceholder, { fs: 34, fw: "Bold", w: "FILL" });
  T(head, filled ? S.summary : L.summaryPlaceholder, { fs: 16, color: filled ? K.sub : K.ph, w: "FILL" });
  const owners = AL(head, "H", { name: "owners", gap: 8, center: true });
  const ownerTones = [[K.pmBg, K.pm], [K.dsBg, K.ds], [K.devBg, K.dev], [K.qaBg, K.qa]];
  ["PM", "Design", "DEV", "QA"].forEach((role, i) => {
    const label = filled ? S.owners[i] : `${role} ${L.ownerPlaceholder}`;
    chip(owners, label, ownerTones[i][0], ownerTones[i][1], { name: `chip / ${role} ${L.ownerPlaceholder}` });
  });

  // guide
  const guide = AL(doc, "V", { name: "Guide", gap: 14, pad: [20, 24, 20, 24], fill: K.soft, r: 12, w: "FILL" });
  T(guide, L.guide.title, { fs: 15, fw: "Bold", w: "FILL" });
  const flow = AL(guide, "H", { name: "flow", gap: 10, center: true });
  const flowTones = [K.pm, K.ds, K.dev, K.qa];
  L.guide.flow.forEach((label, i) => {
    if (i) T(flow, "→", { fs: 16, fw: "Bold", color: "#969caa" });
    chip(flow, label, flowTones[i], "#ffffff");
  });
  T(guide, L.guide.body, { fs: 14, color: K.body, w: "FILL" });

  // PM spec + overview
  const pm = AL(doc, "V", { name: "① PM Spec", gap: 16, w: "FILL" });
  const roleHead = AL(pm, "H", { name: "role header", gap: 12, pad: [14, 20, 14, 20], fill: K.pmBg, r: 10, center: true, w: "FILL" });
  chip(roleHead, "[PM]", K.pm, "#ffffff", { name: "chip / [PM]" });
  T(roleHead, L.pmHeader, { fs: 20, fw: "Bold", w: "FILL" });
  T(roleHead, L.pmBy, { fs: 13, fw: "Semi Bold", color: K.pm });
  const ov = AL(pm, "V", { name: L.overview.layer, fill: "#ffffff", stroke: K.line, r: 12, clip: true, w: "FILL" });
  const ovHead = AL(ov, "H", { name: "head", pad: [14, 20, 14, 20], fill: K.headBg, w: "FILL" });
  T(ovHead, L.overview.title, { fs: 15, fw: "Bold", w: "FILL" });
  L.overviewRows.forEach(([label, ph], i) => {
    const row = AL(ov, "H", { name: `row / ${label}`, gap: 20, pad: [13, 20, 13, 20], stroke: K.rowLine, sw: [0, 0, i === L.overviewRows.length - 1 ? 0 : 1, 0], w: "FILL" });
    T(row, label, { fs: 13, fw: "Semi Bold", color: K.pm, w: 140 });
    const [v, c] = val(filled ? S.overview[i] : null, ph);
    T(row, v, { fs: 15, color: c, w: "FILL" });
  });

  // elements
  const items = AL(doc, "V", { name: L.items.layer, gap: 16, w: "FILL" });
  const ih = AL(items, "H", { name: "items header", gap: 10, center: true, w: "FILL" });
  T(ih, L.items.title, { fs: 20, fw: "Bold" });
  T(items, L.items.note, { fs: 14, color: K.sub, w: "FILL" });
  const list = filled ? S.items : [{ name: null, pm: [], design: [] }];
  list.forEach((it, idx) => {
    const no = idx + 1;
    const name = it.name || L.items.namePlaceholder;
    const card = AL(items, "V", { name: `ITEM / ${no} / ${name}`, fill: "#ffffff", stroke: K.line, r: 12, clip: true, w: "FILL" });
    const bar = AL(card, "H", { name: "TitleBar", gap: 12, pad: [14, 20, 14, 20], fill: "#fafbfc", stroke: K.line, sw: [0, 0, 1, 0], center: true, w: "FILL" });
    const b = badgeS.comp.createInstance(); b.name = "badge"; bar.appendChild(b); b.setProperties({ [badgeS.prop]: String(no) });
    T(bar, name, { fs: 18, fw: "Bold", color: it.name ? K.ink : K.ph, w: "FILL" });
    chip(bar, `${id}-${no} ↗`, K.refBg, K.brand, { fs: 12, name: `chip / ${id}-${no} ↗` });
    const body = AL(card, "H", { name: "body", w: "FILL" });
    const col = (cname, headText, bg, fg, rows, values, leftLine) => {
      const c = AL(body, "V", { name: cname, w: "FILL", h: "FILL", stroke: leftLine ? K.line : undefined, sw: leftLine ? [0, 0, 0, 1] : undefined });
      const h = AL(c, "H", { name: "col head", pad: [10, 20, 10, 20], fill: bg, w: "FILL" });
      T(h, headText, { fs: 13, fw: "Bold", color: fg, w: "FILL" });
      rows.forEach(([label, ph], i) => {
        const r = AL(c, "H", { name: `row / ${label}`, gap: 20, pad: [13, 20, 13, 20], stroke: K.rowLine, sw: [0, 0, 1, 0], w: "FILL" });
        T(r, label, { fs: 13, fw: "Semi Bold", color: fg, w: 110 });
        const [v, cc] = val(values[i], ph);
        T(r, v, { fs: 15, color: cc, w: "FILL" });
      });
    };
    col("PM column", L.items.pmHead, K.pmBg, K.pm, L.pmRows, it.pm, false);
    col("Design column", L.items.designHead, K.dsBg, K.ds, L.designRows, it.design, true);
  });

  // feedback log
  const F = L.feedback;
  const fb = AL(doc, "V", { name: "Feedback Log", gap: 16, w: "FILL" });
  const ft = AL(fb, "H", { name: "title", gap: 10, center: true, w: "FILL" });
  T(ft, F.title, { fs: 20, fw: "Bold" });
  F.chips.forEach((c) => chip(ft, c, TONE.gray[0], TONE.gray[1], { fs: 12, pad: [3, 9, 3, 9] }));
  const sync = chip(ft, F.sync, K.brand, "#ffffff", { fs: 12, pad: [4, 12, 4, 12] }); sync.name = "sync-link";
  T(fb, F.desc, { fs: 14, color: K.sub, w: "FILL" });
  const table = AL(fb, "V", { name: "feedback table", fill: "#ffffff", stroke: K.line, r: 12, clip: true, w: "FILL" });
  const widths = [110, 80, 130, "FILL", "FILL", 130, 120, 100];
  const th = AL(table, "H", { name: "head", gap: 16, pad: [12, 20, 12, 20], fill: K.headBg, w: "FILL" });
  F.cols.forEach((c, i) => { const cell = AL(th, "V", { name: `cell / ${c}`, w: widths[i] }); T(cell, c, { fs: 13, fw: "Bold", w: "FILL" }); });
  const cellOf = (row, i, label) => AL(row, "V", { name: filled ? `cell ${i}` : `cell / ${label}`, gap: 4, w: widths[i] });
  const fbRow = (name, d) => {
    const row = AL(table, "H", { name, gap: 16, pad: [12, 20, 12, 20], stroke: K.rowLine, sw: [0, 0, 1, 0], w: "FILL" });
    let c = cellOf(row, 0, F.cols[0]); T(c, d.element[0], { fs: 14, fw: "Bold", w: "FILL" }); if (d.element[1]) T(c, d.element[1], { fs: 12, color: K.sub, w: "FILL" });
    c = cellOf(row, 1, F.cols[1]); const tt = toneOf(F.types, d.type); chip(c, d.type, tt[0], tt[1], { fs: 12, pad: [3, 9, 3, 9] });
    c = cellOf(row, 2, F.cols[2]); T(c, d.jira[0], { fs: 13, fw: "Semi Bold", color: K.link, w: "FILL" }); T(c, d.jira[1], { fs: 12, color: K.sub, w: "FILL" });
    c = cellOf(row, 3, F.cols[3]); T(c, d.summary, { fs: 14, w: "FILL" });
    c = cellOf(row, 4, F.cols[4]);
    if (d.comment) { T(c, d.comment[0], { fs: 14, w: "FILL" }); T(c, d.comment[1], { fs: 12, color: K.sub, w: "FILL" }); }
    else T(c, F.noComment, { fs: 14, color: K.ph, w: "FILL" });
    c = cellOf(row, 5, F.cols[5]); T(c, d.flow, { fs: 14, fw: "Medium", w: "FILL" });
    c = cellOf(row, 6, F.cols[6]); const ts = toneOf(F.states, d.status); chip(c, d.status, ts[0], ts[1], { fs: 12, pad: [3, 9, 3, 9] });
    c = cellOf(row, 7, F.cols[7]); T(c, d.version[0], { fs: 14, color: d.version[0] === "—" ? K.ph : K.ink, w: "FILL" }); if (d.version[1]) T(c, d.version[1], { fs: 12, color: K.sub, w: "FILL" });
  };
  if (filled) {
    S.feedback.forEach(([el, type, key, epic, summary, comment, flow, status, ver]) =>
      fbRow(`row / ${key}`, { element: [el], type, jira: [`${key} ↗`, epic], summary, comment, flow, status, version: [ver] }));
  } else {
    fbRow(F.exampleRowName, F.example);
    const tag = AL(table, "H", { name: "example tag", pad: [8, 20, 8, 20], fill: "#fff8e1", w: "FILL" });
    T(tag, F.exampleTag, { fs: 12, fw: "Medium", color: "#9a6b00", w: "FILL" });
  }
  const lg = AL(fb, "H", { name: "legend", gap: 8, pad: [14, 20, 14, 20], fill: K.soft, r: 10, center: true, wrap: 8, w: "FILL" });
  T(lg, F.legendType, { fs: 12, fw: "Semi Bold", color: K.sub });
  F.types.forEach(([l, t]) => chip(lg, l, TONE[t][0], TONE[t][1], { fs: 12, pad: [3, 9, 3, 9] }));
  T(lg, "   " + F.legendStatus, { fs: 12, fw: "Semi Bold", color: K.sub });
  F.states.forEach(([l, t]) => chip(lg, l, TONE[t][0], TONE[t][1], { fs: 12, pad: [3, 9, 3, 9] }));
  T(lg, F.legendNote, { fs: 12, color: K.sub });
  T(fb, filled ? S.synced : F.synced, { fs: 13, color: K.sub, w: "FILL", name: "last-synced" });

  // change log
  const C = L.changeLog;
  const cl = AL(doc, "V", { name: "Change Log", gap: 16, w: "FILL" });
  T(cl, C.title, { fs: 20, fw: "Bold", w: "FILL" });
  const ct = AL(cl, "V", { name: C.layer, fill: "#ffffff", stroke: K.line, r: 12, clip: true, w: "FILL" });
  const cw = [70, 110, 90, 110, "FILL"];
  const ch = AL(ct, "H", { name: "head", gap: 16, pad: [12, 20, 12, 20], fill: K.headBg, w: "FILL" });
  C.cols.forEach((c, i) => T(ch, c, { fs: 13, fw: "Bold", w: cw[i] }));
  const rows = filled ? S.changeLog : C.rows;
  rows.forEach((r, ri) => {
    const row = AL(ct, "H", { name: "row", gap: 16, pad: [12, 20, 12, 20], stroke: K.rowLine, sw: [0, 0, ri === rows.length - 1 ? 0 : 1, 0], w: "FILL" });
    r.forEach((v, i) => T(row, v, { fs: 14, color: filled ? K.ink : K.ph, w: cw[i] }));
  });
  return doc;
}

const tpl = buildDoc(null);
tpl.x = 1020; tpl.y = 60;
const sample = buildDoc(L.sample);
sample.x = 1020 + 1400 + 60; sample.y = 60;

const h = Math.max(tpl.height, sample.height, compFrame.y + compFrame.height) + 120;
section.resizeWithoutConstraints(sample.x + 1400 + 80, h);

return {
  sectionId: section.id, templateId: tpl.id, sampleId: sample.id, componentsId: compFrame.id, statusSetId: statusSet.id,
  size: [section.width, section.height], nodes: section.findAll(() => true).length,
};
