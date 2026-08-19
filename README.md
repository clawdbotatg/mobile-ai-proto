# mobile-ai-proto

A mobile app with a **built-in browser** that both you and an AI agent can
drive. Your logins (Gmail etc.) live in the phone's WebView — the agent lives
on a server and sends browser commands to the phone.

```
PHONE (Expo app)                          SERVER (bridge)
 ├─ WebView (your cookies)  ◀── cmds ──── server.js ◀── tools/browse.mjs
 └─ chat ─────────── /chat ─────────────▶ claude -p (agent/CLAUDE.md)
        (phone connects OUT over WS — no inbound to the phone needed)
```

Say "mark all my junk mail as read" in the chat: the server runs a
`claude -p` agent whose `browse.mjs` tool relays read/click/type commands
through the bridge into the WebView on your phone, inside your own
authenticated session, while you watch.

## Run

Server (Mac or any box with the `claude` CLI logged in):

```
npm install
node server.js          # bridge on :8788, token in .token
```

Phone (prototype path — Expo Go):

1. Install **Expo Go** from the App Store.
2. On the server box: `cd app && npm install && npx expo start`
3. Scan the QR with the phone camera → app opens in Expo Go.
4. Copy `app/config.example.js` → `app/config.js` (gitignored) and set
   `SERVER` (LAN IP or tailscale name of the bridge) + `TOKEN` (the `.token`
   value server.js prints).

Log into Gmail once by hand in the app's browser — cookies persist on the
phone. Then chat.

## Pieces

- `server.js` — bridge: WS link to the phone, `/cmd` relay, `/chat` → `claude -p`.
- `app/` — Expo app: WebView + URL bar + chat drawer. `inject.js` is the
  in-page command runner (read / ui / tapi / tap / type / press / scroll).
- `tools/browse.mjs` — the agent's CLI; POSTs commands to the bridge.
- `agent/CLAUDE.md` — the agent persona (claude-p-agent pattern).

## Notes / limits (it's a prototype)

- Token auth over plain HTTP/WS — keep it on LAN or tailscale.
- No screenshots: the agent works from page text + element lists. Canvas-heavy
  UIs are hard for it; Gmail's mobile web works.
- Google sometimes refuses login inside WebViews; the app spoofs a Safari UA
  which usually satisfies it.
- One phone, one agent turn at a time. `--dangerously-skip-permissions` in
  `agent/` — for a box you own.
- Test rig: `scratchpad fake-device` pattern — a headless Chrome pretending to
  be the phone lets you test the whole chain without a device.
