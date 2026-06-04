/* Settings page logic. Renders toggles/inputs from a schema, persists to
 * chrome.storage.local under the shared settings key so content scripts and the
 * workspace pick changes up live.
 *
 * Items may declare `requires: 'someBoolKey'` — they are hidden (and thus
 * inert) until that master toggle is on. Toggling a master re-renders so the
 * dependent options appear/disappear immediately. */
(function () {
  const S = window.CGPTMP.settings;

  const SCHEMA = [
    {
      title: 'Производительность',
      items: [
        { key: 'lazyPanes', type: 'bool', name: 'Ленивые панели', desc: 'Грузить ChatGPT только в активной панели; остальные показываются лёгким превью и оживают по клику. Главный ускоритель.' },
        { key: 'trimEnabled', type: 'bool', name: 'Обрезать длинные чаты', desc: 'В длинном чате сразу грузятся только последние N сообщений — это и убирает фризы. Остальное подтянется при прокрутке вверх / перезагрузке.' },
        { key: 'trimLimit', type: 'number', name: '↳ Сколько сообщений держать', desc: 'Сколько последних сообщений показывать сразу при обрезке.', min: 2, max: 200, requires: 'trimEnabled' },
        { key: 'collapseEnabled', type: 'bool', name: 'Сворачивать старые сообщения', desc: 'В уже открытом чате старые сообщения схлопываются по высоте (раскрыть кликом). Работает поверх обрезки, ещё легче для прокрутки.' },
      ],
    },
    {
      title: 'Кэш чатов',
      items: [
        { key: 'cacheEnabled', type: 'bool', name: 'Кэшировать чаты', desc: 'Сохранять открытые чаты локально и мгновенно показывать их при следующем открытии, дозагружая свежее в фоне.' },
        { key: 'cacheMaxChats', type: 'number', name: '↳ Сколько чатов хранить', desc: 'Хранить кэш последних N чатов (старые вытесняются).', min: 1, max: 200, requires: 'cacheEnabled' },
        { key: 'cacheMaxMB', type: 'number', name: '↳ Максимальный размер, МБ', desc: 'Лимит на весь кэш; при превышении удаляются самые старые.', min: 5, max: 2000, requires: 'cacheEnabled' },
        { key: 'cacheWholeChat', type: 'bool', name: '↳ Хранить чат целиком', desc: 'Иначе хранить только столько сообщений, сколько нужно для отображения (как при обрезке) — экономит место.', requires: 'cacheEnabled' },
      ],
    },
    {
      title: 'Автоматизация',
      items: [
        { key: 'autoConfirm', type: 'bool', name: 'Авто-подтверждение Actions', desc: 'Автоматически нажимать «Confirm» в действиях кастомных GPT.' },
        { key: 'autoExpandToolCalls', type: 'bool', name: 'Раскрывать tool calls', desc: 'Автоматически разворачивать вызовы инструментов.' },
        { key: 'queueEnabled', type: 'bool', name: 'Очередь промптов', desc: 'Ставить промпты в очередь и отправлять следующий, когда ChatGPT закончил отвечать.' },
      ],
    },
    {
      title: 'Интерфейс',
      items: [
        { key: 'syncPaneTitles', type: 'bool', name: 'Имя панели = имя чата', desc: 'Заголовок вкладки панели следует за названием чата.' },
      ],
    },
    {
      title: 'Goal Agent (автономный цикл)',
      items: [
        { key: 'goalAgentEnabled', type: 'bool', name: 'Включить Goal Agent', desc: 'После ответа исполнителя отдельный чат-оценщик проверяет достижение цели и возвращает, чего не хватает.' },
        { key: 'goalDisableMemory', type: 'bool', name: '↳ Отключать память для агента', desc: 'Перед обращением к оценщику отключать память аккаунта (важно для чистой оценки).', requires: 'goalAgentEnabled' },
        { key: 'goalMaxIterations', type: 'number', name: '↳ Лимит итераций', desc: 'Максимум раундов агент→исполнитель (защита от зацикливания).', min: 1, max: 200, requires: 'goalAgentEnabled' },
        { key: 'goalMarker', type: 'text', name: '↳ Маркер достижения', desc: 'Точная строка, которую агент пишет, когда цель достигнута.', requires: 'goalAgentEnabled' },
      ],
    },
    {
      title: 'Telegram — основной чат',
      items: [
        { key: 'tgEnabled', type: 'bool', name: 'Включить Telegram-мост', desc: 'Слать сообщения ChatGPT в Telegram и принимать ответы обратно.' },
        { key: 'tgBotToken', type: 'text', name: '↳ Bot token', desc: 'Токен бота от @BotFather.', requires: 'tgEnabled' },
        { key: 'tgUserId', type: 'text', name: '↳ Chat / User ID', desc: 'Числовой id получателя.', requires: 'tgEnabled' },
        { key: 'tgForwardExecutor', type: 'bool', name: '↳ Слать сообщения исполнителя', desc: 'Пересылать ответы основного чата в Telegram.', requires: 'tgEnabled' },
        { key: 'tgSendScope', type: 'select', name: '↳ Что слать', desc: 'Все сообщения или только последнее за ход.', options: [['last', 'Только последнее'], ['all', 'Все']], requires: 'tgEnabled' },
        { key: 'tgToolCalls', type: 'select', name: '↳ Tool calls', desc: 'Пересылать ли вызовы инструментов.', options: [['none', 'Не слать'], ['input', 'Только запрос'], ['output', 'Только ответ'], ['both', 'Запрос и ответ']], requires: 'tgEnabled' },
        { key: 'tgSendHidden', type: 'bool', name: '↳ Слать скрытые/рассуждения', desc: 'Включать reasoning/thoughts-сообщения.', requires: 'tgEnabled' },
        { key: 'tgInboundToExecutor', type: 'bool', name: '↳ Из Telegram → в очередь', desc: 'Сообщения боту попадают в очередь исполнителя.', requires: 'tgEnabled' },
        { key: 'tgForumChatId', type: 'text', name: '↳ Forum group chat_id для /chats', desc: 'Группа с топиками, где бот является админом и создаёт темы.', requires: 'tgEnabled' },
        { key: 'tgChatsPageSize', type: 'number', min: 1, max: 30, name: '↳ /chats: чатов на страницу', desc: 'Размер страницы inline-списка чатов.', requires: 'tgEnabled' },
        { key: 'tgAutoScrollInactive', type: 'bool', name: '↳ Автоскролл TG-панелей', desc: 'Когда пользователь неактивен больше минуты, привязанные к TG панели скроллятся вниз.', requires: 'tgEnabled' },
        { key: 'tgAutoScrollInactiveMs', type: 'number', min: 10000, max: 600000, name: '↳ Порог простоя, мс', desc: '60000 = одна минута.', requires: 'tgAutoScrollInactive' },
      ],
    },
    {
      title: 'Telegram — агент',
      items: [
        { key: 'tgForwardAgent', type: 'bool', name: 'Слать сообщения агента', desc: 'Пересылать оценки чата-агента в Telegram (нужен включённый Telegram-мост).', requires: 'tgEnabled' },
        { key: 'tgSendAgentOpinion', type: 'bool', name: '↳ Слать мнение о цели', desc: 'Включать вердикт агента «чего не хватает».', requires: 'tgForwardAgent' },
      ],
    },
  ];

  // Keys that gate other rows: changing one of these re-renders the page.
  const MASTER_KEYS = new Set();
  for (const g of SCHEMA) for (const it of g.items) if (it.requires) MASTER_KEYS.add(it.requires);

  let settings = Object.assign({}, S.DEFAULTS);
  const root = document.getElementById('root');
  const savedEl = document.getElementById('saved');
  let savedTimer = null;

  function flashSaved() {
    savedEl.textContent = 'Сохранено';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (savedEl.textContent = ''), 1200);
  }
  function persist() { chrome.storage.local.set({ [S.STORAGE_KEY]: settings }, flashSaved); }

  function visible(item) { return !item.requires || !!settings[item.requires]; }

  function render() {
    root.replaceChildren();
    for (const group of SCHEMA) {
      const items = group.items.filter(visible);
      if (!items.length) continue;
      const g = document.createElement('div');
      g.className = 'group';
      const h = document.createElement('h2');
      h.textContent = group.title;
      g.appendChild(h);
      for (const item of items) g.appendChild(renderRow(item));
      root.appendChild(g);
    }
  }

  function renderRow(item) {
    const row = document.createElement('div');
    row.className = 'row' + (item.requires ? ' dependent' : '');
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<div class="name"></div><div class="desc"></div>`;
    meta.querySelector('.name').textContent = item.name;
    meta.querySelector('.desc').textContent = item.desc;
    row.appendChild(meta);

    if (item.type === 'bool') {
      const label = document.createElement('label');
      label.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!settings[item.key];
      input.addEventListener('change', () => {
        settings[item.key] = input.checked;
        persist();
        if (MASTER_KEYS.has(item.key)) render(); // show/hide dependents
      });
      const slider = document.createElement('span');
      slider.className = 'slider';
      label.append(input, slider);
      row.appendChild(label);
    } else if (item.type === 'text') {
      const input = document.createElement('input');
      input.type = item.key.toLowerCase().includes('token') ? 'password' : 'text';
      input.className = 'text-input';
      input.value = settings[item.key] || '';
      input.addEventListener('change', () => { settings[item.key] = input.value.trim(); persist(); });
      row.appendChild(input);
    } else if (item.type === 'select') {
      const sel = document.createElement('select');
      sel.className = 'text-input';
      for (const [val, label] of item.options) {
        const o = document.createElement('option');
        o.value = val; o.textContent = label;
        if (settings[item.key] === val) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => { settings[item.key] = sel.value; persist(); });
      row.appendChild(sel);
    } else if (item.type === 'number') {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = item.min; input.max = item.max;
      input.value = settings[item.key];
      input.addEventListener('change', () => {
        let v = Number(input.value);
        if (!Number.isFinite(v)) v = S.DEFAULTS[item.key];
        v = Math.max(item.min, Math.min(item.max, Math.round(v)));
        input.value = v; settings[item.key] = v; persist();
      });
      row.appendChild(input);
    }
    return row;
  }

  chrome.storage.local.get([S.STORAGE_KEY], (res) => {
    settings = S.withDefaults(res && res[S.STORAGE_KEY]);
    render();
  });
})();
