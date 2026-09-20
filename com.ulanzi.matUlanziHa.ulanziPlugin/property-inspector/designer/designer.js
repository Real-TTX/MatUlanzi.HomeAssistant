/**
 * The designer window (opened via $UD.openView).
 *
 * Manages Home Assistant connections, folders and the button library, all
 * stored in UlanziStudio's global settings. The preview is a real KeyAction
 * rendering through the real KeyRenderer against a real connection, so the
 * picture here is literally what the deck will draw.
 *
 * Folders exist only to organise this window — the deck never sees them, so
 * they are a filter dropdown rather than a tree.
 */
(function (global) {
  'use strict';

  const SAVE_DEBOUNCE_MS = 400;
  /** Ignore our own echo for this long, so typing is never clobbered. */
  const ECHO_GRACE_MS = 1500;

  const HTML_STARTER =
    '<div style="width:100%;height:100%;box-sizing:border-box;display:flex;\n' +
    '     flex-direction:column;justify-content:space-between;padding:14px;\n' +
    '     border-radius:26px;color:#fff;font-family:\'Segoe UI\',sans-serif;\n' +
    '     background:linear-gradient(135deg,#f4b740,#e2622b)">\n' +
    '  <div style="font-size:19px;font-weight:700;opacity:.75">{{area}}</div>\n' +
    '  <div style="font-size:44px;font-weight:700;text-align:center">{{value}}</div>\n' +
    '  <div style="font-size:21px;font-weight:600;text-align:center">{{name}}</div>\n' +
    '</div>';

  const STATUS_LABELS = {
    online: 'Connected',
    connecting: 'Connecting',
    auth_failed: 'Token invalid',
    offline: 'Not connected',
    idle: 'Not connected'
  };

  /** German search words mapped onto the English mdi icon names. */
  const ICON_SYNONYMS = {
    licht: 'light',
    lampe: 'lamp',
    lampen: 'lamp',
    decke: 'ceiling',
    deckenlicht: 'ceiling-light',
    steckdose: 'power-socket',
    stecker: 'power-plug',
    strom: 'power',
    schalter: 'toggle-switch',
    rollo: 'shutter',
    rolladen: 'shutter',
    jalousie: 'blinds',
    vorhang: 'curtains',
    fenster: 'window',
    tuer: 'door',
    tor: 'garage',
    schloss: 'lock',
    schluessel: 'key',
    heizung: 'radiator',
    thermostat: 'thermostat',
    temperatur: 'thermometer',
    klima: 'air-conditioner',
    lueftung: 'fan',
    luefter: 'fan',
    ventilator: 'fan',
    feuchte: 'water-percent',
    wetter: 'weather',
    sonne: 'weather-sunny',
    mond: 'weather-night',
    wolke: 'weather-cloudy',
    musik: 'music',
    lautsprecher: 'speaker',
    lautstaerke: 'volume',
    fernseher: 'television',
    tv: 'television',
    film: 'movie',
    kaffee: 'coffee',
    kuehlschrank: 'fridge',
    waschmaschine: 'washing-machine',
    geschirrspueler: 'dishwasher',
    staubsauger: 'robot-vacuum',
    sofa: 'sofa',
    bett: 'bed',
    dusche: 'shower',
    kueche: 'silverware-fork-knife',
    treppe: 'stairs',
    haus: 'home',
    auto: 'car',
    pflanze: 'flower',
    baum: 'tree',
    batterie: 'battery',
    akku: 'battery',
    bewegung: 'motion-sensor',
    sensor: 'gauge',
    uhr: 'clock',
    kalender: 'calendar',
    person: 'account',
    leute: 'account-group',
    szene: 'palette',
    party: 'party-popper',
    glocke: 'bell',
    einstellungen: 'cog',
    info: 'information-outline',
    warnung: 'alert',
    solar: 'solar-power',
    wasser: 'water-pump'
  };

  const doc = global.document;
  const i18n = new global.I18n('en');
  const renderer = new global.KeyRenderer();
  const pool = new global.HaPool({ log: () => {} });

  let library = new global.Library({});
  let selection = { kind: '', id: '' };
  let folderFilter = ''; // '' = all folders
  let picker = null;
  let previewAction = null;
  let pendingIconField = '';
  let iconBrowserField = '';
  let initialised = false;
  let echoBlockedUntil = 0;
  let librarySeen = false;
  let dirty = false;
  /** Last library the host reported, used to refuse destructive writes. */
  let lastKnown = null;
  /** Last visibility we told the service about. */
  let lastReportedVisible = null;

  const t = (key) => $UD.t(key);
  const el = (id) => doc.getElementById(id);

  /** Captures what the action would send to the deck. */
  const previewBridge = {
    setBaseDataIcon: (context, data) => {
      el('preview').src = data;
    },
    toast: (message) => $UD.toast(message),
    showAlert: () => {},
    logMessage: () => {}
  };

  const persist = Utils.debounce(() => {
    echoBlockedUntil = Date.now() + ECHO_GRACE_MS;
    saveLibrary();
    // Writing the settings does not necessarily wake the main service, so ask it
    // to re-read and repaint the keys right away.
    $UD.sendToPlugin({ request: 'reload' });
    dirty = false;
    setSaveState(false);
  }, SAVE_DEBOUNCE_MS);

  function save() {
    dirty = true;
    setSaveState(true);
    persist();
  }

  function setSaveState(isDirty) {
    const node = el('save-state');
    node.dataset.dirty = isDirty ? '1' : '0';
    node.textContent = isDirty ? t('Saving…') : t('Saved');
  }

  // --- boot -----------------------------------------------------------------

  /**
   * Claim our own identity before connecting.
   *
   * The host builds this window's query string and may pass the inspector's
   * key/actionid no matter what `openView` was told. Sharing an identity is
   * fatal: the host keeps one socket per identity, so we would replace the
   * inspector, and once this window closes the inspector's messages are dropped
   * — its dropdown then silently stops working. Rewriting the query string
   * before `$UD.connect()` reads it makes us independent of the host.
   */
  (function claimOwnIdentity() {
    try {
      const url = new global.URL(global.location.href);
      const fromKey = url.searchParams.get('fromKey') || url.searchParams.get('key') || '';
      // Unique per window: two designer windows can be open at once, and sharing
      // an identity would make them supersede each other just like they did the
      // inspector.
      const unique =
        'designer-' + (url.searchParams.get('nonce') || String(Date.now()));

      if (url.searchParams.get('key') === 'designer' && url.searchParams.get('actionid') === unique) {
        return;
      }
      url.searchParams.set('fromKey', fromKey);
      url.searchParams.set('key', 'designer');
      url.searchParams.set('actionid', unique);
      global.history.replaceState(null, '', url.toString());
    } catch (err) {
      /* worst case we keep the inherited identity */
    }
  })();

  /**
   * The main service must know whether a designer is running: the host lets it
   * open exactly one view per page life, so a second request has to either
   * reuse this window or restart the service first (see designer-window.js).
   */
  const HEARTBEAT_MS = 2500;

  $UD.connect();

  $UD.onConnected(async () => {
    try {
      await $UD.localizeUI();
    } catch (err) {
      /* English source text stays */
    }
    i18n.setLanguage($UD.language || 'en');
    reportPresence(true);
    // The window opens at 0,0, almost exactly over Studio. If the host ever
    // fails to raise it, it would look like nothing happened at all.
    try {
      global.focus();
    } catch (err) {
      /* not allowed everywhere, and not important enough to care */
    }
    global.setInterval(() => reportPresence(false), HEARTBEAT_MS);

    // Closing this window with its own X destroys the window but leaves this
    // page running, pinging happily — the service then believes a designer is
    // open and answers every further click with "already open", so the button
    // looks dead forever. Visibility is the only honest signal we get.
    doc.addEventListener('visibilitychange', () => reportPresence(true));

    previewAction = new global.KeyAction({
      context: 'preview',
      ud: previewBridge,
      pool: pool,
      library: () => library,
      renderer: renderer,
      i18n: i18n,
      log: () => {}
    });

    try {
      wireUi();
    } catch (err) {
      // One missing element must not stop the library from loading.
      Utils.warn('[designer] wiring failed', err);
    }
    requestLibrary();
  });

  /**
   * The library lives under one fixed identity — Studio scopes "global" settings
   * per sender, so without this every page would read its own empty bucket. The
   * plain call stays until content shows up, to pick up a library an older build
   * left in this page's own bucket.
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

  $UD.onDidReceiveGlobalSettings((message) => {
    const settings = (message && (message.settings || message.param)) || {};
    if (initialised && Date.now() < echoBlockedUntil) return; // our own write

    // Several buckets answer; an empty one must never replace a loaded library,
    // or closing the window would write the empty one back and wipe everything.
    const hasContent =
      (settings.connections && settings.connections.length) ||
      (settings.buttons && settings.buttons.length) ||
      settings.ha_url;
    if (!hasContent && librarySeen) return;
    if (hasContent) librarySeen = true;

    library = global.Library.parse(settings);
    // What the host holds right now — saveLibrary() refuses to replace this
    // with an empty payload.
    if (hasContent) lastKnown = library.toJSON();
    pool.configure(library.connections);
    renderSidebar();

    if (!initialised) {
      initialised = true;
      const wanted = Utils.getQueryParams('button');
      if (wanted && library.button(wanted)) selectItem('button', wanted);
      else if (library.buttons.length) selectItem('button', library.sortedButtons()[0].id);
      else if (library.connections.length) selectItem('connection', library.connections[0].id);
      else showEmptyState();
    } else {
      renderEditor();
    }
  });

  $UD.onSelectdialog((message) => {
    if (!pendingIconField || !message || !message.path) return;
    const input = el('button-form').elements[pendingIconField];
    pendingIconField = '';
    if (!input) return;
    input.value = message.path;
    commitButtonForm();
  });

  // --- ui wiring ------------------------------------------------------------

  /**
   * Single place that writes the library, so the guard cannot be bypassed.
   * `lastKnown` is what the host last told us; refusing to replace content with
   * nothing has already saved a real library once.
   */
  function saveLibrary() {
    const blob = library.toJSON();
    if (!global.mayReplaceLibrary(blob, lastKnown)) {
      Utils.warn('[designer] refusing to write an empty library over existing content');
      return false;
    }
    lastKnown = blob;
    $UD.setGlobalSettings(blob, global.LIBRARY_CONTEXT);
    return true;
  }

  /**
   * Tells the service whether a *window* is really showing this page.
   * `announce` forces the message even when nothing changed.
   */
  function reportPresence(announce) {
    const visible = doc.visibilityState !== 'hidden';
    const changed = visible !== lastReportedVisible;
    lastReportedVisible = visible;

    if (!visible) {
      // A page without a window must never claim to be alive, or every further
      // click gets answered with "already open".
      if (changed || announce) $UD.sendToPlugin({ request: 'designer:bye' });
      return;
    }
    $UD.sendToPlugin({ request: changed || announce ? 'designer:hello' : 'designer:ping' });
  }

  function wireUi() {
    setSaveState(false);

    // Flush pending edits before the window disappears, then close the way the
    // host expects — see the comment in designer.html.
    const closeWindow = () => {
      // Only when something actually changed: a second designer window could
      // otherwise write its stale copy over the other one's edits.
      if (initialised && dirty) {
        saveLibrary(); // flush whatever is still debounced
        $UD.sendToPlugin({ request: 'reload' });
      }
      global.setTimeout(() => global.close(), 120);
    };
    el('close-window').addEventListener('click', closeWindow);
    doc.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!el('icon-browser').classList.contains('hidden')) {
        closeIconBrowser();
        return;
      }
      if (!el('folder-name').classList.contains('hidden')) {
        hideFolderInput();
        return;
      }
      closeWindow();
    });

    el('add-connection').addEventListener('click', () => {
      const entry = library.addConnection({ name: t('New connection') });
      save();
      renderSidebar();
      selectItem('connection', entry.id);
    });

    el('add-button').addEventListener('click', () => {
      const entry = library.addButton({
        name: t('New button'),
        // Creating inside the filtered folder is what you almost always want.
        folder: folderFilter === '__none__' ? '' : folderFilter
      });
      save();
      renderSidebar();
      selectItem('button', entry.id);
    });

    // --- folders (filter dropdown + inline rename) --------------------------

    el('folder-filter').addEventListener('change', () => {
      folderFilter = el('folder-filter').value;
      hideFolderInput();
      renderButtonList();
    });

    el('folder-new').addEventListener('click', () => {
      const entry = library.addFolder({ name: t('New folder') });
      folderFilter = entry.id;
      save();
      renderSidebar();
      showFolderInput(entry);
    });

    el('folder-rename').addEventListener('click', () => {
      const entry = library.folder(folderFilter);
      if (!entry) {
        $UD.toast(t('Pick a folder first'));
        return;
      }
      showFolderInput(entry);
    });

    el('folder-delete').addEventListener('click', () => {
      const entry = library.folder(folderFilter);
      if (!entry) {
        $UD.toast(t('Pick a folder first'));
        return;
      }
      if (!global.confirm(t('Delete this folder?') + '\n\n' + entry.name)) return;
      library.removeFolder(entry.id);
      folderFilter = '';
      save();
      renderSidebar();
      if (selection.kind === 'button') renderEditor();
    });

    const folderInput = el('folder-name');
    const commitFolderName = () => {
      const entry = library.folder(folderInput.dataset.folder);
      if (entry && folderInput.value.trim()) {
        library.updateFolder(entry.id, { name: folderInput.value.trim() });
        save();
      }
      hideFolderInput();
      renderSidebar();
      if (selection.kind === 'button') renderEditor();
    };
    folderInput.addEventListener('blur', commitFolderName);
    folderInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitFolderName();
      }
    });

    // --- forms --------------------------------------------------------------

    const connectionForm = el('connection-form');
    connectionForm.addEventListener('input', Utils.debounce(commitConnectionForm, 200));
    connectionForm.addEventListener('change', commitConnectionForm);

    el('delete-connection').addEventListener('click', () => {
      const entry = library.connection(selection.id);
      if (!entry) return;
      if (!global.confirm(t('Delete this connection?') + '\n\n' + (entry.name || entry.url))) return;
      library.removeConnection(selection.id);
      pool.configure(library.connections);
      save();
      renderSidebar();
      showEmptyState();
    });

    el('actions-customise').addEventListener('click', () => {
      const entry = library.button(selection.id);
      if (entry) materialiseActions(entry);
    });
    el('actions-reset').addEventListener('click', () => {
      const entry = library.button(selection.id);
      if (entry) backToAuto(entry, { actions: [] });
    });
    el('rules-customise').addEventListener('click', () => {
      const entry = library.button(selection.id);
      if (entry) materialiseRules(entry);
    });
    el('rules-reset').addEventListener('click', () => {
      const entry = library.button(selection.id);
      if (entry) backToAuto(entry, { rules: [] });
    });

    el('preview-toggle').addEventListener('click', () => {
      const body = el('preview-body');
      const zu = body.classList.toggle('hidden');
      el('preview-caret').textContent = zu ? '+' : '−';
    });

    for (const [id, gesture] of [['sim-press', 'press'], ['sim-double', 'double'], ['sim-long', 'long']]) {
      el(id).addEventListener('click', () => {
        if (selection.kind !== 'button' || !selection.id) return;
        el('sim-result').textContent = t('Running…');
        $UD.sendToPlugin({ request: 'simulate', button: selection.id, gesture: gesture });
      });
    }

    const settingsForm = el('settings-form');
    settingsForm.addEventListener('change', () => {
      commitSettingsForm();
      renderSettingsEntry();
    });

    const buttonForm = el('button-form');
    buttonForm.addEventListener('input', Utils.debounce(commitButtonForm, 200));
    buttonForm.addEventListener('change', commitButtonForm);

    el('duplicate-button').addEventListener('click', () => {
      const copy = library.duplicateButton(selection.id);
      if (!copy) return;
      save();
      renderSidebar();
      selectItem('button', copy.id);
    });

    el('delete-button').addEventListener('click', () => {
      const entry = library.button(selection.id);
      if (!entry) return;
      if (!global.confirm(t('Delete this button?') + '\n\n' + entry.name)) return;
      library.removeButton(selection.id);
      save();
      renderSidebar();
      showEmptyState();
    });

    el('html-starter').addEventListener('click', () => {
      buttonForm.elements.html.value = HTML_STARTER;
      buttonForm.elements.mode.value = 'html';
      commitButtonForm();
    });

    for (const trigger of doc.querySelectorAll('[data-pick-icon]')) {
      trigger.addEventListener('click', () => {
        pendingIconField = trigger.dataset.pickIcon;
        $UD.selectFileDialog('image(*.png *.jpg *.jpeg *.svg *.gif)');
      });
    }
    for (const trigger of doc.querySelectorAll('[data-clear-icon]')) {
      trigger.addEventListener('click', () => {
        buttonForm.elements[trigger.dataset.clearIcon].value = '';
        commitButtonForm();
      });
    }
    for (const trigger of doc.querySelectorAll('[data-icon-browse]')) {
      trigger.addEventListener('click', () => openIconBrowser(trigger.dataset.iconBrowse));
    }

    el('icon-browser-close').addEventListener('click', closeIconBrowser);
    el('icon-browser').addEventListener('click', (event) => {
      if (event.target === el('icon-browser')) closeIconBrowser();
    });
    el('icon-search').addEventListener('input', Utils.debounce(renderIconGrid, 120));
  }

  function showFolderInput(folder) {
    const input = el('folder-name');
    input.dataset.folder = folder.id;
    input.value = folder.name || '';
    input.classList.remove('hidden');
    input.focus();
    input.select();
  }

  function hideFolderInput() {
    const input = el('folder-name');
    input.classList.add('hidden');
    input.dataset.folder = '';
  }

  // --- sidebar --------------------------------------------------------------

  function renderSidebar() {
    const connections = el('connection-list');
    connections.innerHTML = '';
    for (const connection of library.connections) {
      connections.appendChild(
        listItem({
          id: connection.id,
          kind: 'connection',
          name: connection.name || connection.url || connection.id,
          meta: '',
          withDot: true
        })
      );
    }

    renderFolderFilter();
    renderButtonList();
    renderSettingsEntry();
    refreshConnectionDots();
  }

  function renderFolderFilter() {
    const select = el('folder-filter');
    const folders = library.sortedFolders();
    if (folderFilter && !library.folder(folderFilter)) folderFilter = '';

    select.innerHTML = '';
    const all = doc.createElement('option');
    all.value = '';
    all.textContent = t('All folders') + ' (' + library.buttons.length + ')';
    select.appendChild(all);

    for (const folder of folders) {
      const count = library.buttons.filter((button) => button.folder === folder.id).length;
      const option = doc.createElement('option');
      option.value = folder.id;
      option.textContent = folder.name + ' (' + count + ')';
      select.appendChild(option);
    }

    const loose = library.buttons.filter(
      (button) => !button.folder || !library.folder(button.folder)
    ).length;
    if (loose && folders.length) {
      const option = doc.createElement('option');
      option.value = '__none__';
      option.textContent = t('No folder') + ' (' + loose + ')';
      select.appendChild(option);
    }

    select.value = folderFilter;
  }

  function renderSettingsEntry() {
    const host = el('settings-list');
    if (!host) return;
    host.innerHTML = '';
    host.appendChild(
      listItem({
        kind: 'settings',
        id: 'timing',
        name: t('Key timing'),
        meta: library.timing('long_press_ms') + ' / ' + library.timing('double_click_ms') + ' ms'
      })
    );
  }

  function renderButtonList() {
    const list = el('button-list');
    list.innerHTML = '';

    const buttons = library.sortedButtons().filter((button) => {
      if (!folderFilter) return true;
      if (folderFilter === '__none__') return !button.folder || !library.folder(button.folder);
      return button.folder === folderFilter;
    });

    if (!buttons.length) {
      const empty = doc.createElement('li');
      empty.className = 'meta';
      empty.textContent = t('No buttons here yet');
      list.appendChild(empty);
      return;
    }

    for (const button of buttons) {
      list.appendChild(
        listItem({
          id: button.id,
          kind: 'button',
          name: button.name || button.id,
          meta: buttonMeta(button),
          withDot: false
        })
      );
    }
  }

  function buttonMeta(button) {
    const entities = global.Library.entitiesOf(button);
    if (!entities.length) return t('no entity');
    if (entities.length > 1) return entities.length + '×';
    return entities[0].replace(/^[a-z_]+\./, '');
  }

  function listItem(spec) {
    const li = doc.createElement('li');
    li.dataset.kind = spec.kind;
    li.dataset.id = spec.id;
    li.setAttribute(
      'aria-selected',
      String(selection.kind === spec.kind && selection.id === spec.id)
    );

    if (spec.withDot) {
      const dot = doc.createElement('span');
      dot.className = 'dot';
      dot.dataset.connection = spec.id;
      li.appendChild(dot);
    }

    const name = doc.createElement('span');
    name.className = 'name';
    name.textContent = spec.name;
    li.appendChild(name);

    if (spec.meta) {
      const meta = doc.createElement('span');
      meta.className = 'meta';
      meta.textContent = spec.meta;
      li.appendChild(meta);
    }

    li.addEventListener('click', () => selectItem(spec.kind, spec.id));
    return li;
  }

  function refreshConnectionDots() {
    for (const entry of pool.entries()) {
      const dot = doc.querySelector('.dot[data-connection="' + entry.id + '"]');
      if (dot) dot.dataset.status = entry.client.status;
    }
  }

  // --- selection ------------------------------------------------------------

  function selectItem(kind, id) {
    selection = { kind: kind, id: id };
    for (const li of doc.querySelectorAll('.list li')) {
      li.setAttribute('aria-selected', String(li.dataset.kind === kind && li.dataset.id === id));
    }
    renderEditor();
  }

  function showEmptyState() {
    selection = { kind: '', id: '' };
    el('empty-state').classList.remove('hidden');
    el('connection-form').classList.add('hidden');
    el('button-form').classList.add('hidden');
    el('settings-form').classList.add('hidden');
    el('preview').removeAttribute('src');
    el('preview-info').textContent = '';
  }

  function renderEditor() {
    el('connection-form').classList.add('hidden');
    el('button-form').classList.add('hidden');

    if (selection.kind === 'connection') {
      const entry = library.connection(selection.id);
      if (!entry) return showEmptyState();
      el('empty-state').classList.add('hidden');
      el('connection-form').classList.remove('hidden');
      fillConnectionForm(entry);
      renderConnectionStatus(entry);
      el('preview').removeAttribute('src');
      el('preview-info').textContent = '';
      return;
    }

    if (selection.kind === 'settings') {
      el('empty-state').classList.add('hidden');
      el('settings-form').classList.remove('hidden');
      fillSettingsForm();
      el('preview').removeAttribute('src');
      el('preview-info').textContent = '';
      return;
    }

    if (selection.kind === 'button') {
      const entry = library.button(selection.id);
      if (!entry) return showEmptyState();
      el('empty-state').classList.add('hidden');
      el('button-form').classList.remove('hidden');
      fillButtonForm(entry);
      mountPicker(entry);
      renderChips(entry);
      renderPreview();
      return;
    }

    showEmptyState();
  }

  // --- connection editor ----------------------------------------------------

  function fillSettingsForm() {
    const fields = el('settings-form').elements;
    fields.long_press_ms.value = library.timing('long_press_ms');
    fields.double_click_ms.value = library.timing('double_click_ms');
  }

  function commitSettingsForm() {
    const fields = el('settings-form').elements;
    library.updateSettings({
      long_press_ms: Number(fields.long_press_ms.value) || 0,
      double_click_ms: Number(fields.double_click_ms.value) || 0
    });
    save();
  }

  function fillConnectionForm(entry) {
    const fields = el('connection-form').elements;
    fields.name.value = entry.name || '';
    fields.url.value = entry.url || '';
    fields.token.value = entry.token || '';
  }

  function commitConnectionForm() {
    if (selection.kind !== 'connection') return;
    const fields = el('connection-form').elements;
    library.updateConnection(selection.id, {
      name: fields.name.value,
      url: fields.url.value.trim(),
      token: fields.token.value.trim()
    });
    pool.configure(library.connections);
    save();
    renderSidebar();
  }

  function renderConnectionStatus(entry) {
    const poolEntry = pool.get(entry.id);
    const status = poolEntry && poolEntry.id === entry.id ? poolEntry.client.status : 'idle';
    el('connection-dot').dataset.status = status;

    // The server's own message is more specific than our label, so prefer it.
    const error = poolEntry && status !== 'online' ? poolEntry.client.lastError : '';
    let text = error || t(STATUS_LABELS[status] || status);
    if (poolEntry && status === 'online') {
      if (poolEntry.client.haVersion) text += ' · ' + poolEntry.client.haVersion;
      text += ' · ' + poolEntry.client.states.size + ' ' + t('entities');
    }
    el('connection-status').textContent = text;
  }

  // --- button editor --------------------------------------------------------

  /**
   * Turns an old on/off pair into the two rules that mean the same thing.
   *
   * The tile used to carry "icon when on" and "icon when off" while rules did
   * the same job better. Keeping both would show two models at once, so a
   * button that still has a pair is converted the first time it is opened —
   * the key looks exactly as before, the setting just lives in one place now.
   */
  function pairsToRules(entry) {
    const style = entry.style || {};
    const anIcon = (style.icon_on || '').trim();
    const ausIcon = (style.icon_off || '').trim();
    if (!anIcon || !ausIcon || anIcon === ausIcon) return false;
    if ((entry.rules || []).length) return false;

    const regeln = [
      { id: 'rule-an-' + entry.id, scope: 'any', what: 'state', op: '=', value: 'on', icon: anIcon, bg: '' },
      { id: 'rule-aus-' + entry.id, scope: 'all', what: 'state', op: '=', value: 'off', icon: ausIcon, bg: '' }
    ];
    library.updateButton(entry.id, {
      rules: regeln,
      style: Object.assign({}, style, { icon_on: ausIcon, icon_off: ausIcon })
    });
    save();
    return true;
  }

  function fillButtonForm(entry) {
    if (pairsToRules(entry)) {
      fillButtonForm(library.button(entry.id));
      return;
    }
    const fields = el('button-form').elements;
    const style = global.KeyStyle.baseStyle(entry.style);
    const own = entry.style || {};

    fields.name.value = entry.name || '';
    fields.refresh_interval.value = Number(entry.refresh_interval) || 0;
    fields.group_rule.value =
      entry.group_rule === global.GROUP_RULES.all_on
        ? global.GROUP_RULES.all_on
        : global.GROUP_RULES.any_on;

    fillOptions(
      fields.folder,
      [{ id: '', name: '— ' + t('No folder') + ' —' }].concat(library.sortedFolders())
    );
    fields.folder.value = entry.folder || '';

    fillOptions(
      fields.connection,
      library.connections.map((connection) => ({
        id: connection.id,
        name: connection.name || connection.url || connection.id
      }))
    );
    fields.connection.value = entry.connection || (library.defaultConnection() || {}).id || '';

    fields.target_mode.value =
      ['context', 'button'].indexOf(entry.target_mode) !== -1 ? entry.target_mode : 'fixed';
    fillOptions(
      fields.target_button,
      [{ id: '', name: '— ' + t('No button') + ' —' }].concat(
        library.sortedButtons().filter((other) => other.id !== entry.id)
      )
    );
    fields.target_button.value = entry.target_button || '';

    fields.group_rule.value =
      entry.group_rule === global.GROUP_RULES.all_on
        ? global.GROUP_RULES.all_on
        : global.GROUP_RULES.any_on;
    fields.refresh_interval.value = Number(entry.refresh_interval) || 0;

    fields.mode.value = style.mode;
    fields.bg_off.value = asColor(style.bg_off, '#2a2d33');
    // An empty bg_on is exactly what makes a tile take the colour of its
    // device — that is the automatic, not a missing setting.
    fields.bg_on_auto.checked = !own.bg_on;
    fields.text_off.value = asColor(own.text_off, '#eceef0');
    fields.text_off_auto.checked = !own.text_off;

    fields.icon_off.value = style.icon_off || '';
    fields.icon_size.value = style.icon_size;
    fields.radius.value = style.radius;

    fields.top.value = style.top;
    fields.center.value = style.center;
    fields.bottom.value = style.bottom;
    fields.show_bar.checked = String(style.show_bar) !== '0';
    fields.html.value = style.html || '';

    renderActionList(entry);
    renderRuleList(entry);
    applyModeVisibility(style.mode);
    applyTargetVisibility();
    applyGroupVisibility(global.Library.entitiesOf(entry).length);
    renderIconPreviews();
  }

  function fillOptions(select, items) {
    select.innerHTML = '';
    for (const item of items) {
      const option = doc.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      select.appendChild(option);
    }
  }

  function commitButtonForm() {
    if (selection.kind !== 'button') return;
    const fields = el('button-form').elements;
    const previous = library.button(selection.id) || {};

    const style = {
      mode: fields.mode.value,
      bg_off: fields.bg_off.value,
      // One look, not a pair: a difference between states is a display rule.
      bg_on: fields.bg_on_auto.checked ? '' : fields.bg_off.value,
      text_off: fields.text_off_auto.checked ? '' : fields.text_off.value,
      text_on: fields.text_off_auto.checked ? '' : fields.text_off.value,
      icon_off: fields.icon_off.value.trim(),
      icon_on: fields.icon_off.value.trim(),
      icon_size: Number(fields.icon_size.value) || 64,
      radius: Number(fields.radius.value) || 0,
      top: fields.top.value,
      center: fields.center.value,
      bottom: fields.bottom.value,
      show_bar: fields.show_bar.checked ? '1' : '0',
      html: fields.html.value
    };

    const connectionChanged = fields.connection.value !== previous.connection;

    library.updateButton(selection.id, {
      name: fields.name.value,
      folder: fields.folder.value,
      connection: fields.connection.value,
      refresh_interval: Number(fields.refresh_interval.value) || 0,
      group_rule: fields.group_rule.value,
      target_mode: fields.target_mode.value,
      target_button: fields.target_button.value,
      group_rule: fields.group_rule.value,
      refresh_interval: Number(fields.refresh_interval.value) || 0,
      style: style
    });

    applyModeVisibility(style.mode);
    applyTargetVisibility();
    renderIconPreviews();
    global.KeyStyle.clearImageCache();
    save();
    renderSidebar();

    if (connectionChanged) mountPicker(library.button(selection.id));
    renderPreview();
  }

  function applyModeVisibility(mode) {
    el('classic-fields').classList.toggle('hidden', mode === 'html');
    el('html-fields').classList.toggle('hidden', mode !== 'html');
  }

  function entityLabel(entry, entityId) {
    const pooled = pool.get(entry.connection) || pool.entries()[0];
    const record = pooled && pooled.registry ? pooled.registry.get(entityId) : null;
    return record ? record.name : entityId;
  }

  /**
   * Renders the input fields of a preset into `host`.
   *
   * The JSON underneath stays the single source of truth: these fields read
   * from it and write back into it, so anything the catalogue does not know
   * survives untouched.
   */
  function renderPresetFields(host, preset, data, onChange) {
    host.innerHTML = '';
    if (!preset || !preset.fields.length) return;

    const values = global.HaServices.readValues(preset ? preset.fields : [], data);

    for (const field of preset.fields) {
      const wrap = doc.createElement('div');
      wrap.className = 'field';

      // A slider always shows *some* position, which used to suggest that its
      // value was part of the call when it was not. The tick makes that
      // explicit: only ticked fields are sent.
      const label = doc.createElement('label');
      label.className = 'ha-field-head';
      const an = doc.createElement('input');
      an.type = 'checkbox';
      an.className = 'ha-field-on';
      an.checked = values[field.key] !== undefined;
      an.title = t('Send this field');
      label.appendChild(an);
      label.appendChild(doc.createTextNode(' ' + t(field.label) + (field.unit ? ' (' + field.unit + ')' : '')));
      wrap.appendChild(label);

      an.addEventListener('change', () => {
        wrap.classList.toggle('ha-field-off', !an.checked);
        onChange();
      });
      wrap.classList.toggle('ha-field-off', !an.checked);

      const controls = global.ColorControls;
      const current = values[field.key];
      let steuerung = null;
      let input = null;

      if (field.type === 'color') {
        steuerung = controls.colorField({ onChange: onChange });
        // A colour has no empty state, so an untouched field must not quietly
        // become whatever the sliders happen to start at.
        if (current) steuerung.set(hexZuRgb(current));
      } else if (field.key === 'brightness_pct') {
        steuerung = controls.brightnessField({
          value: current,
          onChange: onChange,
          // The track shows the colour picked right next to it.
          colorOf: () => aktuelleFarbe(host)
        });
      } else if (field.type === 'kelvin' || field.key === 'color_temp_kelvin') {
        steuerung = controls.kelvinField({ value: current, min: field.min, max: field.max, onChange: onChange });
      } else if (field.type === 'percent' || field.type === 'fraction') {
        steuerung = controls.percentField({ value: current, onChange: onChange });
      } else if (field.type === 'select') {
        input = doc.createElement('select');
        for (const option of [''].concat(field.options)) {
          const node = doc.createElement('option');
          node.value = option;
          node.textContent = option || '—';
          input.appendChild(node);
        }
      } else if (field.type === 'text') {
        input = doc.createElement('input');
        input.type = 'text';
      } else {
        input = doc.createElement('input');
        input.type = 'number';
        if (field.min !== undefined) input.min = field.min;
        if (field.max !== undefined) input.max = field.max;
        if (field.step !== undefined) input.step = field.step;
      }

      if (steuerung) {
        steuerung.node.dataset.presetKey = field.key;
        steuerung.node.__lesen = steuerung.get;
        if (steuerung.refresh) steuerung.node.__auffrischen = steuerung.refresh;
        // Touching a control means you want it: tick it automatically.
        for (const ereignis of ['input', 'click']) {
          steuerung.node.addEventListener(
            ereignis,
            () => {
              if (an.checked) return;
              an.checked = true;
              wrap.classList.remove('ha-field-off');
            },
            true
          );
        }
        wrap.appendChild(steuerung.node);
        host.appendChild(wrap);
        continue;
      }

      input.value = current === undefined ? '' : current;
      input.dataset.presetKey = field.key;
      const anhaken = () => {
        if (!an.checked) {
          an.checked = true;
          wrap.classList.remove('ha-field-off');
        }
        onChange();
      };
      input.addEventListener('input', anhaken);
      input.addEventListener('change', anhaken);
      wrap.appendChild(input);
      host.appendChild(wrap);
    }

    // The brightness track shows the colour chosen next to it, but that
    // control is built afterwards — so paint it once everything exists, and
    // again whenever the colour moves.
    koppleHelligkeitAnFarbe(host);
  }

  function koppleHelligkeitAnFarbe(host) {
    const hell = host.querySelector('[data-preset-key="brightness_pct"]');
    if (!hell || !hell.__auffrischen) return;
    hell.__auffrischen();
    const farbe = host.querySelector('[data-preset-key="rgb_color"]');
    if (!farbe) return;
    for (const ereignis of ['input', 'click']) {
      farbe.addEventListener(ereignis, () => hell.__auffrischen(), true);
    }
  }

  /** Reads the rendered fields back out, skipping the ones never touched. */
  function collectPresetValues(host) {
    const values = {};
    for (const node of host.querySelectorAll('[data-preset-key]')) {
      const wrap = node.closest('.field');
      const an = wrap ? wrap.querySelector('.ha-field-on') : null;
      if (an && !an.checked) continue;
      // A visual control knows its own value; a plain input has .value.
      const wert = node.__lesen ? node.__lesen() : node.value;
      values[node.dataset.presetKey] = Array.isArray(wert) ? controlsZuHex(wert) : wert;
    }
    return values;
  }

  /** The colour control hands back rgb; the preset catalogue expects hex. */
  function controlsZuHex(rgb) {
    return global.HaServices.rgbToHex(rgb);
  }

  function hexZuRgb(hex) {
    return global.HaServices.hexToRgb(hex);
  }

  /** Colour currently chosen next to a brightness slider, for its gradient. */
  function aktuelleFarbe(host) {
    const node = host.querySelector('[data-preset-key="rgb_color"]');
    return node && node.__lesen ? node.__lesen() : null;
  }

  /** Merges preset values into existing JSON without losing unknown keys. */
  function mergeIntoJson(json, preset, values) {
    const parsed = global.SwitchPlan.parseData(json);
    const base = parsed.error ? {} : parsed.data || {};
    const fresh = global.HaServices.buildData(preset ? preset.fields : [], values);

    const merged = Object.assign({}, base);
    for (const field of preset ? preset.fields : []) {
      delete merged[field.key];
    }
    Object.assign(merged, fresh);

    return Object.keys(merged).length ? JSON.stringify(merged) : '';
  }

  /** The button picker only matters when the long press should run one. */
  function applyTargetVisibility() {
    const fields = el('button-form').elements;
    el('target-button-field').classList.toggle('hidden', fields.target_mode.value !== 'button');
  }

  const ladeDienste = global.HaServices.loader({ log: () => {} });

  /**
   * The action list owns its own rows; the designer only tells it which button
   * it is editing and takes the result back.
   */
  let aktionsListe = null;

  /**
   * Automatic until you ask otherwise.
   *
   * A button with an empty list behaves exactly as it always did — the domain
   * decides. "Customise" fills the list with what that automatic behaviour
   * would do, so the first editable row is never a blank one.
   */
  function renderAutoState(entry) {
    const hatAktionen = (entry.actions || []).length > 0;
    const hatRegeln = (entry.rules || []).length > 0;

    el('actions-auto').classList.toggle('hidden', hatAktionen);
    el('action-list').classList.toggle('hidden', !hatAktionen);
    el('actions-reset').classList.toggle('hidden', !hatAktionen);

    el('rules-auto').classList.toggle('hidden', hatRegeln);
    el('rule-list').classList.toggle('hidden', !hatRegeln);
    el('rules-reset').classList.toggle('hidden', !hatRegeln);
  }

  /** Turns the automatic behaviour into rows you can edit. */
  function materialiseActions(entry) {
    const entities = global.Library.entitiesOf(entry);
    const erste = entities[0] || '';
    const domain = erste.split('.')[0];

    const vorschlag = domain
      ? [
          {
            id: 'act-' + Date.now().toString(36),
            trigger: 'press',
            kind: 'service',
            entity: '',
            domain: domain === 'cover' ? 'cover' : 'homeassistant',
            service: 'toggle',
            data: ''
          }
        ]
      : [];
    library.updateButton(entry.id, { actions: vorschlag });
    save();
    fillButtonForm(library.button(entry.id));
  }

  function materialiseRules(entry) {
    const erste = global.Library.entitiesOf(entry)[0] || '';
    const vorschlag = global.DisplayRules.suggest(erste).map((rule, i) =>
      Object.assign({ id: 'rule-' + Date.now().toString(36) + i }, rule)
    );
    library.updateButton(entry.id, { rules: vorschlag });
    save();
    fillButtonForm(library.button(entry.id));
  }

  function backToAuto(entry, feld) {
    library.updateButton(entry.id, feld);
    save();
    fillButtonForm(library.button(entry.id));
    renderPreview();
  }

  let regelListe = null;

  function renderRuleList(entry) {
    const host = el('rule-list');
    if (!host || !entry) return;

    if (!regelListe) {
      regelListe = new global.RuleList({
        host: host,
        t: t,
        entitiesOf: () => {
          const aktuell = library.button(selection.id);
          return aktuell ? global.Library.entitiesOf(aktuell) : [];
        },
        labelOf: (entityId) => {
          const aktuell = library.button(selection.id);
          return aktuell ? entityLabel(aktuell, entityId) : entityId;
        },
        attributesOf: () => {
          const aktuell = library.button(selection.id);
          if (!aktuell) return [];
          const verbindung = pool.get(aktuell.connection) || pool.entries()[0];
          const erste = global.Library.entitiesOf(aktuell)[0];
          const zustand = verbindung && erste ? verbindung.client.getState(erste) : null;
          return zustand && zustand.attributes ? Object.keys(zustand.attributes).sort() : [];
        },
        pickIcon: (aktuell, fertig) => openIconBrowserFor(aktuell, fertig),
        onChange: (rules) => {
          if (!selection.id) return;
          library.updateButton(selection.id, { rules: rules });
          save();
          renderPreview();
        }
      });
    }

    regelListe.set(entry.rules || []);
    renderAutoState(entry);
  }

  function renderActionList(entry) {
    const host = el('action-list');
    if (!host) return;

    if (!aktionsListe) {
      aktionsListe = new global.ActionList({
        host: host,
        t: t,
        entitiesOf: () => {
          const aktuell = library.button(selection.id);
          return aktuell ? global.Library.entitiesOf(aktuell) : [];
        },
        labelOf: (entityId) => {
          const aktuell = library.button(selection.id);
          return aktuell ? entityLabel(aktuell, entityId) : entityId;
        },
        catalogue: () => {
          const aktuell = library.button(selection.id);
          const verbindung = pool.get(aktuell ? aktuell.connection : '') || pool.entries()[0];
          return ladeDienste(verbindung);
        },
        renderFields: renderPresetFields,
        collect: collectPresetValues,
        merge: mergeIntoJson,
        onChange: (actions) => {
          if (!selection.id) return;
          library.updateButton(selection.id, { actions: actions });
          save();
          renderPreview();
        }
      });
    }

    aktionsListe.set(entry.actions || []);
  }


    function applyGroupVisibility(entityCount) {
    el('group-rule-field').classList.toggle('hidden', entityCount < 2);
  }

  function asColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value)) ? value : fallback;
  }

  // --- entities -------------------------------------------------------------

  function renderChips(entry) {
    const host = el('entity-chips');
    host.innerHTML = '';
    const entities = global.Library.entitiesOf(entry);
    applyGroupVisibility(entities.length);

    if (!entities.length) {
      const hint = doc.createElement('span');
      hint.className = 'chips-empty';
      hint.textContent = t('Pick one or more entities below.');
      host.appendChild(hint);
      return;
    }

    const poolEntry = pool.get(entry.connection);
    for (const entityId of entities) {
      const record = poolEntry ? poolEntry.registry.get(entityId) : null;
      const chip = doc.createElement('span');
      chip.className = 'chip';

      if (record && record.areaName) {
        const area = doc.createElement('span');
        area.className = 'area';
        area.textContent = record.areaName;
        chip.appendChild(area);
      }
      chip.appendChild(doc.createTextNode(record ? record.name : entityId));

      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.textContent = '✕';
      remove.title = entityId;
      remove.addEventListener('click', () => removeEntity(entityId));
      chip.appendChild(remove);

      host.appendChild(chip);
    }
  }

  /**
   * The picker only ever adds. Removing happens through a chip's ✕, because a
   * click that silently drops an entity you already picked is how a group
   * quietly loses its members.
   */
  function addEntity(entityId) {
    const entry = library.button(selection.id);
    if (!entry) return;
    const entities = global.Library.entitiesOf(entry).slice();
    if (entities.indexOf(entityId) !== -1) return; // already in the group
    entities.push(entityId);
    writeEntities(entities);
  }

  function removeEntity(entityId) {
    const entry = library.button(selection.id);
    if (!entry) return;
    writeEntities(global.Library.entitiesOf(entry).filter((id) => id !== entityId));
  }

  function writeEntities(entities) {
    // entity_id stays in sync so older plugin versions and the legacy path keep
    // working with the same library.
    library.updateButton(selection.id, { entities: entities, entity_id: entities[0] || '' });
    save();
    renderChips(library.button(selection.id));
    renderRuleList(library.button(selection.id));
    renderSidebar();
    renderPreview();
    if (picker) picker.setSelected(entities);
  }

  function mountPicker(entry) {
    const host = el('picker');
    if (picker) {
      picker.destroy();
      picker = null;
    }
    host.innerHTML = '';

    const poolEntry = pool.get(entry.connection);
    if (!poolEntry) {
      const hint = doc.createElement('p');
      hint.className = 'hint';
      hint.textContent = t('No connection configured — add one on the left');
      host.appendChild(hint);
      return;
    }

    picker = new global.EntityPicker({
      root: host,
      client: poolEntry.client,
      registry: poolEntry.registry,
      domains: global.HA_TOGGLEABLE_DOMAINS,
      t: t,
      onSelect: addEntity
    });
    picker.setSelected(global.Library.entitiesOf(entry));
  }

  // --- icon browser ---------------------------------------------------------

  /** Opens the icon browser for a rule row instead of a form field. */
  function openIconBrowserFor(current, fertig) {
    iconBrowserField = null;
    iconBrowserDone = fertig;
    el('icon-browser').classList.remove('hidden');
    el('icon-search').value = '';
    renderIconGrid();
    el('icon-search').focus();
  }

  function openIconBrowser(field) {
    iconBrowserField = field;
    el('icon-browser').classList.remove('hidden');
    el('icon-search').value = '';
    renderIconGrid();
    el('icon-search').focus();
  }

  function closeIconBrowser() {
    iconBrowserField = '';
    el('icon-browser').classList.add('hidden');
  }

  function renderIconGrid() {
    const grid = el('icon-grid');
    const query = String(el('icon-search').value || '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .trim();

    // A German word maps onto the English icon name; anything else is used raw.
    const terms = query
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((word) => ICON_SYNONYMS[word] || word);

    const all = global.KeyStyle.mdiNames();
    const names = all.filter((name) => terms.every((term) => name.indexOf(term) !== -1));
    const current = iconBrowserField ? el('button-form').elements[iconBrowserField].value : '';

    grid.innerHTML = '';
    for (const name of names) {
      const cell = doc.createElement('button');
      cell.type = 'button';
      cell.className = 'icon-cell';
      cell.setAttribute('aria-selected', String(current === 'mdi:' + name));

      const img = doc.createElement('img');
      img.src = global.KeyStyle.mdiDataUrl(name, '#eceef0');
      img.alt = '';
      cell.appendChild(img);

      const label = doc.createElement('span');
      label.textContent = name;
      cell.appendChild(label);

      cell.addEventListener('click', () => {
        if (iconBrowserDone) {
          const fertig = iconBrowserDone;
          iconBrowserDone = null;
          fertig('mdi:' + name);
          closeIconBrowser();
          return;
        }
        el('button-form').elements[iconBrowserField].value = 'mdi:' + name;
        commitButtonForm();
        closeIconBrowser();
      });
      grid.appendChild(cell);
    }

    el('icon-count').textContent = names.length + ' / ' + all.length;
  }

  function renderIconPreviews() {
    for (const node of doc.querySelectorAll('[data-icon-preview]')) {
      const value = el('button-form').elements[node.dataset.iconPreview].value;
      if (!value) {
        node.style.backgroundImage = 'none';
        continue;
      }
      const url = global.KeyStyle.isMdi(value)
        ? global.KeyStyle.mdiDataUrl(value.slice(4), '#eceef0')
        : global.KeyStyle.toImageUrl(value);
      node.style.backgroundImage = 'url("' + url + '")';
    }
  }

  // --- preview --------------------------------------------------------------

  function renderPreview() {
    if (!previewAction || selection.kind !== 'button') return;
    const entry = library.button(selection.id);
    if (!entry) return;

    previewAction.setSettings({ button: entry.id });
    previewAction.render();

    const entities = global.Library.entitiesOf(entry);
    const poolEntry = pool.get(entry.connection);
    const info = el('preview-info');
    info.innerHTML = '';

    if (!entities.length) {
      info.textContent = t('Pick an entity to see live state.');
      return;
    }

    if (entities.length > 1) {
      const group = previewAction.aggregate(library.resolveKey({ button: entry.id }), poolEntry);
      addInfo(info, t('Entities'), String(group.total));
      addInfo(info, t('On'), group.onCount + ' / ' + group.total);
      addInfo(info, t('Key shows'), group.active ? t('On') : t('Off'));
    } else {
      const record = poolEntry ? poolEntry.registry.get(entities[0]) : null;
      const stateObj = poolEntry ? poolEntry.client.getState(entities[0]) : null;
      addInfo(info, t('Entity'), entities[0]);
      if (record) {
        addInfo(info, t('Room'), record.areaName || '—');
        if (record.deviceName) addInfo(info, t('Device'), record.deviceName);
      }
      addInfo(info, t('State'), stateObj ? stateObj.state : '—');
    }
    if (poolEntry) addInfo(info, t('Connection'), poolEntry.name || poolEntry.id);
  }

  function addInfo(host, label, value) {
    const line = doc.createElement('div');
    const strong = doc.createElement('b');
    strong.textContent = label + ': ';
    line.appendChild(strong);
    line.appendChild(doc.createTextNode(value));
    host.appendChild(line);
  }

  // --- live updates ---------------------------------------------------------

  pool.on('status', () => {
    refreshConnectionDots();
    if (selection.kind === 'connection') {
      const entry = library.connection(selection.id);
      if (entry) renderConnectionStatus(entry);
    }
    if (selection.kind === 'button') renderPreview();
  });

  pool.on('states', () => {
    if (selection.kind === 'button') {
      const entry = library.button(selection.id);
      if (entry) {
        mountPicker(entry);
        renderChips(entry);
        renderPreview();
      }
    }
    if (selection.kind === 'connection') {
      const entry = library.connection(selection.id);
      if (entry) renderConnectionStatus(entry);
    }
  });

  pool.on('state', () => {
    if (selection.kind === 'button') renderPreview();
  });

  // Closing via the window's X still gets the edits saved and the keys repainted.
  // The `initialised` guard matters: if the library never arrived, writing our
  // empty one would wipe every button the user has.
  global.addEventListener('beforeunload', () => {
    if (!initialised || !dirty) return;
    saveLibrary();
    $UD.sendToPlugin({ request: 'reload' });
  });

  // The service hands a running window the next button instead of opening a
  // second one, which the host would refuse anyway.
  $UD.onSendToPropertyInspector((message) => {
    const antwort = (message && (message.payload || message.param)) || {};
    if (antwort.response === 'simulate') {
      el('sim-result').textContent = antwort.result || '';
      return;
    }
    const payload = (message && (message.payload || message.param)) || {};
    // A window of ours that is no longer on screen gets retired, so its Home
    // Assistant connection goes with it.
    if (payload.response === 'designer:close') {
      global.close();
      return;
    }
    if (payload.response !== 'designer:select') return;
    if (payload.button && library.button(payload.button)) selectItem('button', payload.button);
  });

  global.addEventListener('beforeunload', () => {
    $UD.sendToPlugin({ request: 'designer:bye' });
  });
  global.addEventListener('unload', () => {
    if (picker) picker.destroy();
    pool.destroy();
  });

  // Handy in the remote debugger.
  global.designerDebug = { library: () => library, pool: pool };
})(window);
