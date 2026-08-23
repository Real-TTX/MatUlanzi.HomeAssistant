/**
 * Joins Home Assistant's area / device / floor / entity registries into one
 * searchable index.
 *
 * This is what the official plugin is missing: picking an entity by its bare
 * friendly name is hopeless when every ceiling light is called "Deckenlicht".
 * Every record here carries its room, device and floor, and search matches
 * across all of them.
 */
(function (global) {
  'use strict';

  /** German/English words that should narrow the search to a domain. */
  const DOMAIN_SYNONYMS = {
    licht: 'light',
    lichter: 'light',
    lampe: 'light',
    lampen: 'light',
    light: 'light',
    lights: 'light',
    schalter: 'switch',
    steckdose: 'switch',
    steckdosen: 'switch',
    switch: 'switch',
    szene: 'scene',
    szenen: 'scene',
    scene: 'scene',
    sensor: 'sensor',
    temperatur: 'sensor',
    schloss: 'lock',
    schloesser: 'lock',
    lock: 'lock',
    rollo: 'cover',
    rollos: 'cover',
    rolladen: 'cover',
    jalousie: 'cover',
    cover: 'cover',
    ventilator: 'fan',
    luefter: 'fan',
    fan: 'fan',
    heizung: 'climate',
    thermostat: 'climate',
    climate: 'climate',
    medien: 'media_player',
    media: 'media_player',
    lautsprecher: 'media_player',
    skript: 'script',
    script: 'script',
    automatisierung: 'automation',
    automation: 'automation',
    knopf: 'button',
    taster: 'button',
    button: 'button'
  };

  /** Domains worth offering for a plain on/off toggle key. */
  const TOGGLEABLE_DOMAINS = [
    'light', 'switch', 'fan', 'input_boolean', 'scene', 'script', 'automation',
    'cover', 'lock', 'media_player', 'climate', 'humidifier', 'vacuum',
    'siren', 'button', 'input_button', 'valve', 'water_heater', 'remote'
  ];

  /** Folds umlauts and accents so "Kueche" finds "Küche". */
  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .split('')
      .filter((ch) => {
        const code = ch.charCodeAt(0);
        return code < 0x0300 || code > 0x036f; // drop combining diacritics
      })
      .join('');
  }

  function tokenize(query) {
    return normalize(query).split(/[\s_.\-]+/).filter(Boolean);
  }

  const COLLATE = { numeric: true, sensitivity: 'base' };

  /** Ascending by floor, then by room name; entries without a floor last. */
  function compareByFloorThenName(a, b) {
    const floorA = a.floor || '';
    const floorB = b.floor || '';
    if (Boolean(floorA) !== Boolean(floorB)) return floorA ? -1 : 1;
    const byFloor = floorA.localeCompare(floorB, undefined, COLLATE);
    if (byFloor !== 0) return byFloor;
    return (a.name || '').localeCompare(b.name || '', undefined, COLLATE);
  }

  class HaRegistry {
    /** @param {HaClient} client */
    constructor(client, options) {
      const opts = options || {};
      this.client = client;
      this._log = opts.log || function () {};
      this._records = new Map(); // entity_id -> record
      this._areas = new Map();   // area_id -> {id, name, floor}
      this._loadedAt = 0;
      this._loading = null;
      this._unwatch = [];
    }

    get isLoaded() {
      return this._loadedAt > 0;
    }

    /** Loads (or reloads) the registries. Concurrent calls share one request. */
    load(options) {
      const opts = options || {};
      if (this._loading) return this._loading;
      if (this.isLoaded && !opts.force) return Promise.resolve(this);

      this._loading = this._load()
        .then(() => this)
        .finally(() => {
          this._loading = null;
        });
      return this._loading;
    }

    async _load() {
      const client = this.client;
      const optional = (type) => client.command({ type: type }).catch(() => []);

      const [areas, devices, entities, floors] = await Promise.all([
        optional('config/area_registry/list'),
        optional('config/device_registry/list'),
        optional('config/entity_registry/list'),
        optional('config/floor_registry/list')
      ]);

      const floorNames = new Map();
      for (const floor of floors || []) floorNames.set(floor.floor_id, floor.name);

      this._areas = new Map();
      for (const area of areas || []) {
        this._areas.set(area.area_id, {
          id: area.area_id,
          name: area.name,
          floor: floorNames.get(area.floor_id) || ''
        });
      }

      const deviceById = new Map();
      for (const device of devices || []) deviceById.set(device.id, device);

      this._records = new Map();
      for (const entry of entities || []) {
        this._records.set(entry.entity_id, this._buildRecord(entry, deviceById));
      }

      // Entities defined in YAML never reach the entity registry, so fill the
      // gaps from the state machine. They simply have no area.
      for (const entityId of this.client.states.keys()) {
        if (!this._records.has(entityId)) {
          this._records.set(entityId, this._buildRecord({ entity_id: entityId }, deviceById));
        }
      }

      this._loadedAt = Date.now();
      this._log('[registry] ' + this._records.size + ' entities, ' + this._areas.size + ' areas');
    }

    _buildRecord(entry, deviceById) {
      const entityId = entry.entity_id;
      const domain = entityId.split('.')[0];
      const state = this.client.getState(entityId);
      const device = entry.device_id ? deviceById.get(entry.device_id) : null;
      const areaId = entry.area_id || (device && device.area_id) || '';
      const area = this._areas.get(areaId) || null;

      const deviceName = device ? device.name_by_user || device.name || '' : '';
      const name =
        (state && state.attributes && state.attributes.friendly_name) ||
        entry.name ||
        entry.original_name ||
        entityId;

      const record = {
        entityId: entityId,
        domain: domain,
        name: name,
        deviceName: deviceName,
        areaId: areaId,
        areaName: area ? area.name : '',
        floorName: area ? area.floor : '',
        entityCategory: entry.entity_category || '',
        hidden: Boolean(entry.hidden_by),
        disabled: Boolean(entry.disabled_by)
      };

      record.haystack = normalize(
        [name, record.areaName, record.floorName, deviceName, entityId, domain].join(' ')
      );
      return record;
    }

    /** @returns {object|null} */
    get(entityId) {
      return this._records.get(entityId) || null;
    }

    /**
     * All areas sorted by floor, then room — both ascending, numeric-aware so
     * "2. OG" sorts after "1. OG" rather than before "10. OG". Areas without a
     * floor come last, since they have nothing to group under.
     */
    areas() {
      return Array.from(this._areas.values()).sort(compareByFloorThenName);
    }

    /**
     * Ranked search across name, room, device, floor and entity_id.
     *
     * @param {string} query
     * @param {object} [options]
     * @param {string[]} [options.domains]     restrict to these domains
     * @param {string}   [options.areaId]      restrict to one area
     * @param {number}   [options.limit]       default 60
     * @param {boolean}  [options.includeHidden] include hidden/disabled/diagnostic
     * @returns {object[]}
     */
    search(query, options) {
      const opts = options || {};
      const limit = opts.limit || 60;
      const tokens = tokenize(query);

      // "licht küche" implies the light domain.
      const impliedDomains = new Set();
      const textTokens = [];
      for (const token of tokens) {
        const domain = DOMAIN_SYNONYMS[token];
        if (domain) impliedDomains.add(domain);
        else textTokens.push(token);
      }

      const allowedDomains = opts.domains && opts.domains.length ? new Set(opts.domains) : null;
      const results = [];

      for (const record of this._records.values()) {
        if (!opts.includeHidden && (record.hidden || record.disabled)) continue;
        if (!opts.includeHidden && record.entityCategory) continue;
        if (allowedDomains && !allowedDomains.has(record.domain)) continue;
        if (impliedDomains.size && !impliedDomains.has(record.domain)) continue;
        if (opts.areaId && record.areaId !== opts.areaId) continue;

        const score = this._score(record, textTokens);
        if (score === null) continue;
        results.push({ record: record, score: score });
      }

      results.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const areaA = a.record.areaName;
        const areaB = b.record.areaName;
        if (Boolean(areaA) !== Boolean(areaB)) return areaA ? -1 : 1; // roomless last
        const area = areaA.localeCompare(areaB);
        if (area !== 0) return area;
        return a.record.name.localeCompare(b.record.name);
      });

      return results.slice(0, limit).map((hit) => hit.record);
    }

    /** @returns {number|null} null when a token does not match at all */
    _score(record, tokens) {
      if (!tokens.length) return record.areaName ? 1 : 0; // no query: prefer placed entities

      const name = normalize(record.name);
      const area = normalize(record.areaName);
      const device = normalize(record.deviceName);
      const floor = normalize(record.floorName);
      const entityId = normalize(record.entityId);

      let score = 0;
      for (const token of tokens) {
        let best = 0;
        if (entityId === token) best = 1000;
        else if (name === token) best = 200;
        else if (name.startsWith(token)) best = 90;
        else if (name.includes(token)) best = 60;
        else if (area.startsWith(token)) best = 55;
        else if (area.includes(token)) best = 40;
        else if (device.includes(token)) best = 30;
        else if (floor.includes(token)) best = 20;
        else if (entityId.includes(token)) best = 10;

        if (!best) return null; // every token has to land somewhere
        score += best;
      }

      if (record.areaName) score += 5; // an entity with a room is more useful
      return score;
    }

    /** Reloads the index whenever HA's registries change. */
    async watch() {
      this.unwatch();
      const events = [
        'area_registry_updated',
        'device_registry_updated',
        'entity_registry_updated'
      ];
      for (const eventType of events) {
        try {
          const off = await this.client.subscribeEvents(eventType, () => this._scheduleReload());
          this._unwatch.push(off);
        } catch (err) {
          this._log('[registry] cannot watch ' + eventType + ': ' + err.message);
        }
      }
    }

    unwatch() {
      for (const off of this._unwatch) off();
      this._unwatch = [];
    }

    _scheduleReload() {
      if (this._reloadTimer) global.clearTimeout(this._reloadTimer);
      this._reloadTimer = global.setTimeout(() => {
        this._reloadTimer = null;
        this.load({ force: true }).catch((err) =>
          this._log('[registry] reload failed: ' + err.message)
        );
      }, 1500);
    }
  }

  global.HaRegistry = HaRegistry;
  global.haNormalize = normalize;
  global.HA_TOGGLEABLE_DOMAINS = TOGGLEABLE_DOMAINS;
})(window);
