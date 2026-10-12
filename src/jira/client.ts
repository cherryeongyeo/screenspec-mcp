import { markdownToAdf } from "./adf.js";

export interface JiraIssueRef {
  key: string;
  url: string;
  summary?: string;
  status?: string;
}

export interface CreateIssueInput {
  projectKey: string;
  summary: string;
  issueType: string;
  labels: string[];
  /** Markdown; converted to Atlassian Document Format */
  description: string;
  parentKey?: string;
  extraFields?: Record<string, unknown>;
}

export interface IssueTracker {
  findOpenBySummary(projectKey: string, label: string, summaryPrefix: string): Promise<JiraIssueRef | undefined>;
  createIssue(input: CreateIssueInput): Promise<JiraIssueRef>;
  getIssue(key: string): Promise<JiraIssueRef>;
  /** Project keys the account can see (used to explain "project not found"). */
  listProjectKeys?(): Promise<string[]>;
}

type Fetch = typeof fetch;

/** Escape a value for a JQL double-quoted string. */
const jqlString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * Jira Cloud REST v3 client authenticated with an Atlassian account email
 * and API token (id.atlassian.com → Security → API tokens).
 */
export class JiraClient implements IssueTracker {
  private auth: string;
  constructor(
    private baseUrl: string,
    email: string,
    token: string,
    private http: Fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
  }

  browseUrl(key: string) {
    return `${this.baseUrl}/browse/${key}`;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.http(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: this.auth, Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 400);
      try {
        const j = JSON.parse(text);
        detail = [...(j.errorMessages ?? []), ...Object.entries(j.errors ?? {}).map(([k, v]) => `${k}: ${v}`)].join("; ") || detail;
      } catch { /* keep raw text */ }
      throw new Error(`Jira ${res.status} on ${method} ${path}: ${detail}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  async findOpenBySummary(projectKey: string, label: string, summaryPrefix: string) {
    const jql = `project = ${jqlString(projectKey)} AND labels = ${jqlString(label)} AND statusCategory != Done ORDER BY created DESC`;
    const r = await this.req<{ issues?: { key: string; fields: { summary: string; status?: { name: string } } }[] }>(
      "GET",
      `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary,status&maxResults=50`,
    );
    const hit = (r.issues ?? []).find((i) => i.fields.summary.startsWith(summaryPrefix));
    return hit && { key: hit.key, url: this.browseUrl(hit.key), summary: hit.fields.summary, status: hit.fields.status?.name };
  }

  async createIssue(input: CreateIssueInput) {
    const fields: Record<string, unknown> = {
      project: { key: input.projectKey },
      summary: input.summary,
      issuetype: { name: input.issueType },
      labels: input.labels.map((l) => l.replace(/\s+/g, "_")), // Jira labels can't contain spaces
      description: markdownToAdf(input.description),
      ...(input.parentKey ? { parent: { key: input.parentKey } } : {}),
      ...(input.extraFields ?? {}),
    };
    const r = await this.req<{ key: string }>("POST", "/rest/api/3/issue", { fields });
    return { key: r.key, url: this.browseUrl(r.key), summary: input.summary };
  }

  async listProjectKeys() {
    const r = await this.req<{ values?: { key: string }[] }>("GET", "/rest/api/3/project/search?maxResults=50");
    return (r.values ?? []).map((p) => p.key);
  }

  async getIssue(key: string) {
    const r = await this.req<{ key: string; fields: { summary: string; status?: { name: string } } }>(
      "GET",
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status`,
    );
    return { key: r.key, url: this.browseUrl(r.key), summary: r.fields.summary, status: r.fields.status?.name };
  }
}
