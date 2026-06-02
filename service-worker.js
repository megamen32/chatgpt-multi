async function openWorkspace() {
  const url = chrome.runtime.getURL('app.html');
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length && tabs[0].id) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId) await chrome.windows.update(tabs[0].windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
}

chrome.runtime.onInstalled.addListener(() => {
  // Do NOT open side panel on icon click by default. The main experience is full-page app.html.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});

chrome.action.onClicked.addListener(() => {
  openWorkspace().catch(console.error);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-app') openWorkspace().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'open-workspace') {
    openWorkspace().then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});
