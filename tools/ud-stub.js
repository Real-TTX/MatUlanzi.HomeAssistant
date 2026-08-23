/**
 * Preview harness. Replaces window.WebSocket with a fake that emulates BOTH
 * counterparts a property inspector talks to:
 *
 *   ws://127.0.0.1:3906           -> the Ulanzi Studio host bridge
 *   ws(s)://<host>/api/websocket  -> Home Assistant
 *
 * Everything else — the SDK, the picker, the registry, the HA client — is the
 * real shipped code. Loaded only when the page URL carries `preview=1`.
 */
(function (global) {
  'use strict';

  const DEMO_VERSION = '2026.8.0-demo';
  const fixtures = global.HA_FIXTURES;

  // Mutable copy so service calls can actually change something.
  const states = new Map(
    fixtures.states.map((s) => [s.entity_id, JSON.parse(JSON.stringify(s))])
  );

  /** Global settings in the library shape. The second connection fails auth on
   *  purpose, so the status dots have something red to show. */
  const hostSettings = {
    version: 1,
    connections: [
      {
        id: 'conn-home',
        name: 'Zuhause',
        url: 'https://ha.demo.local:8123',
        token: 'demo-token-abcdefghijklmnop'
      },
      {
        id: 'conn-office',
        name: 'Büro',
        url: 'https://ha.office.local:8123',
        token: 'falsches-token'
      }
    ],
    folders: [
      { id: 'fld-wz', name: 'Wohnzimmer' },
      { id: 'fld-haus', name: 'Ganzes Haus' }
    ],
    buttons: [
      {
        id: 'btn-demo',
        name: 'Deckenlicht Wohnzimmer',
        folder: 'fld-wz',
        connection: 'conn-home',
        type: 'toggle',
        entities: ['light.decke_wz'],
        style: { icon_on: 'mdi:ceiling-light', icon_off: 'mdi:ceiling-light' }
      },
      {
        id: 'btn-rollo',
        name: 'Rollo',
        folder: 'fld-wz',
        connection: 'conn-home',
        type: 'toggle',
        entities: ['cover.wz_rollo'],
        style: { bg_off: '#1b2a4a', top: '{{area|upper}}', center: '{{value}}' }
      },
      {
        id: 'btn-gruppe',
        name: 'Alle Lichter',
        folder: 'fld-haus',
        connection: 'conn-home',
        type: 'toggle',
        entities: ['light.decke_wz', 'light.decke_kueche', 'light.decke_bad'],
        group_rule: 'any_on',
        style: { center: '{{on_count}}/{{total}}', icon_off: 'mdi:lightbulb-group' }
      },
      {
        id: 'btn-info',
        name: 'Außentemperatur',
        folder: '',
        connection: 'conn-home',
        type: 'info',
        entities: ['sensor.aussen_temp'],
        refresh_interval: 60,
        style: { top: '{{area}}', center: '{{value}}', bottom: '{{age}}' }
      }
    ]
  };
  const actionParams = { button: 'btn-demo', label: '', show_room: '1' };

  /**
   * Ulanzi Studio keys "global" settings by the sender's identity, so the
   * harness does the same — that quirk is exactly what broke the plugin, and a
   * stub that hands the same object to everybody would hide it.
   *
   * Seeded like a real installation from an older build: the library sits in the
   * bucket of the key whose inspector opened the designer, while the shared one
   * (`…matUlanziHa|library|library`) is still empty.
   */
  const STORE_KEY = 'matulanziha-preview-buckets';

  /** Persisted in localStorage so several preview pages share one "host". */
  const buckets = new Map(loadBuckets());

  function loadBuckets() {
    try {
      const raw = global.localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (err) {
      /* fall through to a fresh seed */
    }
    return [['com.ulanzi.ulanzistudio.matUlanziHa.toggle|1|1', hostSettings]];
  }

  function saveBuckets() {
    try {
      global.localStorage.setItem(STORE_KEY, JSON.stringify(Array.from(buckets.entries())));
    } catch (err) {
      /* preview convenience only */
    }
  }

  // `?reset=1` puts the harness back to the legacy-only starting point.
  if (global.location.search.indexOf('reset=1') !== -1) {
    buckets.clear();
    buckets.set('com.ulanzi.ulanzistudio.matUlanziHa.toggle|1|1', hostSettings);
    saveBuckets();
  }

  function bucketId(msg) {
    return [msg.uuid || '', msg.key || '', msg.actionid || ''].join('|');
  }

  function shortId(id) {
    const parts = id.split('|');
    const uuid = parts[0].split('.').pop() || '?';
    return uuid + '/' + parts[1];
  }

  /** Stand-in for the file dialog: a bulb icon as a data URL. */
  const DEMO_ICON =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
        '<path fill="#14161a" d="M9 21h6v-1H9v1zm3-19a7 7 0 0 0-4 12.7V18h8v-3.3A7 7 0 0 0 12 2z"/></svg>'
    );

  /** `property-inspector/x.html` -> absolute URL under the served plugin root. */
  function pluginUrl(relative) {
    const marker = '.ulanziPlugin/';
    const path = global.location.pathname;
    const index = path.indexOf(marker);
    const root = index === -1 ? '/' : path.slice(0, index + marker.length);
    return root + String(relative).replace(/^\.?\//, '');
  }

  // --- little panel so you can see what the UI would save -------------------

  let panel = null;
  function panelLog(kind, payload) {
    if (!panel) {
      panel = global.document.createElement('div');
      panel.style.cssText = [
        'position:fixed', 'right:10px', 'bottom:10px', 'width:330px', 'max-height:45vh',
        'overflow:auto', 'background:#101114', 'border:1px solid #3a3d43', 'border-radius:8px',
        'padding:9px 11px', 'font:11px Consolas,monospace', 'color:#9aa0a6', 'z-index:9999',
        'white-space:pre-wrap'
      ].join(';');
      panel.innerHTML =
        '<b style="color:#18bcf2">Preview-Bus</b> — was an Ulanzi Studio ginge:<br>';
      global.document.body.appendChild(panel);
    }
    const line = global.document.createElement('div');
    line.style.marginTop = '5px';
    line.textContent = kind + ': ' + JSON.stringify(payload);
    panel.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
  }

  /** Shows what the deck would display, one tile per key. */
  const keyTiles = new Map();
  function showKeyImage(key, dataUrl) {
    let strip = global.document.getElementById('preview-keys');
    if (!strip) {
      strip = global.document.createElement('div');
      strip.id = 'preview-keys';
      strip.style.cssText = [
        'position:fixed', 'left:10px', 'bottom:10px', 'display:flex', 'gap:8px',
        'padding:9px', 'background:#101114', 'border:1px solid #3a3d43',
        'border-radius:8px', 'z-index:9999'
      ].join(';');
      global.document.body.appendChild(strip);
    }
    let tile = keyTiles.get(key);
    if (!tile) {
      tile = global.document.createElement('img');
      tile.style.cssText = 'width:88px;height:88px;border-radius:10px;display:block';
      tile.title = 'key ' + key;
      keyTiles.set(key, tile);
      strip.appendChild(tile);
    }
    tile.src = dataUrl;
  }

  /** One socket per identity, like the host's own bookkeeping. */
  const sockets = new Map();

  // The designer opens in its own window, so the claim has to cross windows —
  // otherwise the harness could never reproduce one page stealing another's
  // identity, which is exactly the bug that broke the inspector.
  const CLAIM_KEY = 'matulanziha-preview-identity-claim';
  const TAB_ID = 'tab-' + Math.random().toString(36).slice(2, 8);

  function claimIdentity(identity) {
    try {
      global.localStorage.setItem(CLAIM_KEY, JSON.stringify({ identity: identity, tab: TAB_ID }));
    } catch (err) {
      /* preview convenience only */
    }
  }

  global.addEventListener('storage', (event) => {
    if (event.key !== CLAIM_KEY || !event.newValue) return;
    let claim;
    try {
      claim = JSON.parse(event.newValue);
    } catch (err) {
      return;
    }
    if (claim.tab === TAB_ID) return;
    const mine = sockets.get(claim.identity);
    if (!mine) return;
    mine._superseded = true;
    panelLog('Identität von anderem Fenster übernommen', shortId(claim.identity));
  });

  // --- fake socket ----------------------------------------------------------

  class FakeSocket {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.onopen = null;
      this.onclose = null;
      this.onerror = null;
      this.onmessage = null;

      this._isHa = this.url.indexOf('/api/websocket') !== -1;
      this._subscriptions = new Set();

      global.setTimeout(() => {
        this.readyState = 1;
        if (this.onopen) this.onopen({});
        if (this._isHa) this._emit({ type: 'auth_required', ha_version: DEMO_VERSION });
      }, 60);
    }

    send(raw) {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (err) {
        return;
      }
      global.setTimeout(() => {
        if (this._isHa) this._handleHa(msg);
        else this._handleHost(msg);
      }, 45);
    }

    close() {
      this.readyState = 3;
      if (this.onclose) this.onclose({});
    }

    _emit(payload) {
      if (this.readyState !== 1 || !this.onmessage) return;
      this.onmessage({ data: JSON.stringify(payload) });
    }

    // --- Ulanzi Studio side -------------------------------------------------

    _handleHost(msg) {
      const envelope = { uuid: msg.uuid, key: msg.key, actionid: msg.actionid };

      // A superseded page is talking to a host that no longer listens to it.
      if (this._superseded && msg.cmd !== 'connected') {
        panelLog('IGNORIERT (verdrängt)', msg.cmd);
        return;
      }

      switch (msg.cmd) {
        case 'connected': {
          // 4 uuid segments means the main service; anything longer is a page.
          const isMain = String(msg.uuid || '').split('.').length === 4;
          const identity = bucketId(msg);

          // The host bookkeeps one socket per identity. A second page connecting
          // with the same uuid+key+actionid replaces the first, whose messages
          // are then ignored — this is what broke the inspector once the
          // designer had been open, so the harness reproduces it.
          const previous = sockets.get(identity);
          if (previous && previous !== this) {
            previous._superseded = true;
            panelLog('Identität übernommen', shortId(identity));
          }
          sockets.set(identity, this);
          this._identity = identity;
          claimIdentity(identity);

          panelLog(isMain ? 'Main Service verbunden' : 'Seite verbunden', msg.uuid);
          // The host pushes the key's saved settings right after connecting. For
          // the main service it does so per configured key.
          global.setTimeout(() => {
            this._emit(
              Object.assign({ cmd: 'add', param: actionParams }, envelope, {
                key: msg.key || '1',
                actionid: msg.actionid || '1'
              })
            );
          }, 120);
          return;
        }

        // setBaseDataIcon and friends: this is what the deck would display.
        case 'state': {
          const item = ((msg.param || {}).statelist || [])[0] || {};
          const image = item.data || item.gifdata || item.path || '';
          panelLog('Taste gezeichnet', {
            key: item.key,
            type: item.type,
            bytes: String(image).length
          });
          if (String(image).indexOf('data:image') === 0) showKeyImage(item.key, image);
          return;
        }

        case 'getGlobalSettings': {
          const id = bucketId(msg);
          const stored = buckets.get(id) || {};
          panelLog('gelesen aus ' + shortId(id), {
            buttons: (stored.buttons || []).length
          });
          this._emit(
            Object.assign({ cmd: 'didReceiveGlobalSettings', settings: stored }, envelope)
          );
          return;
        }

        case 'setGlobalSettings': {
          const id = bucketId(msg);
          buckets.set(id, msg.settings || {});
          saveBuckets();
          panelLog('geschrieben in ' + shortId(id), {
            buttons: ((msg.settings || {}).buttons || []).map((b) => b.name)
          });
          return;
        }

        case 'openview': {
          // The real host opens a popup window; in the browser we open a tab and
          // hand the bridge coordinates along as query params.
          const query = Object.assign({ preview: '1' }, msg.param || {});
          const search = Object.keys(query)
            .filter((key) => query[key] !== undefined && query[key] !== null)
            .map((key) => key + '=' + encodeURIComponent(query[key]))
            .join('&');
          const target = pluginUrl(msg.url) + '?' + search;
          panelLog('openView', target);
          global.open(target, '_blank');
          return;
        }

        case 'selectdialog':
          panelLog('Dateidialog', msg.filter || msg.type);
          this._emit(Object.assign({ cmd: 'selectdialog', path: DEMO_ICON }, envelope));
          return;

        case 'paramfromplugin':
          Object.assign(actionParams, msg.param || {});
          panelLog('Tasten-Einstellung', msg.param);
          return;

        case 'sendToPlugin':
          panelLog('an Main Service', msg.payload || msg.param || msg.settings);
          return;

        case 'toast':
          panelLog('Toast', msg.msg !== undefined ? msg.msg : msg);
          return;

        default:
          return;
      }
    }

    // --- Home Assistant side ------------------------------------------------

    _handleHa(msg) {
      if (msg.type === 'auth') {
        if (!msg.access_token) {
          this._emit({ type: 'auth_invalid', message: 'Kein Token' });
        } else if (String(msg.access_token).indexOf('falsch') !== -1) {
          this._emit({ type: 'auth_invalid', message: 'Token ungültig (Demo)' });
        } else {
          this._emit({ type: 'auth_ok', ha_version: DEMO_VERSION });
        }
        return;
      }

      if (msg.type === 'ping') {
        this._emit({ id: msg.id, type: 'pong' });
        return;
      }

      if (msg.type === 'get_states') {
        this._result(msg, Array.from(states.values()));
        return;
      }

      if (fixtures.registry[msg.type]) {
        this._result(msg, fixtures.registry[msg.type]);
        return;
      }

      if (msg.type === 'subscribe_events') {
        this._subscriptions.add(msg.id);
        this._result(msg, null);
        return;
      }

      if (msg.type === 'unsubscribe_events') {
        this._subscriptions.delete(msg.subscription);
        this._result(msg, null);
        return;
      }

      if (msg.type === 'call_service') {
        this._callService(msg);
        this._result(msg, { context: { id: 'demo' } });
        return;
      }

      this._result(msg, null);
    }

    _result(msg, result) {
      this._emit({ id: msg.id, type: 'result', success: true, result: result });
    }

    _callService(msg) {
      const target = (msg.target && msg.target.entity_id) || null;
      const ids = Array.isArray(target) ? target : target ? [target] : [];

      for (const entityId of ids) {
        const stateObj = states.get(entityId);
        if (!stateObj) continue;
        const previous = JSON.parse(JSON.stringify(stateObj));

        const service = msg.service;
        if (service === 'toggle') {
          stateObj.state = stateObj.state === 'on' ? 'off' : 'on';
        } else if (service === 'turn_on') {
          stateObj.state = 'on';
        } else if (service === 'turn_off') {
          stateObj.state = 'off';
        } else if (service === 'lock') {
          stateObj.state = 'locked';
        } else if (service === 'unlock') {
          stateObj.state = 'unlocked';
        } else if (service === 'media_play_pause') {
          stateObj.state = stateObj.state === 'playing' ? 'paused' : 'playing';
        }

        panelLog('call_service', msg.domain + '.' + service + ' → ' + entityId + ' = ' + stateObj.state);
        this._pushStateChanged(entityId, previous, stateObj);
      }
    }

    _pushStateChanged(entityId, oldState, newState) {
      for (const id of this._subscriptions) {
        this._emit({
          id: id,
          type: 'event',
          event: {
            event_type: 'state_changed',
            data: {
              entity_id: entityId,
              old_state: oldState,
              new_state: JSON.parse(JSON.stringify(newState))
            }
          }
        });
      }
    }
  }

  global.WebSocket = FakeSocket;
  global.console.log('[preview] WebSocket stubbed — host bridge + Home Assistant are simulated');
})(window);
