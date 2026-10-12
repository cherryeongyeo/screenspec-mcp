/**
 * Minimal Markdown → Atlassian Document Format converter for the subset
 * draft_jira_ticket produces: headings, blockquotes, bullet / checkbox lists,
 * paragraphs, **bold** and [links](url).
 */

type Mark = { type: "strong" } | { type: "link"; attrs: { href: string } };
type Inline = { type: "text"; text: string; marks?: Mark[] };
type Block = { type: string; attrs?: Record<string, unknown>; content?: (Block | Inline)[] };

export interface AdfDoc {
  type: "doc";
  version: 1;
  content: Block[];
}

/** Inline formatting: **bold** and [text](url). */
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: "text", text: m[1], marks: [{ type: "strong" }] });
    else out.push({ type: "text", text: m[2], marks: [{ type: "link", attrs: { href: m[3] } }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out.filter((n) => n.text.length > 0);
}

const para = (text: string): Block => ({ type: "paragraph", content: inline(text) });

export function markdownToAdf(md: string): AdfDoc {
  const content: Block[] = [];
  let list: Block | null = null;
  const flush = () => {
    if (list) content.push(list);
    list = null;
  };

  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    const item = /^[-*]\s+(?:\[( |x)\]\s+)?(.*)$/.exec(line);

    if (!line.trim()) { flush(); continue; }
    if (item) {
      // Checkbox items become "☐ text" so they render in every Jira editor.
      const text = item[1] !== undefined ? `${item[1] === "x" ? "☑" : "☐"} ${item[2]}` : item[2];
      list ??= { type: "bulletList", content: [] };
      list.content!.push({ type: "listItem", content: [para(text)] });
      continue;
    }
    flush();
    if (heading) content.push({ type: "heading", attrs: { level: Math.min(heading[1].length, 6) }, content: inline(heading[2]) });
    else if (quote) content.push({ type: "blockquote", content: [para(quote[1])] });
    else content.push(para(line));
  }
  flush();
  return { type: "doc", version: 1, content };
}
