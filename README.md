# mobile-ai-proto

A dead-simple prototype: a **shared browser** you and an AI agent both drive,
from your phone.

One real Chrome (persistent profile — your logins live in it) runs on the
server. Your phone gets a live view of it: tap, scroll, type, log into Gmail.
A chat box talks to a `claude -p` agent (the claude-p-agent pattern) whose
tool drives the **same** Chrome — so "mark all my junk mail as read" runs
inside your authenticated session while you watch.

```
phone (web app, add-to-home-screen)
 ├─ live screencast of Chrome  ── taps/scroll/typing ──▶ ┐
 └─ chat ──▶ /chat ──▶ claude -p (agent/CLAUDE.md)       ├──▶ ONE Chrome
                          └─ tools/browse.mjs ── CDP ──▶ ┘   (.chrome-profile)
```

## Run

```
npm install
node server.js        # prints http://127.0.0.1:8788/?t=<token>
```

Open `http://<server-lan-ip>:8788/?t=<token>` on your phone (same wifi /
tailscale) and add to home screen. Needs `claude` CLI logged in (subscription)
and Google Chrome installed.

- **Top**: URL bar + live browser. Tap = click, drag = scroll, the
  "type into the page…" row sends keystrokes (⏎ submits). Log into Gmail here
  by hand once — the profile remembers.
- **Bottom**: chat with the agent. It uses `tools/browse.mjs`
  (read / ui / tapi / tap / type / press / scroll / shot) against the same
  browser, and you watch it work live.

Env knobs: `APP_PORT` (8788), `HEADLESS=1` (Linux server w/ xvfb; default is
headful — Google logins are friendlier to a headful Chrome), `AGENT_MODEL`
(sonnet), `CDP_PORT` (9223).

## Notes / limits (it's a prototype)

- Token-in-URL auth, plain HTTP — keep it on LAN or tailscale.
- One page at a time (popups auto-followed), one agent turn at a time.
- Google can be suspicious of automated browsers at login; if it balks, log in
  with `HEADLESS` off (default) — sessions persist in `.chrome-profile/`.
- The agent runs `--dangerously-skip-permissions` inside `agent/` — it's meant
  for a box you own.
