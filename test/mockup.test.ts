import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { cropPng } from "../src/figma/crop.js";
import type { FigmaSource } from "../src/figma/client.js";
import { createServer } from "../src/server.js";
import { findBadges, findMockups, regionFor } from "../src/spec/mockup.js";
import type { FigmaNode } from "../src/spec/types.js";

// --- the ENG cart sample spec (exported from Figma) + a synthetic mockup frame ---
type Compact = [string, string, string, (Compact[] | string)?];
const TYPES: Record<string, string> = { F: "FRAME", T: "TEXT", I: "INSTANCE" };
const expand = ([id, name, t, rest]: Compact): FigmaNode => {
  const n: FigmaNode = { id: `1:${id}`, name, type: TYPES[t] };
  if (t === "T") n.characters = name;
  if (t === "I") n.componentProperties = { v: { type: "VARIANT", value: String(rest ?? "") } };
  else if (Array.isArray(rest)) n.children = rest.map(expand);
  return n;
};
const specDoc = expand(JSON.parse(readFileSync(new URL("./fixtures/compact-en.json", import.meta.url), "utf8")));

const box = (x: number, y: number, width: number, height: number) => ({ x: 1000 + x, y: 500 + y, width, height });
const badge = (id: string, no: number, x: number, y: number): FigmaNode => ({
  id, name: "badge / mockup", type: "INSTANCE", absoluteBoundingBox: box(x, y, 24, 24),
  componentProperties: { "No#1:0": { type: "TEXT", value: String(no) } },
  children: [{ id: id + ";t", name: "1", type: "TEXT", characters: String(no), absoluteBoundingBox: box(x + 8, y + 4, 8, 16) }],
});
const mockup: FigmaNode = {
  id: "9:1", name: "C-02 Cart list · Mockup", type: "FRAME", absoluteBoundingBox: box(0, 0, 400, 300),
  children: [
    { id: "9:2", name: "list", type: "FRAME", absoluteBoundingBox: box(20, 40, 360, 200), children: [
      { id: "9:3", name: "row 1", type: "FRAME", absoluteBoundingBox: box(20, 40, 360, 56) },
    ] },
    { id: "9:4", name: "area / 2", type: "RECTANGLE", absoluteBoundingBox: box(100, 150, 50, 50) },
    badge("9:5", 1, 10, 30),
    badge("9:6", 2, 10, 100),
    badge("9:7", 7, 300, 260),
  ],
};
const root: FigmaNode = { id: "0:0", name: "doc", type: "DOCUMENT", children: [{ id: "0:1", name: "Page", type: "CANVAS", children: [specDoc, mockup] }] };

describe("mockup regions", () => {
  it("finds the mockup and its badges", () => {
    expect(findMockups(root, "C-02").map((m) => m.id)).toEqual(["9:1"]);
    expect(findBadges(mockup).map((b) => b.no)).toEqual([1, 2, 7]);
  });

  it("uses the smallest layer under the badge corner", () => {
    expect(regionFor(mockup, 1)).toMatchObject({ source: "badge-node", nodeId: "9:3", rect: { x: 20, y: 40, width: 360, height: 56 } });
  });

  it("prefers an explicit area layer", () => {
    expect(regionFor(mockup, 2)).toMatchObject({ source: "area", nodeId: "9:4", rect: { x: 100, y: 150, width: 50, height: 50 } });
  });

  it("falls back to a box next to the badge, and knows nothing about unknown numbers", () => {
    expect(regionFor(mockup, 7)).toMatchObject({ source: "badge-box", rect: { x: 300, y: 260, width: 100, height: 40 } });
    expect(regionFor(mockup, 3)).toBeUndefined();
  });
});

describe("cropPng", () => {
  it("crops in frame coordinates at the render scale", () => {
    const src = new PNG({ width: 800, height: 600 });
    const out = PNG.sync.read(cropPng(PNG.sync.write(src), { x: 20, y: 40, width: 100, height: 50 }, 2));
    expect([out.width, out.height]).toEqual([200, 100]);
  });
});

describe("get_element / lint_spec with a mockup", () => {
  const blank = PNG.sync.write(new PNG({ width: 800, height: 600 }));
  const source: FigmaSource = {
    async getNode(_f, id) {
      let hit: FigmaNode | undefined;
      const visit = (n: FigmaNode) => { if (n.id === id) hit = n; n.children?.forEach(visit); };
      visit(root);
      if (!hit) throw new Error("not found");
      return hit;
    },
    async getFile() { return root; },
    async getVersions() { return []; },
    async getImages(_f, ids) { return Object.fromEntries(ids.map((id) => [id, `https://img/${id}.png`])); },
    async download() { return blank; },
    async getDevResources() { return []; },
    async addDevResource(r) { return r; },
  };

  async function call(name: string, args: Record<string, unknown>) {
    const server = createServer(source, structuredClone(DEFAULT_CONFIG));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);
    return client.callTool({ name, arguments: args });
  }

  it("attaches a cropped PNG of the element", async () => {
    const r = await call("get_element", { fileKey: "F", nodeId: "1:247", item: 1 });
    const content = r.content as ({ type: "text"; text: string } | { type: "image"; data: string })[];
    const data = JSON.parse((content[0] as { text: string }).text);
    expect(data.mockup).toMatchObject({ found: true, source: "badge-node", region: { x: 4, y: 24, width: 392, height: 88 } });
    const img = content.find((c) => c.type === "image") as { data: string };
    const png = PNG.sync.read(Buffer.from(img.data, "base64"));
    expect([png.width, png.height]).toEqual([784, 176]); // padded region × scale 2
  });

  it("lint flags badges without element cards", async () => {
    const r = await call("lint_spec", { fileKey: "F", nodeId: "1:247" });
    const data = JSON.parse((r.content as { text: string }[])[0].text);
    expect(data.mockups[0].badges).toEqual([1, 2, 7]);
    expect(data.issues.map((i: { message: string }) => i.message)).toContain("Badge 7 on the mockup has no element card.");
  });
});
