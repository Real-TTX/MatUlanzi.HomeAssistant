/**
 * Property inspector for a single key.
 *
 * Deliberately thin: pick a button from the library, optionally override its
 * label, done. Everything else lives in the designer window, which has room for
 * it. The preview is rendered by the real KeyAction against a real
 * connection, so what you see here is what the deck draws.
 */
(function (global) {
  'use strict';

  const REFRESH_MS = 2500;
  /** A healthy service answers within a few ms; this only covers a lost message. */
  const DESIGNER_REPLY_MS = 1200;
  /** Generous: the window reports in after ~400 ms, this is only a backstop. */
  const DESIGNER_READY_MS = 8000;
  const isPreview = global.location.search.indexOf('preview=1') !== -1;

  const STATUS_LABELS = {
    online: 'Connected',
    connecting: 'Connecting',
    auth_failed: 'Token invalid',
    offline: 'Not connected',
    idle: 'Not connected'
  };

  const i18n = new global.I18n('en');
  const renderer = new global.KeyRenderer();
  const pool = new global.HaPool({ log: () => {} });

  let library = new global.Library({});
  let librarySignature = '';
  let refreshTimer = null;
  let librarySeen = false;
  let settings = {};
  let form = null;
  let previewAction = null;
  let designerTimer = null;
  let designerReadyTimer = null;
  let designerAnswered = false;

  const t = (key) => $UD.t(key);

  /**
   * Wiring must never brick the page. A stale getElementById(...).addEventListener
   * on a button that had been removed from the markup once threw inside the
   * connected handler, which aborted setup: the dropdown stayed empty and looked
   * like a host problem. One missing element is now a warning, not a dead page.
   */
  function bindClick(id, handler) {
    const node = global.document.getElementById(id);
    if (!node) {
      Utils.warn('[pi] element missing, not wired: #' + id);
      return;
    }
    node.addEventListener('click', handler);
  }

  /** Captures what the action would send to the deck and shows it instead. */
  const previewBridge = {
    setBaseDataIcon: (context, data) => {
      const img = global.document.getElementById('preview');
      if (img) img.src = data;
    },
    toast: () => {},
    showAlert: () => {},
    logMessage: () => {}
  };

  $UD.connect();

  $UD.onConnected(async () => {
    try {
      await $UD.localizeUI();
    } catch (err) {
      /* falls back to the English source text */
    }
    i18n.setLanguage($UD.language || 'en');

    form = global.document.querySelector('#property-inspector');
    global.document.querySelector('.uspi-wrapper').classList.remove('hidden');

    previewAction = new global.KeyAction({
      context: 'preview',
      ud: previewBridge,
      pool: pool,
      library: () => library,
      renderer: renderer,
      i18n: i18n,
      log: () => {}
    });

    form.addEventListener('change', save);
    form.addEventListener('input', Utils.debounce(save, 300));

    bindClick('open-designer', () => openDesigner(''));
    bindClick('edit-button', () => openDesigner(settings.button || ''));

    applySettings(settings);
    requestLibrary();


    // The designer runs in its own window and cannot notify us when it saves or
    // closes, so re-read the library on a timer and whenever this page regains
    // focus. Unchanged payloads are ignored, so this stays cheap.
    refreshTimer = global.setInterval(requestLibrary, REFRESH_MS);
    global.addEventListener('focus', requestLibrary);
    global.document.addEventListener('visibilitychange', () => {
      if (!global.document.hidden) requestLibrary();
    });
  });

  /**
   * The library lives under one fixed identity, because Studio scopes "global"
   * settings per sender — otherwise every key would read its own empty bucket.
   * The plain call is only kept until content shows up, to pick up libraries an
   * older build wrote into this page's own bucket.
   */
  function requestLibrary() {
    $UD.getGlobalSettings(global.LIBRARY_CONTEXT);
    if (librarySeen) return;
    // Two phases: asked at once, a stale per-page copy could answer last and
    // overwrite the good library.
    global.setTimeout(() => {
      if (!librarySeen) $UD.getGlobalSettings();
    }, 700);
  }

  // --- settings -------------------------------------------------------------

  $UD.onAdd((message) => applySettings(message && message.param));
  $UD.onParamFromApp((message) => applySettings(message && message.param));

  $UD.onDidReceiveGlobalSettings((message) => {
    const settingsBlob = (message && (message.settings || message.param)) || {};

    // The designer runs in its own window; there is no event telling us it saved
    // or closed, so we re-read the library and only rebuild when it changed.
    // Several buckets answer; an empty one must not wipe a library we have.
    const hasContent =
      (settingsBlob.connections && settingsBlob.connections.length) ||
      (settingsBlob.buttons && settingsBlob.buttons.length) ||
      settingsBlob.ha_url;
    if (!hasContent && librarySeen) return;

    const signature = JSON.stringify(settingsBlob);
    if (signature === librarySignature) return;
    librarySignature = signature;
    if (hasContent) librarySeen = true;

    library = global.Library.parse(settingsBlob);

    // A button deleted in the designer must not stay selected here.
    if (settings.button && !library.button(settings.button)) {
      settings.button = '';
      if (form) {
        Utils.setFormValue(settings, form);
        $UD.sendParamFromPlugin(settings);
      }
    }

    renderButtonOptions();
    renderConnections();
    connectForPreview();
  });

  function applySettings(param) {
    settings = param || settings || {};
    if (settings.show_room === undefined || settings.show_room === null) {
      settings.show_room = '1';
    }
    if (!form) return;
    renderButtonOptions();
    Utils.setFormValue(settings, form);
    connectForPreview();
  }

  function save() {
    if (!form) return;
    settings = Utils.getFormValue(form);

    // sendParamFromPlugin is the documented way to persist a key's settings, but
    // whether the host forwards them to the main service is not guaranteed — and
    // if it does not, the key on the deck keeps its old picture while this
    // window's preview updates. So tell the main service directly as well.
    $UD.sendParamFromPlugin(settings);
    $UD.sendToPlugin({ request: 'params', settings: settings });

    connectForPreview();
    renderConnections();
  }

  // --- ui -------------------------------------------------------------------

  function renderButtonOptions() {
    const select = global.document.getElementById('button-select');
    if (!select) return;
    const current = settings.button || '';

    select.innerHTML = '';
    const empty = global.document.createElement('option');
    empty.value = '';
    empty.textContent = '— ' + t('No button') + ' —';
    select.appendChild(empty);

    // Folders are a designer concept, but grouping the dropdown by them keeps a
    // long list navigable here too.
    for (const group of library.tree()) {
      const host = group.folder
        ? select.appendChild(global.document.createElement('optgroup'))
        : select;
      if (group.folder) host.label = group.folder.name;

      for (const button of group.buttons) {
        const entities = global.Library.entitiesOf(button);
        const suffix =
          entities.length > 1
            ? ' · ' + entities.length + '×'
            : entities.length
              ? ' · ' + entities[0]
              : '';
        const option = global.document.createElement('option');
        option.value = button.id;
        option.textContent = button.name + suffix;
        host.appendChild(option);
      }
    }
    select.value = current;

    const hint = global.document.getElementById('button-hint');
    if (hint) {
      hint.textContent = library.buttons.length
        ? ''
        : t('No buttons yet — create one in the designer');
    }
  }

  function renderConnections() {
    const host = global.document.getElementById('connections');
    if (!host) return;
    host.innerHTML = '';

    if (!library.connections.length) {
      const hint = global.document.createElement('p');
      hint.className = 'ha-hint';
      hint.textContent = t('No connection configured — set one up in the designer');
      host.appendChild(hint);
      return;
    }

    // Only the connection this key actually uses: the inspector opens no others,
    // so listing them all would show them as permanently "not connected".
    const definition = library.resolveKey(settings);
    const used = definition
      ? library.connection(definition.connection) || library.defaultConnection()
      : null;

    for (const connection of used ? [used] : []) {
      const row = global.document.createElement('div');
      row.className = 'ha-status';
      row.dataset.status = 'idle';
      row.dataset.connection = connection.id;

      const dot = global.document.createElement('span');
      dot.className = 'ha-status-dot';
      row.appendChild(dot);

      const label = global.document.createElement('span');
      label.textContent = connection.name || connection.url;
      row.appendChild(label);

      host.appendChild(row);
    }
  }

  pool.on('status', (info) => {
    const row = global.document.querySelector('[data-connection="' + info.connectionId + '"]');
    if (row) {
      row.dataset.status = info.status;
      const label = row.lastChild;
      const entry = library.connection(info.connectionId);
      const name = entry ? entry.name || entry.url : info.connectionId;
      label.textContent = name + ' · ' + t(STATUS_LABELS[info.status] || info.status);
    }
    if (previewAction) previewAction.scheduleRender();
  });

  pool.on('states', () => previewAction && previewAction.scheduleRender());
  pool.on('state', () => previewAction && previewAction.scheduleRender());

  /** Only the connection the selected button needs. */
  function connectForPreview() {
    if (!previewAction) return;
    previewAction.setSettings(settings);

    const definition = library.resolveKey(settings);
    const wanted = definition
      ? library.connection(definition.connection) || library.defaultConnection()
      : null;

    pool.configure(wanted ? [wanted] : []);
    previewAction.scheduleRender();
  }

  /**
   * Asks the main service to open the designer window.
   *
   * Not openView from here: the host only honours that from the main service —
   * sent from an inspector it does nothing at all, no window and no error.
   * Embedding the designer in this panel was the other dead end: the whole
   * inspector area measures about 464 x 162 px, which is no designer.
   */
  function openDesigner(buttonId) {
    // The window needs a moment, so say so on the button itself — an unchanged
    // button invites a second click, and clicking twice used to be the only way
    // this ever worked.
    setDesignerBusy(true);
    setDesignerHint('');
    designerAnswered = false;
    $UD.sendToPlugin({ request: 'open-designer', button: buttonId || '' });

    // Two safety nets, so the button can never stay stuck spinning: the
    // service acknowledges within milliseconds, the window itself reports in
    // after a few hundred.
    if (designerTimer) global.clearTimeout(designerTimer);
    if (designerReadyTimer) global.clearTimeout(designerReadyTimer);
    designerTimer = global.setTimeout(() => {
      if (designerAnswered) return;
      setDesignerBusy(false);
      setDesignerHint(t('Studio ignored the request — pick the key again'));
    }, DESIGNER_REPLY_MS);
    designerReadyTimer = global.setTimeout(() => {
      setDesignerBusy(false);
    }, DESIGNER_READY_MS);
  }

  /** Spinner on the Designer button while the window is on its way. */
  function setDesignerBusy(busy) {
    const button = global.document.getElementById('open-designer');
    if (!button) return;
    button.classList.toggle('ha-btn-busy', !!busy);
    button.disabled = !!busy;

    const edit = global.document.getElementById('edit-button');
    if (edit) edit.disabled = !!busy;
  }

  function setDesignerHint(text) {
    const hint = global.document.getElementById('designer-hint');
    if (!hint) return;
    hint.textContent = text || '';
    hint.classList.toggle('hidden', !text);
  }

  $UD.onSendToPropertyInspector((message) => {
    const payload = (message && (message.payload || message.param)) || {};
    if (payload.response !== 'designer') return;
    designerAnswered = true;
    if (designerTimer) global.clearTimeout(designerTimer);

    // 'opened' only means the request arrived; the window is up on 'ready'.
    if (payload.state === 'ready' || payload.state === 'focus') {
      setDesignerBusy(false);
      if (designerReadyTimer) global.clearTimeout(designerReadyTimer);
    }
    setDesignerHint(payload.state === 'focus' ? t('The designer is already open') : '');
    // The library may have changed while the window was open.
    global.setTimeout(requestLibrary, 1500);
  });

  global.addEventListener('unload', () => {
    if (refreshTimer) global.clearInterval(refreshTimer);
    pool.destroy();
  });
})(window);
