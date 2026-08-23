/**
 * Holds one HaClient + HaRegistry per configured Home Assistant instance, so a
 * single deck can drive several installations (home, office, lab).
 *
 * Events are re-emitted with the connection id attached:
 *   status  {connectionId, status, error, haVersion}
 *   states  {connectionId}
 *   state   {connectionId, entityId, newState, oldState}
 */
(function (global) {
  'use strict';

  class HaPool {
    constructor(options) {
      const opts = options || {};
      this._log = opts.log || function () {};
      /** @type {Map<string, {id, client, registry, unsubscribe: Function[]}>} */
      this._entries = new Map();
      this._listeners = new Map();
      this._order = [];
    }

    on(event, handler) {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event).add(handler);
      return () => this._listeners.get(event).delete(handler);
    }

    _emit(event, payload) {
      const set = this._listeners.get(event);
      if (!set) return;
      for (const handler of Array.from(set)) {
        try {
          handler(payload);
        } catch (err) {
          this._log('[pool] listener failed for ' + event, err);
        }
      }
    }

    /** Creates, updates and removes clients to match the given connections. */
    configure(connections) {
      const list = Array.isArray(connections) ? connections : [];
      this._order = list.map((entry) => entry.id);

      for (const connection of list) {
        const existing = this._entries.get(connection.id);
        if (existing) {
          existing.name = connection.name;
          existing.url = connection.url || '';
          existing.client.configure({ url: connection.url, token: connection.token });
        } else {
          this._create(connection);
        }
      }

      for (const id of Array.from(this._entries.keys())) {
        if (!list.some((entry) => entry.id === id)) this.remove(id);
      }
    }

    _create(connection) {
      const log = (...args) => this._log('[' + (connection.name || connection.id) + ']', ...args);
      const client = new global.HaClient({ log: log });
      const registry = new global.HaRegistry(client, { log: log });

      const entry = {
        id: connection.id,
        name: connection.name,
        // Kept here too: an 'open' key needs the address without touching the client.
        url: connection.url || '',
        client: client,
        registry: registry,
        unsubscribe: []
      };
      this._entries.set(connection.id, entry);

      entry.unsubscribe.push(
        client.on('status', (info) =>
          this._emit('status', Object.assign({ connectionId: connection.id }, info))
        )
      );

      // Load the registry only once the state machine is in: entity names come
      // from the states, so loading on `status: online` would race get_states
      // and leave every record named after its entity_id.
      entry.unsubscribe.push(
        client.on('states', () => {
          registry
            .load({ force: true })
            .then(() => registry.watch())
            .then(() => this._emit('states', { connectionId: connection.id }))
            .catch((err) => {
              log('registry load failed: ' + err.message);
              this._emit('states', { connectionId: connection.id });
            });
        })
      );

      entry.unsubscribe.push(
        client.on('state', (change) =>
          this._emit('state', Object.assign({ connectionId: connection.id }, change))
        )
      );

      client.configure({ url: connection.url, token: connection.token });
      return entry;
    }

    remove(id) {
      const entry = this._entries.get(id);
      if (!entry) return;
      for (const off of entry.unsubscribe) off();
      entry.registry.unwatch();
      entry.client.close({ silent: true });
      this._entries.delete(id);
    }

    /** @returns {{id, client, registry}|null} falls back to the first connection */
    get(id) {
      if (id && this._entries.has(id)) return this._entries.get(id);
      return this.first();
    }

    first() {
      for (const id of this._order) {
        if (this._entries.has(id)) return this._entries.get(id);
      }
      const iterator = this._entries.values().next();
      return iterator.done ? null : iterator.value;
    }

    entries() {
      return this._order
        .map((id) => this._entries.get(id))
        .filter(Boolean);
    }

    destroy() {
      for (const id of Array.from(this._entries.keys())) this.remove(id);
    }
  }

  global.HaPool = HaPool;
})(window);
