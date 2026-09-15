/**
 * Domain semantics: what "active" means per domain, which service a key press
 * should call, and how a state should be shown on a 196x196 key.
 */
(function (global) {
  'use strict';

  const UNAVAILABLE = ['unavailable', 'unknown', 'none', ''];

  /** States that should light the key up, per domain. */
  const ACTIVE_STATES = {
    cover: ['open', 'opening'],
    lock: ['unlocked', 'open', 'opening'],
    media_player: ['playing', 'on', 'buffering'],
    vacuum: ['cleaning', 'returning'],
    person: ['home'],
    device_tracker: ['home'],
    climate: ['heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'],
    water_heater: ['eco', 'electric', 'performance', 'high_demand', 'heat_pump', 'gas']
  };

  /** Accent colour per domain when the entity is active. */
  const DOMAIN_ACCENTS = {
    light: '#f4b740',
    switch: '#2ec4a6',
    input_boolean: '#2ec4a6',
    fan: '#4fc3f7',
    cover: '#6aa9ff',
    lock: '#ff6b6b',
    media_player: '#a48bff',
    climate: '#ff8a4c',
    scene: '#ffd166',
    script: '#8fd694',
    automation: '#8fd694',
    vacuum: '#7fd1e8',
    humidifier: '#5ec8e5',
    siren: '#ff5c5c'
  };

  const DEFAULT_ACCENT = '#3fa8f5';

  function isUnavailable(stateObj) {
    return !stateObj || UNAVAILABLE.indexOf(String(stateObj.state).toLowerCase()) !== -1;
  }

  function domainOf(entityId) {
    return String(entityId || '').split('.')[0];
  }

  /** Should the key be rendered in its "on" look? */
  function isActive(entityId, stateObj) {
    if (isUnavailable(stateObj)) return false;
    const state = String(stateObj.state).toLowerCase();
    const domain = domainOf(entityId);
    const specific = ACTIVE_STATES[domain];
    if (specific) return specific.indexOf(state) !== -1;
    return state === 'on' || state === 'home' || state === 'active';
  }

  /**
   * The service a single key press should call.
   * @returns {{domain: string, service: string, data: object}}
   */
  function pressService(entityId, stateObj) {
    const domain = domainOf(entityId);
    const state = stateObj ? String(stateObj.state).toLowerCase() : '';

    switch (domain) {
      case 'scene':
        return { domain: 'scene', service: 'turn_on', data: {} };
      case 'script':
        return { domain: 'script', service: 'toggle', data: {} };
      case 'automation':
        // Not homeassistant.toggle: that enables or disables the automation,
        // while pressing a key almost always means "run it now".
        return { domain: 'automation', service: 'trigger', data: {} };
      case 'button':
        return { domain: 'button', service: 'press', data: {} };
      case 'input_button':
        return { domain: 'input_button', service: 'press', data: {} };
      case 'lock':
        return { domain: 'lock', service: state === 'locked' ? 'unlock' : 'lock', data: {} };
      case 'media_player':
        return { domain: 'media_player', service: 'media_play_pause', data: {} };
      case 'vacuum':
        return {
          domain: 'vacuum',
          service: state === 'cleaning' ? 'return_to_base' : 'start',
          data: {}
        };
      case 'cover':
        return { domain: 'cover', service: 'toggle', data: {} };
      case 'climate':
        return { domain: 'climate', service: 'toggle', data: {} };
      default:
        // homeassistant.toggle covers every on/off domain generically.
        return { domain: 'homeassistant', service: 'toggle', data: {} };
    }
  }

  /**
   * Plans a relative change — the keypad answer to a rotary dial.
   *
   * `delta` is in the unit the user sees: degrees for climate, percent for
   * light, cover, fan and volume. Everything is clamped to the range the entity
   * itself reports, because Home Assistant silently ignores a value outside it
   * and the key would just look broken.
   *
   * @returns {{domain,service,data,value,unit,text}|null} null when the entity
   *          has nothing to step.
   */
  function stepPlan(entityId, stateObj, delta) {
    if (!stateObj || isUnavailable(stateObj)) return null;
    const domain = domainOf(entityId);
    const attrs = stateObj.attributes || {};
    const amount = Number(delta) || 0;
    if (!amount) return null;

    if (domain === 'climate') {
      const current = Number(attrs.temperature);
      if (!isFinite(current)) return null;
      const min = isFinite(Number(attrs.min_temp)) ? Number(attrs.min_temp) : 7;
      const max = isFinite(Number(attrs.max_temp)) ? Number(attrs.max_temp) : 35;
      const value = clamp(round1(current + amount), min, max);
      return {
        domain: 'climate',
        service: 'set_temperature',
        data: { temperature: value },
        value: value,
        unit: '\u00b0',
        text: value + '\u00b0'
      };
    }

    if (domain === 'light') {
      const raw = Number(attrs.brightness);
      const current = isFinite(raw) ? Math.round((raw / 255) * 100) : 0;
      const value = clamp(Math.round(current + amount), 0, 100);
      // Dimming to zero means off; light.turn_on with 0 % is a no-op in HA.
      if (value <= 0) {
        return { domain: 'light', service: 'turn_off', data: {}, value: 0, unit: '%', text: '0%' };
      }
      return {
        domain: 'light',
        service: 'turn_on',
        data: { brightness_pct: value },
        value: value,
        unit: '%',
        text: value + '%'
      };
    }

    if (domain === 'cover') {
      const current = Number(attrs.current_position);
      if (!isFinite(current)) return null;
      const value = clamp(Math.round(current + amount), 0, 100);
      return {
        domain: 'cover',
        service: 'set_cover_position',
        data: { position: value },
        value: value,
        unit: '%',
        text: value + '%'
      };
    }

    if (domain === 'fan') {
      const current = Number(attrs.percentage);
      if (!isFinite(current)) return null;
      const stepSize = Number(attrs.percentage_step) || 1;
      const value = clamp(Math.round((current + amount) / stepSize) * stepSize, 0, 100);
      return {
        domain: 'fan',
        service: 'set_percentage',
        data: { percentage: value },
        value: value,
        unit: '%',
        text: value + '%'
      };
    }

    if (domain === 'media_player') {
      const current = Number(attrs.volume_level);
      if (!isFinite(current)) return null;
      const value = clamp(Math.round(current * 100 + amount), 0, 100);
      return {
        domain: 'media_player',
        service: 'volume_set',
        data: { volume_level: round2(value / 100) },
        value: value,
        unit: '%',
        text: value + '%'
      };
    }

    if (domain === 'number' || domain === 'input_number') {
      const current = Number(stateObj.state);
      if (!isFinite(current)) return null;
      const min = isFinite(Number(attrs.min)) ? Number(attrs.min) : -Infinity;
      const max = isFinite(Number(attrs.max)) ? Number(attrs.max) : Infinity;
      const value = clamp(round1(current + amount), min, max);
      return {
        domain: domain,
        service: 'set_value',
        data: { value: value },
        value: value,
        unit: attrs.unit_of_measurement || '',
        text: withUnit(formatNumber(value), attrs.unit_of_measurement)
      };
    }

    return null;
  }

  /** Domains a relative step makes sense for — the designer asks before offering it. */
  function isSteppable(entityId) {
    const domain = domainOf(entityId);
    return ['climate', 'light', 'cover', 'fan', 'media_player', 'number', 'input_number'].indexOf(domain) !== -1;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  /** One decimal: 21.5 + 0.5 must not become 22.000000000000004 on a key. */
  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  /** Big centred text for the key. */
  function valueText(entityId, stateObj, t) {
    const translate = t || ((key) => key);
    if (isUnavailable(stateObj)) return '--';

    const domain = domainOf(entityId);
    const state = String(stateObj.state).toLowerCase();
    const attrs = stateObj.attributes || {};

    if (domain === 'light') {
      if (state !== 'on') return translate('Off');
      if (typeof attrs.brightness === 'number') {
        return Math.round((attrs.brightness / 255) * 100) + '%';
      }
      return translate('On');
    }

    if (domain === 'cover') {
      if (typeof attrs.current_position === 'number') return attrs.current_position + '%';
      return translate(state === 'open' ? 'Open' : 'Closed');
    }

    if (domain === 'climate') {
      const target = attrs.temperature;
      const current = attrs.current_temperature;
      const value = typeof target === 'number' ? target : current;
      if (typeof value === 'number') return formatNumber(value) + '°';
      return translate(state === 'off' ? 'Off' : 'On');
    }

    if (domain === 'sensor' || domain === 'number' || domain === 'input_number') {
      const unit = attrs.unit_of_measurement || '';
      const numeric = Number(stateObj.state);
      const text = Number.isFinite(numeric) ? formatNumber(numeric) : stateObj.state;
      return withUnit(String(text), unit);
    }

    if (domain === 'media_player') {
      if (state === 'playing') return translate('Playing');
      if (state === 'paused') return translate('Paused');
      return translate(state === 'off' ? 'Off' : 'Idle');
    }

    if (domain === 'lock') return translate(state === 'locked' ? 'Locked' : 'Unlocked');
    if (domain === 'scene') return translate('Scene');
    if (domain === 'button' || domain === 'input_button') return translate('Press');

    if (state === 'on') return translate('On');
    if (state === 'off') return translate('Off');
    return stateObj.state;
  }

  /** 0..1 fill level for the bottom bar, or null. */
  function progressOf(entityId, stateObj) {
    if (isUnavailable(stateObj)) return null;
    const domain = domainOf(entityId);
    const attrs = stateObj.attributes || {};

    if (domain === 'light' && String(stateObj.state).toLowerCase() === 'on') {
      if (typeof attrs.brightness === 'number') return attrs.brightness / 255;
    }
    if (domain === 'cover' && typeof attrs.current_position === 'number') {
      return attrs.current_position / 100;
    }
    if (domain === 'fan' && typeof attrs.percentage === 'number') {
      return attrs.percentage / 100;
    }
    if (domain === 'media_player' && typeof attrs.volume_level === 'number') {
      return attrs.volume_level;
    }
    return null;
  }

  /** Accent colour; uses the light's own colour when it has one. */
  function accentColor(entityId, stateObj) {
    const domain = domainOf(entityId);
    if (domain === 'light' && stateObj && stateObj.attributes) {
      const rgb = stateObj.attributes.rgb_color;
      if (Array.isArray(rgb) && rgb.length === 3) {
        return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      }
    }
    return DOMAIN_ACCENTS[domain] || DEFAULT_ACCENT;
  }

  function formatNumber(value) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  /** Appends a unit, tight for % and degrees, spaced otherwise. */
  function withUnit(text, unit) {
    if (!unit) return text;
    if (unit === '%' || unit.charAt(0) === '°') return text + unit;
    return text + ' ' + unit;
  }

  global.HaDomains = {
    isUnavailable: isUnavailable,
    isActive: isActive,
    domainOf: domainOf,
    pressService: pressService,
    stepPlan: stepPlan,
    isSteppable: isSteppable,
    valueText: valueText,
    progressOf: progressOf,
    accentColor: accentColor
  };
})(window);
