#!/usr/bin/env node
// browse.mjs — the agent's hands on the shared Chrome (CDP 127.0.0.1:9223).
// Usage:
//   node browse.mjs goto <url>
//   node browse.mjs read              # url + title + visible text
//   node browse.mjs ui                # numbered list of clickable/typable elements
//   node browse.mjs tapi <n>          # click element #n from the last `ui` listing
//   node browse.mjs tap "<text>"      # click first element containing text
//   node browse.mjs type "<text>"     # type into the focused element
//   node browse.mjs press <Key>       # Enter, Escape, Backspace, Tab, ArrowDown...
//   node browse.mjs scroll <dy>       # positive = down
//   node browse.mjs click <x> <y>     # viewport px (412x840)
//   node browse.mjs shot              # screenshot -> prints a file path to Read
//   node browse.mjs back

import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CDP = `http://127.0.0.1:${process.env.CDP_PORT || 9223}`;
const [cmd, ...args] = process.argv.slice(2);

const UI_SEL = 'a, button, input, textarea, select, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="option"], [contenteditable="true"]';

function collectUi() {
  const els = [...document.querySelectorAll(window.__UI_SEL)];
  const out = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
    const label = (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || el.title || "").trim().replace(/\s+/g, " ").slice(0, 80);
    const tag = el.tagName.toLowerCase() + (el.type ? `[${el.type}]` : "");
    out.push({ label, tag, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
  }
  return out.slice(0, 120);
}

const browser = await chromium.connectOverCDP(CDP);
const context = browser.contexts()[0];
const pages = context.pages();
const page = pages[pages.length - 1];
if (!page) { console.error("no page open"); process.exit(1); }
const uiFile = path.join(os.tmpdir(), "browse-ui.json");

try {
  if (cmd === "goto") {
    await page.goto(args[0], { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => console.log("(nav note: " + e.message.split("\n")[0] + ")"));
    await page.waitForTimeout(1500);
    console.log("now at:", page.url(), "—", await page.title());
  } else if (cmd === "read") {
    console.log("URL:", page.url());
    console.log("TITLE:", await page.title());
    const text = await page.evaluate(() => document.body?.innerText || "");
    console.log(text.replace(/\n{3,}/g, "\n\n").slice(0, 7000));
  } else if (cmd === "ui") {
    await page.evaluate((sel) => { window.__UI_SEL = sel; }, UI_SEL);
    const items = await page.evaluate(collectUi);
    fs.writeFileSync(uiFile, JSON.stringify(items));
    items.forEach((it, i) => console.log(`${i}: [${it.tag}] ${it.label || "(no label)"} @${it.x},${it.y}`));
    if (!items.length) console.log("(no interactive elements visible — try scroll or shot)");
  } else if (cmd === "tapi") {
    const items = JSON.parse(fs.readFileSync(uiFile, "utf8"));
    const it = items[Number(args[0])];
    if (!it) throw new Error("no such index — run `ui` again");
    await page.mouse.click(it.x, it.y);
    await page.waitForTimeout(1200);
    console.log(`clicked #${args[0]} (${it.label}) — now at: ${page.url()}`);
  } else if (cmd === "tap") {
    const t = args.join(" ");
    const loc = page.getByText(t, { exact: false }).first();
    await loc.click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    console.log(`clicked "${t}" — now at: ${page.url()}`);
  } else if (cmd === "type") {
    await page.keyboard.insertText(args.join(" "));
    console.log("typed.");
  } else if (cmd === "press") {
    await page.keyboard.press(args[0]);
    await page.waitForTimeout(800);
    console.log(`pressed ${args[0]} — now at: ${page.url()}`);
  } else if (cmd === "scroll") {
    await page.mouse.move(206, 420);
    await page.mouse.wheel(0, Number(args[0] || 600));
    await page.waitForTimeout(400);
    console.log("scrolled.");
  } else if (cmd === "click") {
    await page.mouse.click(Number(args[0]), Number(args[1]));
    await page.waitForTimeout(1200);
    console.log(`clicked ${args[0]},${args[1]} — now at: ${page.url()}`);
  } else if (cmd === "shot") {
    const f = path.join(os.tmpdir(), `browse-shot-${Date.now()}.png`);
    await page.screenshot({ path: f });
    console.log(f);
  } else if (cmd === "back") {
    await page.goBack().catch(() => {});
    console.log("now at:", page.url());
  } else {
    console.error("unknown command:", cmd);
    process.exit(1);
  }
} finally {
  await browser.close(); // disconnects CDP only; the real Chrome keeps running
}
