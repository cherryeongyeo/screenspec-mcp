import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG as cfg } from "../src/config.js";
import { FixtureSource } from "../src/figma/client.js";
import { createServer } from "../src/server.js";
import { bumpVersion, diffScreens } from "../src/spec/diff.js";
import { findScreenDocs, parseScreen } from "../src/spec/parse.js";
import type { FigmaNode } from "../src/spec/types.js";

const current = JSON.parse(readFileSync(new URL("./fixtures/sample-section.json", import.meta.url), "utf8"));

/** Older version of the M-07 sample: different policy, old element name, one element fewer in design. */
function olderVersion() {
  const old = structuredClone(current);
  const edit = (n: FigmaNode) => {
    if (n.id === "2956:18681") n.characters = "정렬: 최신순"; // Policy
    if (n.id === "2956:18660") n.characters = "기사 목록"; // element name
    if (n.id === "2956:18690") n.characters = "크기 · 여백 · 정렬 · Grid (spacing 토큰)"; // Layout was still a placeholder
    n.children?.forEach(edit);
  };
  edit(old.nodes["2914:18601"].document);
  return old;
}

const parse = (json: { nodes: Record<string, { document: FigmaNode }> }) =>
  parseScreen(findScreenDocs(json.nodes["2914:18601"].document, cfg).find((d) => d.name.includes("M-07"))!, cfg);

describe("diffScreens", () => {
  const d = diffScreens(parse(olderVersion()), parse(current));

  it("reports renamed elements and changed fields per side", () => {
    expect(d.unchanged).toBe(false);
    expect(d.changed).toHaveLength(1);
    const c = d.changed[0];
    expect(c).toMatchObject({ ref: "M-07-1", name: "목차 리스트", renamedFrom: "기사 목록" });
    expect(c.changes).toContainEqual({ side: "pm", label: "Policy", before: "정렬: 최신순", after: expect.stringContaining("지면 순서") });
    // placeholder → real value counts as "added" (before is empty)
    expect(c.changes).toContainEqual(expect.objectContaining({ side: "design", label: "Layout", before: "" }));
  });

  it("flags policy changes and suggests a change log row", () => {
    expect(d.policyChanged).toEqual(["M-07-1"]);
    expect(d.suggestedChangeLog).toMatchObject({ version: "v1.2", role: "PM/Design" });
    expect(d.suggestedChangeLog!.change).toContain("요소 1 목차 리스트");
    expect(d.suggestedChangeLog!.change).toContain("Policy");
  });

  it("is quiet when nothing changed", () => {
    expect(diffScreens(parse(current), parse(current)).unchanged).toBe(true);
  });

  it("bumps versions", () => {
    expect(bumpVersion("v1.2")).toBe("v1.3");
    expect(bumpVersion("2.9")).toBe("2.10");
  });
});

describe("diff_spec tool", () => {
  it("compares against the most recent named Figma version", async () => {
    const dir = mkdtempSync(join(tmpdir(), "screenspec-"));
    const file = join(dir, "fixture.json");
    writeFileSync(file, JSON.stringify({
      ...current,
      versions: [
        { id: "v-auto", label: null, created_at: "2026-10-12T05:00:00Z", nodes: current.nodes },
        { id: "v-11", label: "v1.1", created_at: "2026-09-10T05:00:00Z", nodes: olderVersion().nodes },
      ],
    }));
    const server = createServer(new FixtureSource(file), structuredClone(cfg));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(b);

    const r = await client.callTool({ name: "diff_spec", arguments: { fileKey: "F", nodeId: "2914:18601", screenId: "M-07" } });
    const data = JSON.parse((r.content as { text: string }[])[0].text);
    expect(data.comparedWith).toMatchObject({ versionId: "v-11", label: "v1.1" });
    expect(data.policyChanged).toEqual(["M-07-1"]);

    const none = await client.callTool({ name: "diff_spec", arguments: { fileKey: "F", nodeId: "2914:18601", screenId: "M-07", version: "nope" } });
    expect(none.isError).toBe(true);
    expect((none.content as { text: string }[])[0].text).toContain("Named versions: v1.1");
  });
});
