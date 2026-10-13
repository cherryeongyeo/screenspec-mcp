// Screen Spec Sync — refreshes the Feedback Log of each screen spec from Jira (Jira → Figma, one way).
// Jira is read through the local helper (`npx screenspec-mcp sync`); this file only edits the Figma table.

var MARKERS = ["화면정의서", "Screen Spec"];
var TONE = {
  red: ["#fdebeb", "#e53030"], blue: ["#ebf1fd", "#3a6ce8"], gray: ["#eef0f3", "#5a606e"],
  orange: ["#fdf2e6", "#e67814"], green: ["#e7f6f0", "#10966e"], neutral: ["#eeeeee", "#787878"],
};
var COLOR = { ink: "#1a1a1a", sub: "#777777", ph: "#969caa", link: "#0052cc", fresh: "#e53030" };
var COLUMNS = {
  "요소": "element", "유형": "type", "Jira": "jira", "피드백 내용": "summary", "최근 댓글": "comment",
  "요청 → 담당": "flow", "상태": "status", "반영 버전": "fixVersion",
  "Element": "element", "Type": "type", "Feedback": "summary", "Latest comment": "comment",
  "Requester → Owner": "flow", "Status": "status", "Fix version": "fixVersion",
};
var TEXT = {
  ko: { noComment: "댓글 없음", fresh: function (n) { return "새 댓글 " + n; }, synced: function (d) { return "최종 동기화 " + d + " · Jira 기준"; } },
  en: { noComment: "No comments", fresh: function (n) { return n + " new"; }, synced: function (d) { return "Last synced " + d + " · from Jira"; } },
};

function rgb(hex) {
  var n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
function solid(hex) { return [{ type: "SOLID", color: rgb(hex) }]; }
function isExample(node) { return /예시|example/i.test(node.name); }

// ---------- reading ----------

function isSpecDoc(node) {
  return node.type === "FRAME" && node.name.indexOf("📄") === 0 &&
    MARKERS.some(function (m) { return node.name.indexOf(m) >= 0; });
}

/** Spec documents in the selection (or containing it); the whole page when nothing is selected. */
function findDocs() {
  var page = figma.currentPage;
  var picked = [];
  page.selection.forEach(function (n) {
    var p = n;
    while (p && p.type !== "PAGE") { if (isSpecDoc(p)) { picked.push(p); return; } p = p.parent; }
    if ("findAll" in n) n.findAll(isSpecDoc).forEach(function (d) { picked.push(d); });
  });
  var docs = picked.length ? picked : page.findAll(isSpecDoc);
  var seen = {};
  return docs.filter(function (d) { if (seen[d.id]) return false; seen[d.id] = true; return true; });
}

function docInfo(doc) {
  var m = /^📄\s*(\[[^\]]*\]|\S+)\s+(.*?)\s*·\s*(화면정의서|Screen Spec)\s*$/.exec(doc.name);
  var screenId = m ? m[1] : "";
  var table = doc.findOne(function (n) { return n.name === "feedback table"; });
  var keys = table ? table.children
    .filter(function (r) { return /^row\s*\/\s*/.test(r.name) && !isExample(r); })
    .map(function (r) { return r.name.replace(/^row\s*\/\s*/, "").trim(); }) : [];
  return {
    id: doc.id,
    screenId: screenId,
    title: m ? m[2] : doc.name,
    lang: m && m[3] === "Screen Spec" ? "en" : "ko",
    template: !screenId || /^\[.*\]$/.test(screenId),
    hasTable: !!table,
    keys: keys,
  };
}

/** "C-02-1" → element name from the "ITEM / 1 / 상품 리스트" card, if any. */
function itemName(doc, ref) {
  var no = /-(\d+)$/.exec(ref || "");
  if (!no) return "";
  var card = doc.findOne(function (n) { return new RegExp("^ITEM\\s*/\\s*" + no[1] + "\\s*/").test(n.name); });
  return card ? card.name.replace(/^ITEM\s*\/\s*\d+\s*\/\s*/, "").trim() : "";
}

// ---------- writing ----------

function textsIn(cell) {
  return cell.findAll(function (n) { return n.type === "TEXT"; });
}

