#!/usr/bin/env node
// browse.mjs — the agent's hands on the PHONE's in-app browser.
// Each command POSTs to the local bridge (/cmd), which relays it over WS to
// the phone app's WebView and returns the result.
//
// Usage:
//   node browse.mjs goto <url>
//   node browse.mjs read              # url + title + visible text
//   node browse.mjs ui                # numbered list of clickable/typable elements
//   node browse.mjs tapi <n>          # click element #n from the last `ui`
//   node browse.mjs tap "<text>"      # click first clickable containing text
//   node browse.mjs type "<text>"     # type into the focused field (tap a field first)
//   node browse.mjs press <Key>       # Enter, Backspace...
//   node browse.mjs scroll <dy>       # positive = down
//   node browse.mjs back

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = fs.readFileSync(path.join(HERE, "..", ".token"), "utf8").trim();
const BRIDGE = `http://127.0.0.1:${process.env.APP_PORT || 8788}`;

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd) { console.error("usage: browse.mjs <goto|read|ui|tapi|tap|type|press|scroll|back> ..."); process.exit(1); }

const argMap = {
  goto: { url: rest[0] },
  read: {},
  ui: {},
  tapi: { n: Number(rest[0]) },
  tap: { text: rest.join(" ") },
  type: { text: rest.join(" ") },
  press: { key: rest[0] },
  scroll: { dy: Number(rest[0] || 600) },
  back: {},
};
if (!(cmd in argMap)) { console.error("unknown command:", cmd); process.exit(1); }

const res = await fetch(`${BRIDGE}/cmd?t=${TOKEN}`, {
  method: "POST",
  body: JSON.stringify({ cmd, args: argMap[cmd] }),
});
const j = await res.json();
if (!j.ok) { console.error("ERROR:", j.error); process.exit(1); }
const r = j.result || {};

if (cmd === "read") {
  console.log("URL:", r.url);
  console.log("TITLE:", r.title);
  console.log(r.text || "(no text)");
} else if (cmd === "ui") {
  (r.items || []).forEach((line) => console.log(line));
  if (!r.items || !r.items.length) console.log("(no interactive elements visible — try scroll or read)");
} else if (r.url) {
  console.log("done — now at:", r.url);
} else {
  console.log("done.");
}
