import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LABEL = "com.screenspec-mcp.sync";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** launchd agent that starts the sync helper at login and restarts it if it stops. */
export function launchAgentPlist(opts: { node: string; script: string; cwd: string; port: number; logDir: string }): string {
  const args = [opts.node, opts.script, "sync", "--port", String(opts.port)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key><string>${esc(opts.cwd)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${esc(join(opts.logDir, "screenspec-sync.log"))}</string>
  <key>StandardErrorPath</key><string>${esc(join(opts.logDir, "screenspec-sync.log"))}</string>
</dict>
</plist>
`;
}

const plistPath = () => join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

function launchctl(...args: string[]) {
  try { execFileSync("launchctl", args, { stdio: "ignore" }); } catch { /* not loaded yet */ }
}

/** `screenspec-mcp sync --install`: start the helper at every login (macOS). Reads .env from the current folder. */
export function installAutostart(port: number) {
  if (process.platform !== "darwin") throw new Error("--install uses macOS launchd. On other systems, start `screenspec-mcp sync` with your OS's startup tool.");
  const script = realpathSync(process.argv[1]);
  if (script.includes("/_npx/")) {
    console.error("Note: running from the npx cache, which can be cleared. For a stable setup, `npm i -g screenspec-mcp` first and run `screenspec-mcp sync --install` again.");
  }
  const logDir = join(homedir(), "Library", "Logs");
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  mkdirSync(logDir, { recursive: true });
  const path = plistPath();
  writeFileSync(path, launchAgentPlist({ node: process.execPath, script, cwd: process.cwd(), port, logDir }));
  const domain = `gui/${process.getuid?.() ?? 501}`;
  launchctl("bootout", domain, path);
  launchctl("bootstrap", domain, path);
  console.error(`Installed: the sync helper now starts at login (port ${port}).`);
  console.error(`Settings are read from ${join(process.cwd(), ".env")}. Log: ${join(logDir, "screenspec-sync.log")}`);
  console.error("Remove with: screenspec-mcp sync --uninstall");
}

export function uninstallAutostart() {
  const path = plistPath();
  if (!existsSync(path)) { console.error("Not installed."); return; }
  launchctl("bootout", `gui/${process.getuid?.() ?? 501}`, path);
  unlinkSync(path);
  console.error("Removed: the sync helper no longer starts at login.");
}
