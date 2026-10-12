import { readFileSync } from "node:fs";
import type { FigmaNode } from "../spec/types.js";

export interface FigmaSource {
  /** Subtree for a node (screen frame, section, or page), optionally at a past file version. */
  getNode(fileKey: string, nodeId: string, version?: string): Promise<FigmaNode>;
  /** File version history, newest first. */
  getVersions(fileKey: string): Promise<FileVersion[]>;
  /** Shallow file tree used to discover screen specs. */
  getFile(fileKey: string, depth: number): Promise<FigmaNode>;
  /** Rendered PNG URLs for nodes. */
  getImages(fileKey: string, nodeIds: string[], scale?: number): Promise<Record<string, string | null>>;
  /** Download a rendered image. */
  download(url: string): Promise<Buffer>;
  /** Dev Resources (links shown in Dev Mode) attached to nodes. */
  getDevResources(fileKey: string, nodeIds: string[]): Promise<DevResource[]>;
  /** Attach a link to a node. Needs the file_dev_resources:write scope. */
  addDevResource(res: Omit<DevResource, "id">): Promise<DevResource>;
}

export interface FileVersion {
  id: string;
  created_at: string;
  label: string | null;
  description: string | null;
  user?: { handle?: string };
}

export interface DevResource {
  id?: string;
  name: string;
  url: string;
  file_key: string;
  node_id: string;
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
  constructor(private token: string, private ttlMs = 60_000, private http: typeof fetch = fetch) {}

  private async get<T>(path: string): Promise<T> {
    const hit = this.cache.get(path);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.data as T;
    const res = await this.http(`https://api.figma.com${path}`, { headers: { "X-Figma-Token": this.token } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Figma API ${res.status} on ${path}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as T;
    this.cache.set(path, { at: Date.now(), data });
    return data;
  }

  async getNode(fileKey: string, nodeId: string, version?: string) {
    const r = await this.get<{ nodes: Record<string, { document: FigmaNode } | null> }>(
      `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}${version ? `&version=${encodeURIComponent(version)}` : ""}`,
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

  async download(url: string) {
    const res = await this.http(url);
    if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async getVersions(fileKey: string) {
    const r = await this.get<{ versions: FileVersion[] }>(`/v1/files/${fileKey}/versions`);
    return r.versions ?? [];
  }

  async getDevResources(fileKey: string, nodeIds: string[]) {
    const r = await this.get<{ dev_resources: DevResource[] }>(
      `/v1/files/${fileKey}/dev_resources?node_ids=${encodeURIComponent(nodeIds.join(","))}`,
    );
    return r.dev_resources ?? [];
  }

  async addDevResource(res: Omit<DevResource, "id">) {
    const r = await this.http("https://api.figma.com/v1/dev_resources", {
      method: "POST",
      headers: { "X-Figma-Token": this.token, "Content-Type": "application/json" },
      body: JSON.stringify({ dev_resources: [res] }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      links_created?: DevResource[];
      errors?: { error: string }[];
      message?: string;
    };
    if (!r.ok || body.errors?.length || !body.links_created?.length) {
      const why = body.errors?.map((e) => e.error).join("; ") || body.message || `HTTP ${r.status}`;
      throw new Error(`Figma dev resource not created: ${why}`);
    }
    // invalidate cached listings for this file
    for (const k of this.cache.keys()) if (k.includes(`/files/${res.file_key}/dev_resources`)) this.cache.delete(k);
    return body.links_created[0];
  }
}

/**
 * Offline source backed by a saved `GET /v1/files/:key/nodes` response.
 * Used for tests, demos, and trying the server without a Figma token.
 */
export class FixtureSource implements FigmaSource {
  private root: FigmaNode;
  private versions: (FileVersion & { root: FigmaNode })[] = [];
  constructor(path: string) {
    const json = JSON.parse(readFileSync(path, "utf8"));
    const toRoot = (nodes: Record<string, { document: FigmaNode }>): FigmaNode => ({
      id: "0:0", name: "fixture", type: "DOCUMENT", children: Object.values(nodes).map((n) => n.document),
    });
    this.root = toRoot(json.nodes);
    // Optional past versions: [{ id, label, created_at, nodes }], newest first.
    for (const v of json.versions ?? []) this.versions.push({ ...v, description: v.description ?? null, root: toRoot(v.nodes) });
  }
  async getNode(_fileKey: string, nodeId: string, version?: string) {
    const root = version ? this.versions.find((v) => v.id === version)?.root : this.root;
    if (!root) throw new Error(`Version ${version} not found in fixture`);
    let hit: FigmaNode | undefined;
    const visit = (n: FigmaNode) => {
      if (hit) return;
      if (n.id === nodeId) hit = n;
      else n.children?.forEach(visit);
    };
    visit(root);
    if (!hit) throw new Error(`Node ${nodeId} not found in fixture`);
    return hit;
  }
  async getVersions() {
    return this.versions.map(({ root: _root, ...v }) => v);
  }
  async getFile() {
    return this.root;
  }
  async getImages(_fileKey: string, nodeIds: string[]) {
    return Object.fromEntries(nodeIds.map((id) => [id, null]));
  }
  async download(): Promise<Buffer> {
    throw new Error("Images are not available in offline fixture mode");
  }
  /** In-memory dev resources so offline runs can exercise the Jira flow. */
  private links: DevResource[] = [];
  async getDevResources(_fileKey: string, nodeIds: string[]) {
    return this.links.filter((l) => nodeIds.includes(l.node_id));
  }
  async addDevResource(res: Omit<DevResource, "id">) {
    const link = { ...res, id: `fixture-${this.links.length + 1}` };
    this.links.push(link);
    return link;
  }
}
