# ChatGPT Multi Pane

Chrome extension app, inspired by ChatHub-style architecture.

It opens an extension page (`app.html`) that contains several live ChatGPT panes side-by-side via iframes. It uses Declarative Net Request rules to remove frame blocking headers for ChatGPT, similar to ChatHub-like extensions.


## Default behavior

Clicking the extension icon opens the full-page workspace (`app.html`) in a normal Chrome tab. The Chrome side panel is only an optional auxiliary mode; it contains a button to open the full-page workspace.

## Install

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked
4. Select:

```text
~/Projects/chatgpt-multi-pane-extension
```

Click the extension icon or open:

```text
chrome-extension://<extension-id>/app.html
```

## Notes

- Panes are live iframe views, not cloned React components.
- Existing Chrome extensions may still run normally in browser tabs, but not every extension injects into iframe documents. This is a Chrome limitation.
- If ChatGPT changes CSP/frame behavior, update `src/rules/*.json`.
