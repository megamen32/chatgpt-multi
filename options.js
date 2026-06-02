/* Settings page logic. Renders toggles/inputs from a schema, persists to
 * chrome.storage.local under the shared settings key so content scripts and the
 * workspace pick changes up live. */
(function () {
  const S = window.CGPTMP.settings;

  // UI schema: grouped, with type + label + description per setting.
  const SCHEMA = [
    {
      title: 'Производительность',
      items: [
        { key: 'lazyPanes', type: 'bool', name: 'Ленивые панели', desc: 'Грузить ChatGPT только в активной панели; остальные — лёгкое превью.' },
        { key: 'trimEnabled', type: 'bool', name: 'Обрезать длинные чаты', desc: 'Загружать только последние N сообщений переписки (остальное доступно после прокрутки вверх).' },
        { key: 'trimLimit', type: 'number', name: 'Сколько сообщений держать', desc: 'Число последних сообщений при обрезке.', min: 2, max: 200 },
        { key: 'collapseEnabled', type: 'bool', name: 'Сворачивать старые сообщения', desc: 'Автосворачивание старых сообщений в активной панели.' },
      ],
    },
    {
      title: 'Автоматизация',
      items: [
        { key: 'autoConfirm', type: 'bool', name: 'Авто-подтверждение Actions', desc: 'Автоматически нажимать «Confirm» в действиях кастомных GPT.' },
        { key: 'autoExpandToolCalls', type: 'bool', name: 'Раскрывать tool calls', desc: 'Автоматически разворачивать вызовы инструментов.' },
        { key: 'queueEnabled', type: 'bool', name: 'Очередь промптов', desc: 'Ставить промпты в очередь и отправлять по мере готовности ответа.' },
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
        { key: 'goalDisableMemory', type: 'bool', name: 'Отключать память для агента', desc: 'Перед обращением к чату-оценщику отключать память аккаунта (важно для чистой оценки).' },
        { key: 'goalMaxIterations', type: 'number', name: 'Лимит итераций', desc: 'Максимум раундов агент→исполнитель (защита от зацикливания).', min: 1, max: 200 },
        { key: 'goalMarker', type: 'text', name: 'Маркер достижения', desc: 'Точная строка, которую агент пишет, когда цель достигнута.' },
      ],
    },
    {
      title: 'Telegram — основной чат',
      items: [
        { key: 'tgEnabled', type: 'bool', name: 'Включить Telegram-мост', desc: 'Слать сообщения ChatGPT в Telegram и принимать ответы обратно.' },
        { key: 'tgBotToken', type: 'text', name: 'Bot token', desc: 'Токен бота от @BotFather.' },
        { key: 'tgUserId', type: 'text', name: 'Chat / User ID', desc: 'Числовой id получателя.' },
        { key: 'tgForwardExecutor', type: 'bool', name: 'Слать сообщения исполнителя', desc: 'Пересылать ответы основного чата в Telegram.' },
        { key: 'tgSendScope', type: 'select', name: 'Что слать', desc: 'Все сообщения или только последнее за ход.', options: [['last', 'Только последнее'], ['all', 'Все']] },
        { key: 'tgToolCalls', type: 'select', name: 'Tool calls', desc: 'Пересылать ли вызовы инструментов.', options: [['none', 'Не слать'], ['input', 'Только запрос'], ['output', 'Только ответ'], ['both', 'Запрос и ответ']] },
        { key: 'tgSendHidden', type: 'bool', name: 'Слать скрытые/рассуждения', desc: 'Включать reasoning/thoughts-сообщения.' },
        { key: 'tgInboundToExecutor', type: 'bool', name: 'Из Telegram → в очередь', desc: 'Сообщения боту попадают в очередь исполнителя.' },
      ],
    },
    {
      title: 'Telegram — агент',
      items: [
        { key: 'tgForwardAgent', type: 'bool', name: 'Слать сообщения агента', desc: 'Пересылать оценки чата-агента в Telegram.' },
        { key: 'tgSendAgentOpinion', type: 'bool', name: 'Слать мнение о цели', desc: 'Включать вердикт агента «чего не хватает».' },
      ],
    },
  ];

  let settings = Object.assign({}, S.DEFAULTS);
  const root = document.getElementById('root');
  const savedEl = document.getElementById('saved');
  let savedTimer = null;

  function flashSaved() {
    savedEl.textContent = 'Сохранено';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (savedEl.textContent = ''), 1200);
  }

  function persist() {
    chrome.storage.local.set({ [S.STORAGE_KEY]: settings }, flashSaved);
  }

  function render() {
    root.replaceChildren();
    for (const group of SCHEMA) {
      const g = document.createElement('div');
      g.className = 'group';
      const h = document.createElement('h2');
      h.textContent = group.title;
      g.appendChild(h);
      for (const item of group.items) {
        g.appendChild(renderRow(item));
      }
      root.appendChild(g);
    }
  }

  function renderRow(item) {
    const row = document.createElement('div');
    row.className = 'row';
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
      input.placeholder = item.placeholder || '';
      const commit = () => { settings[item.key] = input.value.trim(); persist(); };
      input.addEventListener('change', commit);
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
      input.min = item.min;
      input.max = item.max;
      input.value = settings[item.key];
      const commit = () => {
        let v = Number(input.value);
        if (!Number.isFinite(v)) v = S.DEFAULTS[item.key];
        v = Math.max(item.min, Math.min(item.max, Math.round(v)));
        input.value = v;
        settings[item.key] = v;
        persist();
      };
      input.addEventListener('change', commit);
      row.appendChild(input);
    }
    return row;
  }

  chrome.storage.local.get([S.STORAGE_KEY], (res) => {
    settings = S.withDefaults(res && res[S.STORAGE_KEY]);
    render();
  });
})();
