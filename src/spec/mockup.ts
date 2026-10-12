import type { FigmaNode } from "./types.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Badge {
  no: number;
  nodeId: string;
  box: Rect;
}

export interface ElementRegion {
  no: number;
  mockupId: string;
  /** Region relative to the mockup frame's top-left corner */
  rect: Rect;
  /** How the region was found */
  source: "area" | "badge-node" | "badge-box";
  /** Node that defines the region (area layer or matched element) */
  nodeId?: string;
}

const MOCKUP_MARKERS = ["시안", "Mockup", "mockup"];
const isBadge = (n: FigmaNode) => n.type === "INSTANCE" && /^badge\b/i.test(n.name);
const areaNo = (n: FigmaNode) => {
  const m = /^area\s*\/\s*(\d+)\s*$/i.exec(n.name);
  return m ? Number(m[1]) : undefined;
};

function walk(n: FigmaNode, visit: (n: FigmaNode, depth: number) => void, depth = 0) {
  visit(n, depth);
  n.children?.forEach((c) => walk(c, visit, depth + 1));
}

/** Frames named like "<screenId> … 시안" / "<screenId> Mockup …" anywhere under root. */
export function findMockups(root: FigmaNode, screenId: string, markers = MOCKUP_MARKERS): FigmaNode[] {
  const out: FigmaNode[] = [];
  walk(root, (n) => {
    if ((n.type === "FRAME" || n.type === "SECTION" || n.type === "COMPONENT") &&
      n.name.includes(screenId) && markers.some((m) => n.name.includes(m))) out.push(n);
  });
  return out;
}

/** Badge number from the instance's TEXT property or its text child. */
function badgeNumber(n: FigmaNode): number | undefined {
  const prop = Object.values(n.componentProperties ?? {}).find((p) => p.type === "TEXT");
  let text = prop ? String(prop.value) : undefined;
  if (!text) walk(n, (c) => { if (!text && c.type === "TEXT") text = c.characters ?? c.name; });
  const num = Number(String(text ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

export function findBadges(mockup: FigmaNode): Badge[] {
  const out: Badge[] = [];
  walk(mockup, (n) => {
    if (!isBadge(n) || n.visible === false || !n.absoluteBoundingBox) return;
    const no = badgeNumber(n);
    if (no) out.push({ no, nodeId: n.id, box: n.absoluteBoundingBox });
  });
  return out;
}

const contains = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
const area = (r: Rect) => r.width * r.height;
const relative = (r: Rect, origin: Rect): Rect => ({
  x: Math.round(r.x - origin.x), y: Math.round(r.y - origin.y), width: Math.round(r.width), height: Math.round(r.height),
});

/**
 * Where element `no` sits on the mockup:
 *  1. a layer named `area / <no>` (explicit, most precise)
 *  2. the smallest layer just inside the badge's center
 *     (place the badge's center on the top-left corner of the element it marks)
 *  3. a fixed box next to the badge
 */
export function regionFor(mockup: FigmaNode, no: number): ElementRegion | undefined {
  const frame = mockup.absoluteBoundingBox;
  if (!frame) return undefined;

  let areaNode: FigmaNode | undefined;
  walk(mockup, (n) => { if (!areaNode && areaNo(n) === no && n.absoluteBoundingBox) areaNode = n; });
  if (areaNode) return { no, mockupId: mockup.id, rect: relative(areaNode.absoluteBoundingBox!, frame), source: "area", nodeId: areaNode.id };

  const badge = findBadges(mockup).find((b) => b.no === no);
  if (!badge) return undefined;
  const px = badge.box.x + badge.box.width / 2 + 2;
  const py = badge.box.y + badge.box.height / 2 + 2;

  let best: FigmaNode | undefined;
  walk(mockup, (n, depth) => {
    if (depth === 0 || isBadge(n) || areaNo(n) !== undefined || n.visible === false || !n.absoluteBoundingBox) return;
    if (isInsideBadge(n, mockup)) return;
    const r = n.absoluteBoundingBox;
    if (!contains(r, px, py)) return;
    if (area(r) >= area(frame) * 0.9) return; // the whole screen is not an element
    if (!best || area(r) < area(best.absoluteBoundingBox!)) best = n;
  });
  if (best) return { no, mockupId: mockup.id, rect: relative(best.absoluteBoundingBox!, frame), source: "badge-node", nodeId: best.id };

  const box: Rect = { x: badge.box.x, y: badge.box.y, width: 320, height: 200 };
  return { no, mockupId: mockup.id, rect: clamp(relative(box, frame), frame), source: "badge-box" };
}

function isInsideBadge(n: FigmaNode, mockup: FigmaNode): boolean {
  let inside = false;
  const visit = (p: FigmaNode, underBadge: boolean) => {
    if (p === n) inside = underBadge;
    p.children?.forEach((c) => visit(c, underBadge || isBadge(p)));
  };
  visit(mockup, false);
  return inside;
}

function clamp(r: Rect, frame: Rect): Rect {
  const width = Math.max(1, Math.min(r.width, frame.width - r.x));
  const height = Math.max(1, Math.min(r.height, frame.height - r.y));
  return { x: Math.max(0, r.x), y: Math.max(0, r.y), width, height };
}

/** Grow a region by `pad` px on every side, within the frame. */
export function pad(r: Rect, frame: { width: number; height: number }, padPx = 16): Rect {
  const x = Math.max(0, r.x - padPx);
  const y = Math.max(0, r.y - padPx);
  return {
    x, y,
    width: Math.min(frame.width - x, r.width + padPx * 2),
    height: Math.min(frame.height - y, r.height + padPx * 2),
  };
}
