# ChatGPT Multi Pane

Multi-pane ChatGPT workspace as a Chrome extension: several ChatGPT chats side
by side in one extension page, with bottom tabs and a chat-picker pane.

## Architecture (hybrid, performance-first)

Each pane is a live `https://chatgpt.com` iframe, so all of ChatGPT keeps
working (model picker, deep research, composer, streaming). Speed comes from
not paying for what you don't look at:

- **Lazy panes** — only the *focused* pane mounts its iframe. Other panes show a
  lightweight placeholder until clicked. On reload only the focused pane loads
  eagerly. Per-pane "sleep" (☾) unloads an iframe to reclaim memory.
  State lives in the pure, tested `src/lib/pane-store.js`.
- **Conversation trim** — a MAIN-world content script patches `fetch` so
  `GET /backend-api/conversation/{id}` is trimmed to the last *N* messages on
  the active branch. Long chats stop freezing. Logic: `src/lib/conversation-trim.js`.
- **Settings bridge** — an ISOLATED-world content script mirrors settings into
  `<html>` dataset so the MAIN-world patch can read them; both are injected into
  chatgpt.com with `all_frames: true` so they run *inside* the pane iframes
  (standalone extensions don't, which is why they appeared not to work here).

### Files

| Area | File |
| --- | --- |
| Settings schema/defaults | `src/lib/settings.js` |
| Pane state machine | `src/lib/pane-store.js` |
| Conversation trim (pure) | `src/lib/conversation-trim.js` |
| MAIN-world fetch patch | `src/content/perf-fetch-trim.js` |
| ISOLATED settings bridge | `src/content/settings-bridge.js` |
| Workspace view | `app.html`, `src/app.js`, `src/app.css` |
| Settings page | `options.html`, `options.js` |

## Features

All toggleable from the settings page; injected into the pane iframes via
`all_frames` content scripts, with pure logic factored into `src/lib/*` and
unit-tested.

- **Lazy panes** + **conversation trim** (see above).
- **Native chat picker** — a `+` pane lists your chats (fetched from
  `/backend-api/conversations`) without booting the full app; click to open one
  in that pane. `src/content/picker.js`, `src/lib/picker-model.js`.
- **Pane title / URL sync** — each pane tracks the chat it shows across SPA
  navigation, so reloads restore the right chat per pane and the tab shows the
  real chat name. `src/content/title-report.js`.
- **Auto-confirm** Custom GPT actions (+ auto-expand tool calls).
  `src/content/features/auto-confirm.js`, `src/lib/confirm-match.js`.
- **Prompt queue** with auto-send when ChatGPT goes idle.
  `src/content/features/queue.js`, `src/lib/queue-model.js`.
- **Auto-collapse** old messages in the live pane.
  `src/content/features/collapse.js`, `src/lib/collapse-model.js`.

A single shared `MutationObserver` + rAF scheduler (`features-bundle.js`) drives
all features and only runs them while the tab is visible.

### Goal Agent + Telegram

- **Goal Agent** (🎯 button) — give a final goal; the focused pane is the
  *executor*, a second pane is the *agent* (evaluator). After each executor
  turn the controller extracts only the final answer (no tool calls/reasoning)
  and asks the agent — in a fresh, **memory-disabled** chat — whether the goal
  is reached. The agent either lists what's missing (fed back to the executor)
  or emits the exact marker `GOAL REACHED GOAL` to finish. Memory is disabled by
  PATCHing account settings before each agent turn. Pure logic:
  `src/lib/goal-agent.js` + `src/lib/goal-loop.js`; orchestration:
  `src/goal-controller.js` ↔ `src/content/agent-runtime.js`.
- **Telegram bridge** — set a bot token + user id in settings. The background
  service worker (`service-worker.js`) long-polls Telegram on a 1-min alarm
  (survives restarts) and sends messages chunked to 4096 chars. 📤 mirrors a
  pane's replies to Telegram; inbound Telegram messages are routed into the
  executor. On goal completion it posts a report (goal, duration, message
  count). Granular settings: what to forward (executor/agent, all/last, tool
  calls, hidden, agent opinion). Pure logic: `src/lib/telegram.js`.

## Settings

Open via the ⚙ button in the tab bar or the extension's options page. Toggle
lazy panes, conversation trim (+ how many messages to keep), and every ported
feature. Changes apply live.

## Install

1. `chrome://extensions` → enable Developer mode
2. Load unpacked → select this folder
3. Click the extension icon or open `chrome-extension://<id>/app.html`

If ChatGPT changes CSP/frame behaviour, update `src/rules/*.json`.

## Tests

```
npm test          # unit + perf (node:test, no deps)
npm run test:perf # perf only
```

Covers the trim algorithm (incl. a 4000→20 message perf budget) and the pane
state machine (lazy loading, focus/load transitions, persistence shaping).

## Roadmap

- [x] Lazy-load panes + conversation trim
- [x] Port auto-confirm + auto-expand tool calls
- [x] Port prompt queue with auto-send
- [x] Port auto-collapse of old messages in the live pane
- [x] Native chat list in the picker pane via `/backend-api/conversations`
- [x] Sync pane title/url with the real chat (content-script postMessage)

Possible next steps: smart reveal of collapsed messages on scroll-up; queue
keyboard shortcut; per-pane model preselect.
