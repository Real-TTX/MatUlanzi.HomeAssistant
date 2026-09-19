/**
 * The control popup.
 *
 * Opens for one entity and shows the knobs that entity actually has: a light
 * gets brightness and colour, a thermostat a target temperature and its modes,
 * a cover a position. It talks to Home Assistant directly over its own
 * connection, like the designer does, so the key on the deck stays responsive
 * while you drag a slider here.
 */
(function (global) {
  'use strict';

  const doc = global.document;
  const el = (id) => doc.getElementById(id);
  const i18n = new global.I18n('en');
  const t = (key) => i18n.t(key);

  /** Sliders fire continuously; Home Assistant does not need every step. */
  const SEND_DEBOUNCE_MS = 220;
  const HEARTBEAT_MS = 2500;

  const client = new global.HaClient({ log: () => {} });
  const registry = new global.HaRegistry(client, { log: () => {} });

  let entityId = '';
  let label = '';
  let lastReportedVisible = null;
  let sendTimer = null;

  /**
   * Claim an identity of our own before connecting — the host keeps one socket
   * per identity, and sharing one would silently replace another page.
   */
  (function claimOwnIdentity() {
    try {
      const url = new global.URL(global.location.href);
      const unique = 'control-' + (url.searchParams.get('nonce') || String(Date.now()));
      if (url.searchParams.get('actionid') === unique) return;
      url.searchParams.set('key', 'control');
      url.searchParams.set('actionid', unique);
      global.history.replaceState(null, '', url.toString());
    } catch (err) {
      /* worst case we keep the inherited identity */
    }
  })();

  $UD.connect();

  $UD.onConnected(async () => {
    try {
      await $UD.localizeUI();
    } catch (err) {
      /* English source text stays */
    }
    i18n.setLanguage($UD.language || 'en');

    entityId = Utils.getQueryParams('entity') || '';
    label = Utils.getQueryParams('label') || '';

    reportPresence(true);
    global.setInterval(() => reportPresence(false), HEARTBEAT_MS);
    doc.addEventListener('visibilitychange', () => reportPresence(true));

    try {
      global.focus();
    } catch (err) {
      /* not important enough to care */
    }

    el('close').addEventListener('click', () => global.close());
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') global.close();
    });

    // The connection details live in the shared library, under the one fixed
    // identity every page uses for it.
    $UD.getGlobalSettings('com.ulanzi.ulanzistudio.matUlanziHa___library___library');
  });

  $UD.onDidReceiveGlobalSettings((message) => {
    const settings = (message && (message.settings || message.param)) || {};
    const wanted = Utils.getQueryParams('connection') || '';
    const list = settings.connections || [];
    const entry = list.filter((c) => c.id === wanted)[0] || list[0];
    if (!entry || !entry.url) {
      setStatus(t('No connection configured'));
      return;
    }
    client.configure({ url: entry.url, token: entry.token });
    client.connect();
  });

  $UD.onSendToPropertyInspector((message) => {
    const payload = (message && (message.payload || message.param)) || {};
    if (payload.response === 'control:close') {
      global.close();
      return;
    }
    if (payload.response === 'control:show' && payload.entity) {
      // A second key press re-aims this window instead of opening another.
      entityId = payload.entity;
      label = payload.name || '';
      render();
    }
  });

  function reportPresence(announce) {
    const visible = doc.visibilityState !== 'hidden';
    const changed = visible !== lastReportedVisible;
    lastReportedVisible = visible;
    if (!visible) {
      if (changed || announce) $UD.sendToPlugin({ request: 'control:bye' });
      return;
    }
    $UD.sendToPlugin({
      request: changed || announce ? 'control:hello' : 'control:ping',
      entity: entityId
    });
  }

  function setStatus(text) {
    el('status').textContent = text || '';
  }

  client.on('status', (info) => {
    setStatus(info.status === 'online' ? '' : t(info.status === 'auth_failed' ? 'Token invalid' : 'Connecting'));
    if (info.status === 'online') render();
  });
  client.on('states', render);
  client.on('state', (change) => {
    // Only redraw for the device on screen; everything else is noise here.
    if (change && change.entityId === entityId) render();
  });

  function call(domain, service, data) {
    setStatus('…');
    client
      .callService(domain, service, data || {}, { entity_id: entityId })
      .then(() => setStatus(''))
      .catch((err) => setStatus(err.message));
  }

  /** Slider moves are collapsed, so dragging does not flood Home Assistant. */
  function callSoon(domain, service, data) {
    if (sendTimer) global.clearTimeout(sendTimer);
    sendTimer = global.setTimeout(() => call(domain, service, data), SEND_DEBOUNCE_MS);
  }

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function section(labelText) {
    const wrap = element('div');
    if (labelText) wrap.appendChild(element('div', 'ha-row-label', labelText));
    return wrap;
  }

  function buttonRow(entries) {
    const row = element('div', 'ha-big');
    for (const entry of entries) {
      const button = element('button', entry.active ? 'on' : '', entry.label);
      button.type = 'button';
      button.addEventListener('click', entry.run);
      row.appendChild(button);
    }
    return row;
  }

  function render() {
    const state = client.getState(entityId);
    const record = registry.get(entityId);
    const domains = global.HaDomains;

    el('name').textContent = label || (record && record.name) || entityId || t('No entity');
    el('room').textContent = record ? [record.floorName, record.areaName].filter(Boolean).join(' › ') : '';
    el('state').textContent = state ? domains.valueText(entityId, state, t) : '--';

    const panel = el('panel');
    panel.innerHTML = '';
    if (!entityId) {
      panel.appendChild(element('p', 'hint', t('No entity')));
      return;
    }
    if (!state) {
      panel.appendChild(element('p', 'hint', t('Connecting')));
      return;
    }

    const domain = domains.domainOf(entityId);
    const attrs = state.attributes || {};
    const an = domains.isActive(entityId, state);

    panel.appendChild(
      buttonRow([
        { label: t('On'), active: an, run: () => call(domain, 'turn_on') },
        { label: t('Off'), active: !an, run: () => call(domain, 'turn_off') }
      ])
    );

    if (domain === 'light') renderLight(panel, attrs);
    else if (domain === 'climate') renderClimate(panel, state, attrs);
    else if (domain === 'cover') renderCover(panel, attrs);
    else if (domain === 'media_player') renderMedia(panel, attrs);
  }

  function renderLight(panel, attrs) {
    const controls = global.ColorControls;

    const hell = section(t('Brightness'));
    const prozent = typeof attrs.brightness === 'number' ? Math.round((attrs.brightness / 255) * 100) : 0;
    let farbe = null;

    const regler = controls.brightnessField({
      value: prozent,
      colorOf: () => (farbe ? farbe.get() : Array.isArray(attrs.rgb_color) ? attrs.rgb_color : null),
      onChange: () => callSoon('light', 'turn_on', { brightness_pct: regler.get() })
    });
    hell.appendChild(regler.node);
    panel.appendChild(hell);

    if (Array.isArray(attrs.supported_color_modes) && attrs.supported_color_modes.some((m) => /rgb|hs|xy/.test(m))) {
      const farbteil = section(t('Colour'));
      farbe = controls.colorField({
        onChange: () => {
          regler.refresh();
          callSoon('light', 'turn_on', { rgb_color: farbe.get() });
        }
      });
      if (Array.isArray(attrs.rgb_color)) farbe.set(attrs.rgb_color);
      farbteil.appendChild(farbe.node);
      panel.appendChild(farbteil);
    }

    if (attrs.min_color_temp_kelvin || attrs.color_temp_kelvin) {
      const warm = section(t('Colour temperature'));
      const kelvin = controls.kelvinField({
        value: attrs.color_temp_kelvin || 3000,
        min: attrs.min_color_temp_kelvin || 2000,
        max: attrs.max_color_temp_kelvin || 6500,
        onChange: () => callSoon('light', 'turn_on', { color_temp_kelvin: kelvin.get() })
      });
      warm.appendChild(kelvin.node);
      panel.appendChild(warm);
    }
  }

  /** A dropdown for lists that are too long for buttons — seven fan speeds. */
  function selectRow(labelText, options, current, run) {
    const wrap = section(labelText);
    const select = doc.createElement('select');
    select.className = 'ha-control-select';
    for (const value of options) {
      const node = doc.createElement('option');
      node.value = value;
      node.textContent = value;
      select.appendChild(node);
    }
    select.value = current === undefined || current === null ? '' : current;
    select.addEventListener('change', () => run(select.value));
    wrap.appendChild(select);
    return wrap;
  }

  function renderClimate(panel, state, attrs) {
    const soll = Number(attrs.temperature);
    const ist = Number(attrs.current_temperature);
    const schritt = Number(attrs.target_temp_step) || 0.5;

    const anzeige = section(t('Target temperature'));
    const wert = element('div', 'ha-reading');
    wert.textContent = isFinite(soll) ? soll + '\u00b0' : '--';
    if (isFinite(ist)) {
      wert.appendChild(element('small', '', '  ' + t('now') + ' ' + ist + '\u00b0'));
    }
    anzeige.appendChild(wert);
    panel.appendChild(anzeige);

    if (isFinite(soll)) {
      const min = isFinite(Number(attrs.min_temp)) ? Number(attrs.min_temp) : 7;
      const max = isFinite(Number(attrs.max_temp)) ? Number(attrs.max_temp) : 35;
      const setzen = (wunsch) => {
        // Clamped to what the device itself reports: Home Assistant drops an
        // out-of-range value without a word.
        const gekappt = Math.min(Math.max(Math.round(wunsch * 10) / 10, min), max);
        call('climate', 'set_temperature', { temperature: gekappt });
      };
      panel.appendChild(
        buttonRow([
          { label: '\u2212 ' + schritt + '\u00b0', run: () => setzen(soll - schritt) },
          { label: '+ ' + schritt + '\u00b0', run: () => setzen(soll + schritt) }
        ])
      );
    }

    // Every mode the device offers, not a truncated few: an air conditioner
    // that can dry or heat_cool must show it.
    const modi = attrs.hvac_modes || [];
    if (modi.length) {
      const wahl = section(t('Mode'));
      const reihe = buttonRow(
        modi.map((modus) => ({
          label: modus,
          active: state.state === modus,
          run: () => call('climate', 'set_hvac_mode', { hvac_mode: modus })
        }))
      );
      reihe.classList.add('wrap');
      wahl.appendChild(reihe);
      panel.appendChild(wahl);
    }

    if ((attrs.fan_modes || []).length > 1) {
      panel.appendChild(
        selectRow(t('Fan'), attrs.fan_modes, attrs.fan_mode, (wert2) =>
          call('climate', 'set_fan_mode', { fan_mode: wert2 })
        )
      );
    }

    if ((attrs.swing_modes || []).length > 1) {
      panel.appendChild(
        selectRow(t('Swing'), attrs.swing_modes, attrs.swing_mode, (wert2) =>
          call('climate', 'set_swing_mode', { swing_mode: wert2 })
        )
      );
    }

    if ((attrs.preset_modes || []).length > 1) {
      panel.appendChild(
        selectRow(t('Preset'), attrs.preset_modes, attrs.preset_mode, (wert2) =>
          call('climate', 'set_preset_mode', { preset_mode: wert2 })
        )
      );
    }
  }

  function renderCover(panel, attrs) {
    panel.appendChild(
      buttonRow([
        { label: '\u25b2', run: () => call('cover', 'open_cover') },
        { label: '\u25a0', run: () => call('cover', 'stop_cover') },
        { label: '\u25bc', run: () => call('cover', 'close_cover') }
      ])
    );

    if (typeof attrs.current_position === 'number') {
      const teil = section(t('Position'));
      const regler = global.ColorControls.percentField({
        value: attrs.current_position,
        onChange: () => callSoon('cover', 'set_cover_position', { position: regler.get() })
      });
      teil.appendChild(regler.node);
      panel.appendChild(teil);
    }
  }

  function renderMedia(panel, attrs) {
    panel.appendChild(
      buttonRow([
        { label: '\u23ee', run: () => call('media_player', 'media_previous_track') },
        { label: '\u23ef', run: () => call('media_player', 'media_play_pause') },
        { label: '\u23ed', run: () => call('media_player', 'media_next_track') }
      ])
    );

    if (typeof attrs.volume_level === 'number') {
      const teil = section(t('Volume'));
      const regler = global.ColorControls.percentField({
        value: Math.round(attrs.volume_level * 100),
        onChange: () => callSoon('media_player', 'volume_set', { volume_level: regler.get() / 100 })
      });
      teil.appendChild(regler.node);
      panel.appendChild(teil);
    }
  }

  global.addEventListener('beforeunload', () => {
    $UD.sendToPlugin({ request: 'control:bye' });
  });
  global.addEventListener('unload', () => client.destroy && client.destroy());

  global.controlDebug = { client: client, registry: registry, entity: () => entityId };
})(window);