function loadFonts(textNodes) {
  var fonts = {};
  textNodes.forEach(function (t) {
    var list = t.fontName === figma.mixed ? t.getRangeAllFontNames(0, t.characters.length) : [t.fontName];
    list.forEach(function (f) { fonts[f.family + "|" + f.style] = f; });
  });
  return Promise.all(Object.keys(fonts).map(function (k) { return figma.loadFontAsync(fonts[k]); }));
}

/**
 * Put `lines` into the cell's text nodes, adding or removing text lines as needed.
 * `styles[i]` may set { color, size, link } per line.
 */
function setLines(cell, lines, styles) {
  var texts = textsIn(cell);
  if (!texts.length) return;
  for (var i = texts.length; i < lines.length; i++) {
    var last = texts[texts.length - 1];
    var copy = last.clone();
    last.parent.insertChild(last.parent.children.indexOf(last) + 1, copy);
    copy.fontSize = 12;
    copy.fills = solid(COLOR.sub);
    texts.push(copy);
  }
  texts.forEach(function (t, i) {
    if (i >= lines.length) { if (i > 0) t.remove(); return; }
    t.characters = lines[i];
    var st = (styles && styles[i]) || {};
    if (st.color) t.fills = solid(st.color);
    if (st.size) t.fontSize = st.size;
    if (st.link !== undefined) t.hyperlink = st.link ? { type: "URL", value: st.link } : null;
  });
}

function setChip(cell, label, tone) {
  var t = textsIn(cell)[0];
  if (!t) return;
  t.characters = label || "—";
  var colors = TONE[tone] || TONE.gray;
  t.fills = solid(colors[1]);
  var chip = t.parent;
  if (chip && chip !== cell && "fills" in chip) chip.fills = solid(colors[0]);
}

function columnsOf(table) {
  var head = table.findChild(function (n) { return n.name === "head"; });
  if (!head) return [];
  return head.children.map(function (c) {
    var t = textsIn(c)[0];
    var label = t ? t.characters : c.name.replace(/^cell\s*\/\s*/, "");
    return COLUMNS[label] || label;
  });
}

function fillRow(row, columns, r, doc, lang) {
  var S = TEXT[lang];
  row.children.forEach(function (cell, i) {
    switch (columns[i]) {
      case "element": {
        var name = itemName(doc, r.element);
        setLines(cell, name ? [r.element, name] : [r.element || "—"], [{ color: r.element ? COLOR.ink : COLOR.ph }]);
        break;
      }
      case "type": setChip(cell, r.type, r.typeTone); break;
      case "jira": setLines(cell, r.epic ? [r.jiraKey + " ↗", r.epic] : [r.jiraKey + " ↗"], [{ color: COLOR.link, link: r.url }]); break;
      case "summary": setLines(cell, [r.summary], [{ color: COLOR.ink }]); break;
      case "comment":
        if (r.lastComment) {
          var meta = r.lastCommentMeta || "";
          if (r.newComments > 0) meta = S.fresh(r.newComments) + (meta ? " · " + meta : "");
          setLines(cell, ["“" + r.lastComment + "”", meta].filter(Boolean),
            [{ color: COLOR.ink, size: 14 }, { color: r.newComments > 0 ? COLOR.fresh : COLOR.sub, size: 12 }]);
        }
        else setLines(cell, [S.noComment], [{ color: COLOR.ph, size: 14 }]);
        break;
      case "flow": setLines(cell, [r.flow], [{ color: COLOR.ink }]); break;
      case "status": setChip(cell, r.status, r.statusTone); break;
      case "fixVersion": setLines(cell, [r.fixVersion || "—"], [{ color: r.fixVersion && r.fixVersion !== "—" ? COLOR.ink : COLOR.ph }]); break;
    }
  });
}

/** Comment total shown in a row's "latest comment" meta line ("… · 댓글 3" / "… · 3 comments"); 0 for "no comments". */
function commentCountIn(row, columns) {
  var i = columns.indexOf("comment");
  if (i < 0 || !row.children[i]) return null;
  var lines = textsIn(row.children[i]).map(function (t) { return t.characters; });
  if (lines.length < 2) return 0;
  var meta = lines[lines.length - 1];
  var m = /댓글\s*(\d+)\s*$/.exec(meta) || /(\d+)\s+comments?\s*$/i.exec(meta);
  return m ? Number(m[1]) : null;
}

