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

## Settings

Open via the ⚙ button in the tab bar or the extension's options page. Toggle
lazy panes, conversation trim (+ how many messages to keep), and the
ported features. Changes apply live.

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

- [ ] Port auto-confirm + auto-expand (from a standalone extension) as a feature
- [ ] Port prompt queue with auto-send
- [ ] Port auto-collapse of old messages in the live pane
- [ ] Native chat list in the picker pane via `/backend-api/conversations`
- [ ] Sync pane title with the real chat title (via content-script postMessage)
