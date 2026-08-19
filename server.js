// mobile-ai-proto bridge — the agent's server side.
//
// The BROWSER lives on the phone (app/ — a WebView inside the Expo app, with
// the user's own cookies). The phone app connects OUT to this bridge over WS.
// Chat messages run `claude -p` in agent/; the agent's tools/browse.mjs POSTs
// commands to /cmd here, which relays them to the phone's WebView and returns
// the result.
//
//   phone app (WebView + chat) ──WS──▶ this bridge ──spawn──▶ claude -p
//                    ▲                    │ /cmd  ◀── tools/browse.mjs ┘
//                    └──── cmd/result ────┘
//
// Env knobs: APP_PORT (8788), AGENT_MODEL (sonnet)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.APP_PORT || 8788);
const AGENT_MODEL = process.env.AGENT_MODEL || "sonnet";

// ---- token (persisted; every request must carry ?t=<token>) ----
const TOKEN_FILE = path.join(HERE, ".token");
let TOKEN;
try { TOKEN = fs.readFileSync(TOKEN_FILE, "utf8").trim(); } catch {}
if (!TOKEN) { TOKEN = crypto.randomBytes(12).toString("hex"); fs.writeFileSync(TOKEN_FILE, TOKEN); }
const okToken = (url) => new URL(url, "http://x").searchParams.get("t") === TOKEN;

// ---- phone device link ----
let device = null;
const pending = new Map(); // id -> {resolve, reject, timer}

function devCmd(cmd, args, timeoutMs = 25_000) {
  if (!device || device.readyState !== 1) return Promise.reject(new Error("phone app not connected — open the app on the phone"));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("phone timed out")); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    device.send(JSON.stringify({ type: "cmd", id, cmd, args }));
  });
}

// ---- agent (claude -p in agent/) ----
let agentBusy = false;
let hasSession = fs.existsSync(path.join(HERE, "agent", ".started"));

function scrubbedEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_") || k === "ANTHROPIC_API_KEY") delete env[k];
  }
  env.APP_PORT = String(PORT);
  return env;
}

function runClaude(msg, useContinue) {
  return new Promise((resolve) => {
    const args = ["-p", msg, "--model", AGENT_MODEL, "--dangerously-skip-permissions"];
    if (useContinue) args.splice(2, 0, "--continue");
    const child = spawn("claude", args, { cwd: path.join(HERE, "agent"), env: scrubbedEnv() });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve({ ok: false, out, err: "timeout after 300s" }); }, 300_000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, out, err }); });
  });
}

async function chat(msg) {
  let r = await runClaude(msg, hasSession);
  if (!r.ok && hasSession && /no conversation|continue/i.test(r.err)) r = await runClaude(msg, false);
  if (r.ok) {
    hasSession = true;
    try { fs.writeFileSync(path.join(HERE, "agent", ".started"), "1"); } catch {}
    return r.out.trim() || "(no reply)";
  }
  return `agent error: ${(r.err || r.out).trim().slice(0, 500)}`;
}

// ---- http ----
const readBody = (req) => new Promise((res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => res(b)); });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (!okToken(req.url)) return json(403, { error: "bad token" });

  if (u.pathname === "/" || u.pathname === "/status") {
    return json(200, { ok: true, phone: !!(device && device.readyState === 1), agentBusy });
  }
  if (u.pathname === "/cmd" && req.method === "POST") {
    try {
      const { cmd, args } = JSON.parse(await readBody(req) || "{}");
      const result = await devCmd(String(cmd), args || {});
      return json(200, { ok: true, result });
    } catch (e) { return json(200, { ok: false, error: e.message }); }
  }
  if (u.pathname === "/chat" && req.method === "POST") {
    const body = await readBody(req);
    if (agentBusy) return json(429, { reply: "agent is busy with the previous message — wait for it to finish" });
    agentBusy = true;
    try {
      const { msg } = JSON.parse(body || "{}");
      return json(200, { reply: await chat(String(msg || "").slice(0, 8000)) });
    } catch (e) { return json(500, { reply: "server error: " + e.message }); }
    finally { agentBusy = false; }
  }
  json(404, { error: "nope" });
});

// ---- ws: the phone app ----
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws, req) => {
  if (!okToken(req.url)) return ws.close();
  device = ws; // last phone wins — it's a one-user prototype
  console.log("phone connected");
  ws.on("close", () => { if (device === ws) device = null; console.log("phone disconnected"); });
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === "result" && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      clearTimeout(p.timer);
      m.ok ? p.resolve(m.r) : p.reject(new Error(m.err || "command failed on phone"));
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`bridge on http://0.0.0.0:${PORT}  token=${TOKEN}`);
});
