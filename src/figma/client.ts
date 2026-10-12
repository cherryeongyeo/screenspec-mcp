import { readFileSync } from "node:fs";
import type { FigmaNode } from "../spec/types.js";

export interface FigmaSource {
  /** Subtree for a node (screen frame, section, or page). */
  getNode(fileKey: string, nodeId: string): Promise<FigmaNode>;
  /** Shallow file tree used to discover screen specs. */
  getFile(fileKey: string, depth: number): Promise<FigmaNode>;
  /** Rendered PNG URLs for nodes. */
  getImages(fileKey: string, nodeIds: string[], scale?: number): Promise<Record<string, string | null>>;
}

/** Accepts a Figma URL or a bare key/node pair. */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  const branch = parts.indexOf("branch");
  const fileKey = branch >= 0 ? parts[branch + 1] : parts[1];
  const node = u.searchParams.get("node-id");
  return { fileKey, nodeId: node ? node.replace("-", ":") : undefined };
}

export class FigmaRestClient implements FigmaSource {
  private cache = new Map<string, { at: number; data: unknown }>();
  constructor(private token: string, private ttlMs = 60_000) {}

  private async get<T>(path: string): Promise<T> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.data as T;
    const res = await fetch(`https://api.figma.com${path}`, { headers: { "X-Figma-Token": this.token } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Figma API ${res.status} on ${path}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as T;
    this.cache.set(path, { at: Date.now(), data });
    return data;
  }

  async getNode(fileKey: string, nodeId: string) {
    const r = await this.get<{ nodes: Record<string, { document: FigmaNode } | null> }>(
      `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`,
    );
    const n = r.nodes[nodeId];
    if (!n) throw new Error(`Node ${nodeId} not found in file ${fileKey}`);
    return n.document;
  }

  async getFile(fileKey: string, depth: number) {
    const r = await this.get<{ document: FigmaNode }>(`/v1/files/${fileKey}?depth=${depth}`);
    return r.document;
  }

  async getImages(fileKey: string, nodeIds: string[], scale = 1) {
    const r = await this.get<{ images: Record<string, string | null> }>(
      `/v1/images/${fileKey}?ids=${encodeURIComponent(nodeIds.join(","))}&format=png&scale=${scale}`,
    );
    return r.images;
  }
}

/**
 * Offline source backed by a saved `GET /v1/files/:key/nodes` response.
 * Used for tests, demos, and trying the server without a Figma token.
 */
export class FixtureSource implements FigmaSource {
  private root: FigmaNode;
  constructor(path: string) {
    const json = JSON.parse(readFileSync(path, "utf8"));
    const docs = Object.values(json.nodes as Record<string, { document: FigmaNode }>).map((n) => n.document);
    this.root = { id: "0:0", name: "fixture", type: "DOCUMENT", children: docs };
  }
  async getNode(_fileKey: string, nodeId: string) {
    let hit: FigmaNode | undefined;
    const visit = (n: FigmaNode) => {
      if (hit) return;
      if (n.id === nodeId) hit = n;
      else n.children?.forEach(visit);
    };
    visit(this.root);
    if (!hit) throw new Error(`Node ${nodeId} not found in fixture`);
    return hit;
  }
  async getFile() {
    return this.root;
  }
  async getImages(_fileKey: string, nodeIds: string[]) {
    return Object.fromEntries(nodeIds.map((id) => [id, null]));
  }
}