function stamp(date) {
  var p = function (n) { return (n < 10 ? "0" : "") + n; };
  return date.getFullYear() + "." + p(date.getMonth() + 1) + "." + p(date.getDate()) + " " + p(date.getHours()) + ":" + p(date.getMinutes());
}

/**
 * Write Jira rows into one spec's Feedback Log.
 * Rows Jira no longer returns are left as they are (reported as `kept`); nothing is deleted.
 */
async function applyRows(doc, rows, syncedAt) {
  var info = docInfo(doc);
  var table = doc.findOne(function (n) { return n.name === "feedback table"; });
  if (!table) throw new Error(info.screenId + ": no 'feedback table' layer");
  await loadFonts(table.findAll(function (n) { return n.type === "TEXT"; }));

  var columns = columnsOf(table);
  var dataRows = table.children.filter(function (r) { return /^row\s*\/\s*/.test(r.name); });
  var template = dataRows.filter(function (r) { return !isExample(r); })[0] || dataRows[0];
  if (!template) throw new Error(info.screenId + ": the Feedback Log has no row to copy");

  var byKey = {};
  dataRows.forEach(function (r) { byKey[r.name.replace(/^row\s*\/\s*/, "").trim()] = r; });
  var headIndex = table.children.findIndex(function (n) { return n.name === "head"; });
  var added = [], updated = [], fresh = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var node = byKey[r.jiraKey];
    if (!node || isExample(node)) {
      node = template.clone();
      node.name = "row / " + r.jiraKey;
      node.visible = true;
      added.push(r.jiraKey);
    } else {
      updated.push(r.jiraKey);
      // Comments added in Jira since the last sync: compare with the count already in the table.
      var before = commentCountIn(node, columns);
      var n = before === null ? 0 : Math.max(0, (r.commentCount || 0) - before);
      if (n > 0) { r = Object.assign({}, r, { newComments: n }); fresh.push({ key: r.jiraKey, count: n }); }
    }
    table.insertChild(headIndex + 1 + i, node);
    fillRow(node, columns, r, doc, info.lang);
  }

  // Once real rows exist, hide the template's example row and its note.
  if (rows.length || info.keys.length) {
    table.children.forEach(function (n) {
      if ((/^row\s*\/\s*/.test(n.name) && isExample(n)) || n.name === "example tag") n.visible = false;
    });
  }

  var synced = doc.findOne(function (n) { return n.name === "last-synced" && n.type === "TEXT"; });
  if (synced) {
    await loadFonts([synced]);
    synced.characters = TEXT[info.lang].synced(stamp(syncedAt ? new Date(syncedAt) : new Date()));
  }

  var returned = {};
  rows.forEach(function (r) { returned[r.jiraKey] = true; });
  return {
    screenId: info.screenId,
    added: added,
    updated: updated,
    newComments: fresh,
    kept: info.keys.filter(function (k) { return !returned[k]; }),
  };
}

// ---------- plugin UI ----------

if (typeof __html__ !== "undefined") {
  figma.showUI(__html__, { width: 380, height: 460, themeColors: true });

  var postDocs = function () {
    figma.ui.postMessage({ type: "docs", docs: findDocs().map(docInfo).filter(function (d) { return !d.template && d.hasTable; }) });
  };
  postDocs();
  figma.on("selectionchange", postDocs);

  figma.ui.onmessage = async function (msg) {
    if (msg.type === "refresh") postDocs();
    if (msg.type === "getPrefs") {
      var auto = await figma.clientStorage.getAsync("autoSync");
      figma.ui.postMessage({ type: "prefs", autoSync: auto !== false });
    }
    if (msg.type === "setPrefs") await figma.clientStorage.setAsync("autoSync", !!msg.autoSync);
    if (msg.type === "apply") {
      try {
        var doc = await figma.getNodeByIdAsync(msg.docId);
        if (!doc) throw new Error("The spec frame is gone");
        var result = await applyRows(doc, msg.rows, msg.syncedAt);
        figma.ui.postMessage({ type: "applied", docId: msg.docId, result: result });
      } catch (e) {
        figma.ui.postMessage({ type: "applied", docId: msg.docId, error: String(e && e.message || e) });
      }
    }
    if (msg.type === "done") {
      figma.notify(msg.text, { timeout: 4000 });
      postDocs();
    }
    if (msg.type === "close") figma.closePlugin();
  };
}
