// mobile-ai-proto — phone-driven shared browser + claude agent.
//
// One real Chrome (persistent profile = your logins) lives on this machine.
// The phone gets a live screencast of it and can tap/scroll/type.
// Chat messages run `claude -p` in agent/, where the agent drives the SAME
// Chrome via tools/browse.mjs (CDP on 127.0.0.1:9223).
//
// Env knobs: APP_PORT (8788), HEADLESS=1, AGENT_MODEL (sonnet), CDP_PORT (9223)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.APP_PORT || 8788);
const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const HEADLESS = process.env.HEADLESS === "1";
const AGENT_MODEL = process.env.AGENT_MODEL || "sonnet";
const VIEW = { width: 412, height: 840 };

// ---- token (persisted; every request must carry ?t=<token>) ----
const TOKEN_FILE = path.join(HERE, ".token");
let TOKEN;
try { TOKEN = fs.readFileSync(TOKEN_FILE, "utf8").trim(); } catch {}
if (!TOKEN) { TOKEN = crypto.randomBytes(12).toString("hex"); fs.writeFileSync(TOKEN_FILE, TOKEN); }
const okToken = (url) => new URL(url, "http://x").searchParams.get("t") === TOKEN;

// ---- browser ----
let context, page, cdp;
const clients = new Set();
const send = (obj) => { const s = JSON.stringify(obj); for (const ws of clients) if (ws.readyState === 1) ws.send(s); };

async function attach(p) {
  page = p;
  try { if (cdp) await cdp.send("Page.stopScreencast").catch(() => {}); } catch {}
  cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", (ev) => {
    send({ type: "frame", data: ev.data });
    cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: VIEW.width * 2, maxHeight: VIEW.height * 2 }).catch(() => {});
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) send({ type: "url", url: page.url() }); });
  page.on("close", () => {
    const pages = context.pages().filter((x) => x !== page);
    if (pages.length) attach(pages[pages.length - 1]).catch(() => {});
  });
  send({ type: "url", url: page.url() });
}

async function startBrowser() {
  context = await chromium.launchPersistentContext(path.join(HERE, ".chrome-profile"), {
    channel: "chrome",
    headless: HEADLESS,
    viewport: VIEW,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    args: [`--remote-debugging-port=${CDP_PORT}`, "--disable-blink-features=AutomationControlled", "--hide-crash-restore-bubble"],
  });
  context.on("page", (p) => attach(p).catch((e) => console.error("attach:", e.message)));
  const p = context.pages()[0] || (await context.newPage());
  await attach(p);
  if (p.url() === "about:blank") await p.goto("https://www.google.com").catch(() => {});
}

// ---- agent (claude -p in agent/, browser tool via CDP) ----
let agentBusy = false;
let hasSession = fs.existsSync(path.join(HERE, "agent", ".started"));

function scrubbedEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_") || k === "ANTHROPIC_API_KEY") delete env[k];
  }
  env.CDP_PORT = String(CDP_PORT);
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
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (!okToken(req.url)) { res.writeHead(403); return res.end("bad token"); }
  if (u.pathname === "/" || u.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    return res.end(fs.readFileSync(path.join(HERE, "index.html")));
  }
  if (u.pathname === "/chat" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      if (agentBusy) { res.writeHead(429, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ reply: "agent is busy with the previous message — wait for it to finish" })); }
      agentBusy = true;
      send({ type: "agent", state: "working" });
      try {
        const { msg } = JSON.parse(body || "{}");
        const reply = await chat(String(msg || "").slice(0, 8000));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply: "server error: " + e.message }));
      } finally {
        agentBusy = false;
        send({ type: "agent", state: "idle" });
      }
    });
    return;
  }
  res.writeHead(404); res.end("nope");
});

// ---- ws: frames out, input in ----
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws, req) => {
  if (!okToken(req.url)) return ws.close();
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
  if (page) {
    ws.send(JSON.stringify({ type: "url", url: page.url() }));
    // screencast only emits on repaint — seed late joiners with a fresh shot
    page.screenshot({ type: "jpeg", quality: 60 })
      .then((buf) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: "frame", data: buf.toString("base64") })); })
      .catch(() => {});
  }
  ws.on("message", async (raw) => {
    if (!page) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    try {
      const px = (n, d) => Math.max(0, Math.min(d, Math.round(n * d)));
      if (m.type === "tap") await page.mouse.click(px(m.x, VIEW.width), px(m.y, VIEW.height));
      else if (m.type === "scroll") { await page.mouse.move(px(m.x ?? 0.5, VIEW.width), px(m.y ?? 0.5, VIEW.height)); await page.mouse.wheel(0, m.dy | 0); }
      else if (m.type === "text") await page.keyboard.insertText(String(m.text || ""));
      else if (m.type === "key") await page.keyboard.press(String(m.key));
      else if (m.type === "nav") { let url = String(m.url || "").trim(); if (url && !/^https?:\/\//.test(url)) url = url.includes(".") && !url.includes(" ") ? "https://" + url : "https://www.google.com/search?q=" + encodeURIComponent(url); if (url) await page.goto(url).catch(() => {}); }
      else if (m.type === "back") await page.goBack().catch(() => {});
    } catch (e) { /* input races page lifecycle; drop it */ }
  });
});

startBrowser().then(() => {
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`mobile-ai-proto on http://127.0.0.1:${PORT}/?t=${TOKEN}`);
  });
}).catch((e) => { console.error("browser failed to start:", e); process.exit(1); });
