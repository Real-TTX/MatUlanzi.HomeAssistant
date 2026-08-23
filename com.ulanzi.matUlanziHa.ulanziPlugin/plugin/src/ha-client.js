/**
 * Minimal Home Assistant WebSocket API client.
 *
 * Loaded as a classic script (no ES modules): both the main service and the
 * property inspectors run from file:// inside UlanziStudio's WebView, where
 * module imports are blocked by CORS.
 */
(function (global) {
  'use strict';

  const HA_STATUS = Object.freeze({
    IDLE: 'idle',
    CONNECTING: 'connecting',
    ONLINE: 'online',
    AUTH_FAILED: 'auth_failed',
    OFFLINE: 'offline'
  });

  const BACKOFF_MS = [1000, 2000, 5000, 10000, 20000, 30000];
  const PING_INTERVAL_MS = 30000;
  const PING_TIMEOUT_MS = 10000;

  /** `http://host:8123` (or a bare host) -> `ws://host:8123/api/websocket` */
  function toWebSocketUrl(raw) {
    let url = String(raw || '').trim();
    if (!url) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url;
    url = url.replace(/\/+$/, '').replace(/^http/i, 'ws');
    if (!/\/api\/websocket$/.test(url)) url += '/api/websocket';
    return url;
  }

  class HaClient {
    /**
     * @param {object} options
     * @param {function} [options.log]          logger, defaults to noop
     * @param {boolean}  [options.bootstrap]    load all states and subscribe to
     *                                          state_changed after auth (default true).
     *                                          Property inspectors pass false.
     * @param {boolean}  [options.autoReconnect] default true
     */
    constructor(options) {
      const opts = options || {};
      this.url = '';
      this.token = '';
      this.status = HA_STATUS.IDLE;
      this.lastError = '';
      this.haVersion = '';
      /** @type {Map<string, object>} entity_id -> state object */
      this.states = new Map();

      this._log = opts.log || function () {};
      this._bootstrap = opts.bootstrap !== false;
      this._autoReconnect = opts.autoReconnect !== false;

      this._socket = null;
      this._msgId = 1;
      this._pending = new Map();       // msg id -> {resolve, reject}
      this._subscriptions = new Map(); // msg id -> event handler
      this._listeners = new Map();     // event name -> Set<handler>
      this._attempt = 0;
      this._reconnectTimer = null;
      this._pingTimer = null;
      this._pingTimeout = null;
      this._closing = false;
    }

    // --- tiny event emitter -------------------------------------------------

    /** Events: `status`, `states`, `state`, `error`. Returns an unsubscribe fn. */
    on(event, handler) {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event).add(handler);
      return () => this.off(event, handler);
    }

    off(event, handler) {
      const set = this._listeners.get(event);
      if (set) set.delete(handler);
    }

    _emit(event, payload) {
      const set = this._listeners.get(event);
      if (!set) return;
      for (const handler of Array.from(set)) {
        try {
          handler(payload);
        } catch (err) {
          this._log('[ha] listener failed for "' + event + '"', err);
        }
      }
    }

    // --- connection ---------------------------------------------------------

    get isOnline() {
      return this.status === HA_STATUS.ONLINE;
    }

    /** Applies credentials. Reconnects when they changed. Returns true on change. */
    configure(config) {
      const cfg = config || {};
      const url = String(cfg.url || '').trim();
      const token = String(cfg.token || '').trim();
      const changed = url !== this.url || token !== this.token;
      this.url = url;
      this.token = token;
      if (!changed) return false;

      this._attempt = 0;
      this.close({ silent: true });
      if (url && token) this.connect();
      else this._setStatus(HA_STATUS.IDLE);
      return true;
    }

    connect() {
      if (!this.url || !this.token) {
        this.lastError = 'URL oder Token fehlt';
        this._setStatus(HA_STATUS.IDLE);
        return;
      }
      if (this._socket) return;

      const wsUrl = toWebSocketUrl(this.url);
      this._closing = false;
      this._setStatus(HA_STATUS.CONNECTING);
      this._log('[ha] connecting to ' + wsUrl);

      let socket;
      try {
        socket = new WebSocket(wsUrl);
      } catch (err) {
        this.lastError = String((err && err.message) || err);
        this._onClosed();
        return;
      }
      this._socket = socket;

      socket.onopen = () => this._log('[ha] socket open, waiting for auth_required');
      socket.onerror = () => {
        // onclose fires right after and owns the reconnect.
        this.lastError = this.lastError || 'Verbindung fehlgeschlagen';
      };
      socket.onclose = () => this._onClosed();
      socket.onmessage = (evt) => {
        let msg;
        try {
          msg = JSON.parse(evt.data);
        } catch (err) {
          this._log('[ha] unparseable message', evt.data);
          return;
        }
        this._handleMessage(msg);
      };
    }

    /** @param {{silent?: boolean}} [options] silent = do not reconnect afterwards */
    close(options) {
      const opts = options || {};
      this._clearTimers();
      if (opts.silent) this._closing = true;
      const socket = this._socket;
      this._socket = null;
      if (socket) {
        socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;
        try {
          socket.close();
        } catch (err) {
          /* already gone */
        }
      }
      this._rejectPending('Verbindung geschlossen');
    }

    _handleMessage(msg) {
      switch (msg.type) {
        case 'auth_required':
          this.haVersion = msg.ha_version || '';
          this._sendRaw({ type: 'auth', access_token: this.token });
          return;

        case 'auth_ok':
          this.haVersion = msg.ha_version || this.haVersion;
          this.lastError = '';
          this._attempt = 0;
          this._setStatus(HA_STATUS.ONLINE);
          this._startPing();
          if (this._bootstrap) this._loadStates();
          return;

        case 'auth_invalid':
          this.lastError = msg.message || 'Token ungueltig';
          this._setStatus(HA_STATUS.AUTH_FAILED);
          this.close({ silent: true });
          return;

        case 'pong':
          this._clearPingTimeout();
          return;

        case 'result': {
          const pending = this._pending.get(msg.id);
          if (!pending) return;
          this._pending.delete(msg.id);
          if (msg.success) pending.resolve(msg.result);
          else pending.reject(new Error((msg.error && msg.error.message) || 'HA-Fehler'));
          return;
        }

        case 'event': {
          const handler = this._subscriptions.get(msg.id);
          if (handler) handler(msg.event);
          return;
        }

        default:
          this._log('[ha] unhandled message type: ' + msg.type);
      }
    }

    _onClosed() {
      const wasOnline = this.isOnline;
      this.close();
      this._subscriptions.clear();
      if (this._closing || this.status === HA_STATUS.AUTH_FAILED) return;

      this._setStatus(HA_STATUS.OFFLINE);
      if (wasOnline) this._log('[ha] connection lost');
      if (!this._autoReconnect) return;

      const delay = BACKOFF_MS[Math.min(this._attempt, BACKOFF_MS.length - 1)];
      this._attempt += 1;
      this._log('[ha] reconnecting in ' + delay + 'ms (attempt ' + this._attempt + ')');
      this._reconnectTimer = global.setTimeout(() => {
        this._reconnectTimer = null;
        this.connect();
      }, delay);
    }

    _setStatus(status) {
      if (this.status === status) return;
      this.status = status;
      this._emit('status', {
        status: status,
        error: this.lastError,
        haVersion: this.haVersion
      });
    }

    // --- commands -----------------------------------------------------------

    _sendRaw(payload) {
      if (!this._socket || this._socket.readyState !== 1) return false;
      this._socket.send(JSON.stringify(payload));
      return true;
    }

    /** Sends a command and resolves with its result. */
    command(message) {
      return new Promise((resolve, reject) => {
        if (!this._socket || this._socket.readyState !== 1) {
          reject(new Error('Keine Verbindung zu Home Assistant'));
          return;
        }
        const id = this._msgId++;
        this._pending.set(id, { resolve: resolve, reject: reject });
        if (!this._sendRaw(Object.assign({ id: id }, message))) {
          this._pending.delete(id);
          reject(new Error('Senden fehlgeschlagen'));
        }
      });
    }

    /** Subscribes to an event type; resolves with an unsubscribe fn. */
    async subscribeEvents(eventType, handler) {
      const id = this._msgId; // command() consumes exactly this id next
      await this.command({ type: 'subscribe_events', event_type: eventType });
      this._subscriptions.set(id, handler);
      return () => {
        this._subscriptions.delete(id);
        this.command({ type: 'unsubscribe_events', subscription: id }).catch(() => {});
      };
    }

    callService(domain, service, data, target) {
      const payload = { type: 'call_service', domain: domain, service: service };
      if (data && Object.keys(data).length) payload.service_data = data;
      if (target && Object.keys(target).length) payload.target = target;
      return this.command(payload);
    }

    getState(entityId) {
      return this.states.get(entityId) || null;
    }

    async _loadStates() {
      try {
        const states = await this.command({ type: 'get_states' });
        this.states = new Map(states.map((s) => [s.entity_id, s]));
        this._emit('states', this.states);

        await this.subscribeEvents('state_changed', (event) => {
          const data = event && event.data;
          if (!data || !data.entity_id) return;
          if (data.new_state) this.states.set(data.entity_id, data.new_state);
          else this.states.delete(data.entity_id);
          this._emit('state', {
            entityId: data.entity_id,
            newState: data.new_state || null,
            oldState: data.old_state || null
          });
        });
        this._log('[ha] ' + this.states.size + ' entities loaded, subscribed to state_changed');
      } catch (err) {
        this.lastError = String((err && err.message) || err);
        this._log('[ha] bootstrap failed: ' + this.lastError);
        this._emit('error', this.lastError);
        this._onClosed(); // closes the socket and schedules a reconnect
      }
    }

    // --- keepalive ----------------------------------------------------------

    _startPing() {
      this._clearPingTimers();
      this._pingTimer = global.setInterval(() => {
        if (!this._sendRaw({ id: this._msgId++, type: 'ping' })) return;
        this._clearPingTimeout();
        this._pingTimeout = global.setTimeout(() => {
          this._log('[ha] ping timed out, dropping connection');
          this.lastError = 'Keine Antwort von Home Assistant';
          this._onClosed();
        }, PING_TIMEOUT_MS);
      }, PING_INTERVAL_MS);
    }

    _clearPingTimeout() {
      if (this._pingTimeout) {
        global.clearTimeout(this._pingTimeout);
        this._pingTimeout = null;
      }
    }

    _clearPingTimers() {
      if (this._pingTimer) {
        global.clearInterval(this._pingTimer);
        this._pingTimer = null;
      }
      this._clearPingTimeout();
    }

    _clearTimers() {
      this._clearPingTimers();
      if (this._reconnectTimer) {
        global.clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
    }

    _rejectPending(reason) {
      for (const pending of this._pending.values()) {
        pending.reject(new Error(reason));
      }
      this._pending.clear();
    }
  }

  global.HA_STATUS = HA_STATUS;
  global.HaClient = HaClient;
  global.haToWebSocketUrl = toWebSocketUrl;
})(window);
