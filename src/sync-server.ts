import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { FeedbackSource, Lang } from "./jira/feedback.js";

export const DEFAULT_SYNC_PORT = 3917;

export interface SyncServerOptions {
  source?: FeedbackSource;
  version: string;
  projectKey?: string;
}

/**
 * Requests from the Figma plugin come from a sandboxed iframe (Origin "null") or figma.com.
 * Any other web page is refused, so a site you visit can't read your Jira through this helper.
 */
export function allowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true; // curl, scripts on this machine
  if (origin === "null") return true; // Figma plugin UI iframe
  return /^https:\/\/([a-z0-9-]+\.)*figma\.com$/i.test(origin);
}

function send(res: ServerResponse, status: number, body: unknown, origin?: string) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin !== undefined && allowedOrigin(origin)
      ? { "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Private-Network": "true" }
      : {}),
  });
  res.end(JSON.stringify(body));
}

/**
 * Local helper for the Figma plugin's Sync button: the plugin can't call Jira directly
 * (Jira doesn't allow browser requests), so it asks this server on 127.0.0.1 instead.
 */
export function createSyncServer(opts: SyncServerOptions): Server {
  return createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (!allowedOrigin(origin)) return send(res, 403, { error: "Origin not allowed" });

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": origin ?? "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Private-Network": "true",
        Vary: "Origin",
      });
      return res.end();
    }
    if (req.method !== "GET") return send(res, 405, { error: "GET only" }, origin);

    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/health") {
      return send(res, 200, { ok: true, name: "screenspec-mcp sync", version: opts.version, jira: !!opts.source }, origin);
    }
    if (url.pathname === "/feedback") {
      if (!opts.source) {
        return send(res, 503, { error: "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN (e.g. in .env) and restart." }, origin);
      }
      const screenId = url.searchParams.get("screenId") ?? "";
      if (!/^[\p{L}\p{N}_-]{1,40}$/u.test(screenId)) return send(res, 400, { error: "screenId is required, e.g. C-02" }, origin);
      const lang: Lang = url.searchParams.get("lang") === "en" ? "en" : "ko";
      const keys = (url.searchParams.get("keys") ?? "").split(",").map((k) => k.trim()).filter(Boolean).slice(0, 100);
      try {
        const rows = await opts.source.searchFeedback(screenId, { projectKey: opts.projectKey, keys, lang });
        return send(res, 200, { screenId, syncedAt: new Date().toISOString(), rows }, origin);
      } catch (e) {
        return send(res, 502, { error: e instanceof Error ? e.message : String(e) }, origin);
      }
    }
    return send(res, 404, { error: "Not found" }, origin);
  });
}
