/* Service worker: opens the workspace, and runs the Telegram bridge
 * (outbound send + inbound long-poll) so it survives browser restarts via
 * chrome.alarms. Pure helpers come from the side-effect imports below. */
import './src/lib/settings.js';
import './src/lib/telegram.js';

const S = self.CGPTMP.settings;
const TG = self.CGPTMP.telegram;

const TG_POLL_ALARM = 'cgptmp-tg-poll';
const INBOX_KEY = 'cgptmp.tg.inbox';
const OFFSET_KEY = 'cgptmp.tg.offset';

// ---- workspace ----
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
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  chrome.alarms.create(TG_POLL_ALARM, { periodInMinutes: 1 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(TG_POLL_ALARM, { periodInMinutes: 1 });
});

chrome.action.onClicked.addListener(() => openWorkspace().catch(console.error));
chrome.commands.onCommand.addListener((c) => { if (c === 'open-app') openWorkspace().catch(console.error); });

// ---- settings helper ----
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([S.STORAGE_KEY], (res) => resolve(S.withDefaults(res && res[S.STORAGE_KEY])));
  });
}

// ---- Telegram outbound ----
async function tgApi(token, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

async function tgSend(text, opts = {}) {
  const s = await getSettings();
  const token = opts.token || s.tgBotToken;
  const chatId = opts.chatId || s.tgUserId;
  if (!token || !chatId || !text) return { ok: false, error: 'missing token/chatId/text' };
  const chunks = TG.chunkText(text);
  let last = null;
  for (const chunk of chunks) {
    const payload = { chat_id: chatId, text: chunk, disable_web_page_preview: true };
    if (opts.messageThreadId) payload.message_thread_id = opts.messageThreadId; // forum topics
    last = await tgApi(token, 'sendMessage', payload);
    if (last && last.ok === false) return last;
  }
  return last || { ok: true };
}

// ---- Telegram inbound (long poll) ----
let polling = false;
async function tgPoll() {
  if (polling) return;
  const s = await getSettings();
  if (!s.tgEnabled || !s.tgBotToken) return;
  polling = true;
  try {
    const offset = await new Promise((r) => chrome.storage.local.get([OFFSET_KEY], (o) => r(o[OFFSET_KEY] || 0)));
    const url = `https://api.telegram.org/bot${s.tgBotToken}/getUpdates?timeout=20${offset ? `&offset=${offset}` : ''}`;
    const data = await (await fetch(url)).json();
    if (!data || !data.ok || !data.result || !data.result.length) return;
    const inbound = [];
    let newOffset = offset;
    for (const upd of data.result) {
      newOffset = upd.update_id + 1;
      const msg = upd.message || upd.edited_message;
      if (!msg || !msg.text) continue;
      inbound.push({
        text: msg.text,
        chatId: msg.chat && msg.chat.id,
        threadId: msg.message_thread_id || null, // forum topic id
        from: msg.from && msg.from.id,
        at: Date.now(),
      });
    }
    await new Promise((r) => chrome.storage.local.set({ [OFFSET_KEY]: newOffset }, r));
    if (inbound.length) {
      const cur = await new Promise((r) => chrome.storage.local.get([INBOX_KEY], (o) => r(o[INBOX_KEY] || [])));
      const next = cur.concat(inbound).slice(-100);
      await new Promise((r) => chrome.storage.local.set({ [INBOX_KEY]: next }, r));
    }
  } catch (e) {
    console.warn('[CGPTMP] tg poll failed', e);
  } finally {
    polling = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TG_POLL_ALARM) tgPoll();
});

// ---- message router ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;
  if (message.type === 'open-workspace') {
    openWorkspace().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message.type === 'tg-send') {
    tgSend(message.text, message).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message.type === 'tg-poll-now') {
    tgPoll().then(() => sendResponse({ ok: true }));
    return true;
  }
});
