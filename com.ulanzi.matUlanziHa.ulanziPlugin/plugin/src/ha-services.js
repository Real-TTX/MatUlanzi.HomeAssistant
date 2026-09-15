/**
 * Home Assistant's own service catalogue, turned into input fields.
 *
 * Hand-maintaining a list of actions was a mistake: it knew one thing about
 * covers while Home Assistant knows ten, and it could never cover an
 * integration it had not heard of. `get_services` returns every domain with
 * every service and, for each field, a selector describing exactly what it
 * accepts — min, max, step, unit, options. That is enough to build the editor.
 *
 * Measured against a real instance: 76 domains, and the selectors that actually
 * occur are text (144), number (76), boolean (42), select (38) and object (38),
 * plus the colour ones. Anything unsupported falls back to the raw JSON field,
 * so no service is ever unreachable.
 */
(function (global) {
  'use strict';

  /** Domains worth offering next to the entity's own. */
  const ALWAYS = ['homeassistant', 'notify', 'script', 'scene'];

  /**
   * The `homeassistant` domain also carries `restart` and `stop`. Those have no
   * business one mis-tap away on a desk device, so only the switching services
   * are offered. A raw domain/service can still be typed by hand.
   */
  const SAFE_HOMEASSISTANT = ['turn_on', 'turn_off', 'toggle', 'update_entity'];

  /** Fields we cannot render sensibly; the JSON below stays for those. */
  const UNSUPPORTED = ['object', 'entity', 'target', 'media', 'device', 'area', 'config_entry'];

  function domainOf(entityId) {
    return String(entityId || '').split('.')[0];
  }

  function titleCase(text) {
    return String(text || '')
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase());
  }

  /**
   * One selector turned into something the designer can render.
   * @returns {{key,label,type,min,max,step,unit,options,required}|null}
   */
  function normalizeField(key, spec) {
    const info = spec || {};
    const selector = info.selector || {};
    const base = {
      key: key,
      label: info.name || titleCase(key),
      description: info.description || '',
      required: Boolean(info.required),
      advanced: Boolean(info.advanced)
    };

    for (const art of UNSUPPORTED) {
      if (selector[art] !== undefined) return null;
    }

    if (selector.color_temp) {
      const ct = selector.color_temp;
      // HA reports mireds for some lights and kelvin for others.
      const kelvin = !ct.unit || ct.unit === 'kelvin';
      return Object.assign(base, {
        type: kelvin ? 'kelvin' : 'number',
        min: ct.min === undefined ? 2000 : ct.min,
        max: ct.max === undefined ? 6500 : ct.max,
        step: 50,
        unit: kelvin ? 'K' : 'mired'
      });
    }

    if (selector.color_rgb !== undefined) {
      return Object.assign(base, { type: 'color' });
    }

    if (selector.number) {
      const number = selector.number;
      const unit = number.unit_of_measurement || '';
      const step = number.step === 'any' || number.step === undefined ? 1 : Number(number.step);
      return Object.assign(base, {
        type: unit === '%' ? 'percent' : 'number',
        min: number.min,
        max: number.max,
        step: step,
        unit: unit
      });
    }

    if (selector.select) {
      const optionen = (selector.select.options || []).map((option) =>
        option && typeof option === 'object' ? option.value : option
      );
      return Object.assign(base, { type: 'select', options: optionen });
    }

    if (selector.boolean !== undefined) {
      return Object.assign(base, { type: 'boolean' });
    }

    if (selector.text !== undefined || selector.template !== undefined) {
      return Object.assign(base, { type: 'text' });
    }

    if (selector.state !== undefined) {
      return Object.assign(base, { type: 'text' });
    }

    // Unknown selector: better a text field than no field at all.
    return Object.assign(base, { type: 'text' });
  }

  /**
   * Every service worth offering for an entity, the entity's own domain first.
   *
   * @param {object} catalogue raw get_services answer
   * @param {string} entityId
   * @returns {Array<{domain,service,label,fields,description}>}
   */
  function servicesFor(catalogue, entityId) {
    const alle = catalogue || {};
    const eigen = domainOf(entityId);
    const domains = [eigen].concat(ALWAYS.filter((name) => name !== eigen));

    const liste = [];
    for (const domain of domains) {
      const dienste = alle[domain];
      if (!dienste) continue;
      for (const service of Object.keys(dienste).sort()) {
        if (domain === 'homeassistant' && SAFE_HOMEASSISTANT.indexOf(service) === -1) continue;
        liste.push(describe(dienste[service], domain, service));
      }
    }
    return liste;
  }

  function describe(definition, domain, service) {
    const info = definition || {};
    const felder = info.fields || {};
    const fields = [];
    let hatUnrenderbares = false;

    for (const key of Object.keys(felder)) {
      // A collapsed group of extra fields; its members sit one level down.
      if (felder[key] && felder[key].fields) {
        hatUnrenderbares = true;
        continue;
      }
      const field = normalizeField(key, felder[key]);
      if (field) fields.push(field);
      else hatUnrenderbares = true;
    }

    return {
      domain: domain,
      service: service,
      label: info.name || titleCase(service),
      description: info.description || '',
      fields: fields,
      /** True when some field can only be reached through the raw JSON. */
      partial: hatUnrenderbares
    };
  }

  function find(catalogue, domain, service) {
    const dienste = (catalogue || {})[domain];
    if (!dienste || !dienste[service]) return null;
    return describe(dienste[service], domain, service);
  }

  /**
   * Loads the catalogue once per connection and keeps it.
   *
   * Services change only when Home Assistant restarts or an integration is
   * added, so re-fetching on every designer open would be pure noise.
   */
  function loader(options) {
    const opts = options || {};
    const log = opts.log || function () {};
    const cache = new Map();

    return function load(entry) {
      if (!entry || !entry.client) return Promise.resolve(null);
      if (cache.has(entry.id)) return Promise.resolve(cache.get(entry.id));

      return entry.client
        .command({ type: 'get_services' })
        .then((catalogue) => {
          cache.set(entry.id, catalogue);
          log('[services] ' + Object.keys(catalogue || {}).length + ' domains from ' + entry.id);
          return catalogue;
        })
        .catch((err) => {
          log('[services] not available: ' + (err && err.message));
          return null;
        });
    };
  }

  function hexToRgb(hex) {
    const treffer = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!treffer) return null;
    const wert = parseInt(treffer[1], 16);
    return [(wert >> 16) & 255, (wert >> 8) & 255, wert & 255];
  }

  function rgbToHex(rgb) {
    if (!Array.isArray(rgb) || rgb.length < 3) return '';
    const teil = (n) => {
      const b = Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
      return (b < 16 ? '0' : '') + b.toString(16);
    };
    return '#' + teil(rgb[0]) + teil(rgb[1]) + teil(rgb[2]);
  }

  /**
   * What the user typed, turned into service data.
   * An empty field is left out entirely: Home Assistant treats a missing key
   * very differently from a null.
   */
  function buildData(fields, values) {
    const data = {};
    for (const field of fields || []) {
      const raw = values ? values[field.key] : undefined;
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;

      if (field.type === 'color') {
        const rgb = hexToRgb(raw);
        if (rgb) data[field.key] = rgb;
        continue;
      }
      if (field.type === 'boolean') {
        data[field.key] = raw === true || raw === 'true' || raw === '1';
        continue;
      }
      if (field.type === 'percent' || field.type === 'number' || field.type === 'kelvin') {
        const zahl = Number(raw);
        if (!isNaN(zahl)) data[field.key] = zahl;
        continue;
      }
      data[field.key] = String(raw);
    }
    return data;
  }

  /** The other direction, so a saved button shows its values again. */
  function readValues(fields, data) {
    const values = {};
    if (!data) return values;
    for (const field of fields || []) {
      const raw = data[field.key];
      if (raw === undefined || raw === null) continue;
      values[field.key] = field.type === 'color' ? rgbToHex(raw) : raw;
    }
    return values;
  }

  global.HaServices = {
    normalizeField: normalizeField,
    servicesFor: servicesFor,
    describe: describe,
    find: find,
    loader: loader,
    buildData: buildData,
    readValues: readValues,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    domainOf: domainOf,
    ALWAYS: ALWAYS,
    SAFE_HOMEASSISTANT: SAFE_HOMEASSISTANT
  };
})(window);
