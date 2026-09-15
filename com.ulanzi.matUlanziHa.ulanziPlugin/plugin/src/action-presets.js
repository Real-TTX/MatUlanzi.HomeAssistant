/**
 * Ready-made actions with real input fields instead of hand-written JSON.
 *
 * The catalogue exists because the obvious wishes — colour, brightness,
 * temperature, volume, position — are not all reachable the same way: a light
 * takes colour and brightness straight in `turn_on`, while a thermostat needs
 * `set_temperature`, a speaker `volume_set` and a cover `set_cover_position`.
 * Each preset therefore carries its own domain and service plus the fields it
 * accepts. The JSON stays visible and editable underneath; this only builds it.
 */
(function (global) {
  'use strict';

  const PRESETS = [
    {
      id: 'light_on',
      label: 'Switch light on',
      domains: ['light'],
      domain: 'light',
      service: 'turn_on',
      fields: [
        { key: 'brightness_pct', label: 'Brightness', type: 'percent' },
        { key: 'rgb_color', label: 'Colour', type: 'color' },
        { key: 'color_temp_kelvin', label: 'Colour temperature', type: 'number', min: 2000, max: 6500, step: 100, unit: 'K' },
        { key: 'transition', label: 'Transition', type: 'number', min: 0, max: 30, step: 1, unit: 's' }
      ]
    },
    {
      id: 'light_off',
      label: 'Switch light off',
      domains: ['light'],
      domain: 'light',
      service: 'turn_off',
      fields: [{ key: 'transition', label: 'Transition', type: 'number', min: 0, max: 30, step: 1, unit: 's' }]
    },
    {
      id: 'climate_temperature',
      label: 'Set target temperature',
      domains: ['climate'],
      domain: 'climate',
      service: 'set_temperature',
      fields: [{ key: 'temperature', label: 'Target temperature', type: 'number', min: 5, max: 35, step: 0.5, unit: '\u00b0' }]
    },
    {
      id: 'climate_mode',
      label: 'Set mode',
      domains: ['climate'],
      domain: 'climate',
      service: 'set_hvac_mode',
      fields: [{ key: 'hvac_mode', label: 'Mode', type: 'select', options: ['off', 'heat', 'cool', 'auto', 'dry', 'fan_only'] }]
    },
    {
      id: 'media_volume',
      label: 'Set volume',
      domains: ['media_player'],
      domain: 'media_player',
      service: 'volume_set',
      // Home Assistant wants 0..1 here, a classic way to send 100x too much by
      // accident — so the field is a percentage and converts on the way out.
      fields: [{ key: 'volume_level', label: 'Volume', type: 'fraction' }]
    },
    {
      id: 'media_play_pause',
      label: 'Play / pause',
      domains: ['media_player'],
      domain: 'media_player',
      service: 'media_play_pause',
      fields: []
    },
    {
      id: 'cover_position',
      label: 'Set position',
      domains: ['cover'],
      domain: 'cover',
      service: 'set_cover_position',
      fields: [{ key: 'position', label: 'Position', type: 'percent' }]
    },
    {
      id: 'fan_speed',
      label: 'Set speed',
      domains: ['fan'],
      domain: 'fan',
      service: 'set_percentage',
      fields: [{ key: 'percentage', label: 'Speed', type: 'percent' }]
    },
    {
      id: 'number_value',
      label: 'Set value',
      domains: ['number', 'input_number'],
      domain: 'number',
      service: 'set_value',
      fields: [{ key: 'value', label: 'Value', type: 'number', step: 0.1 }]
    },
    {
      id: 'scene_on',
      label: 'Activate scene',
      domains: ['scene'],
      domain: 'scene',
      service: 'turn_on',
      fields: [{ key: 'transition', label: 'Transition', type: 'number', min: 0, max: 30, step: 1, unit: 's' }]
    },
    {
      id: 'notify',
      label: 'Send a notification',
      domains: [],
      domain: 'notify',
      service: 'persistent_notification',
      fields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'message', label: 'Message', type: 'text' }
      ]
    }
  ];

  function domainOf(entityId) {
    return String(entityId || '').split('.')[0];
  }

  function byId(id) {
    return PRESETS.filter((preset) => preset.id === id)[0] || null;
  }

  /**
   * Presets that fit the entity, most specific first. Presets without domains
   * (a notification) fit everything, so they come last.
   */
  function forEntity(entityId) {
    const domain = domainOf(entityId);
    const passend = PRESETS.filter((preset) => preset.domains.indexOf(domain) !== -1);
    const allgemein = PRESETS.filter((preset) => preset.domains.length === 0);
    return passend.concat(allgemein);
  }

  function hexToRgb(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!match) return null;
    const value = parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function rgbToHex(rgb) {
    if (!Array.isArray(rgb) || rgb.length < 3) return '';
    const teil = (n) => {
      const begrenzt = Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
      return (begrenzt < 16 ? '0' : '') + begrenzt.toString(16);
    };
    return '#' + teil(rgb[0]) + teil(rgb[1]) + teil(rgb[2]);
  }

  /**
   * Turns what the user typed into service data. Empty fields are left out
   * entirely: Home Assistant treats a missing key and a null very differently.
   */
  function buildData(preset, values) {
    const data = {};
    if (!preset) return data;
    for (const field of preset.fields) {
      const raw = values ? values[field.key] : undefined;
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;

      if (field.type === 'color') {
        const rgb = hexToRgb(raw);
        if (rgb) data[field.key] = rgb;
        continue;
      }
      if (field.type === 'fraction') {
        const prozent = Number(raw);
        if (!isNaN(prozent)) data[field.key] = Math.round(prozent) / 100;
        continue;
      }
      if (field.type === 'percent' || field.type === 'number') {
        const zahl = Number(raw);
        if (!isNaN(zahl)) data[field.key] = zahl;
        continue;
      }
      data[field.key] = String(raw);
    }
    return data;
  }

  /** The other direction, so opening a saved button shows its values again. */
  function readValues(preset, data) {
    const values = {};
    if (!preset || !data) return values;
    for (const field of preset.fields) {
      const raw = data[field.key];
      if (raw === undefined || raw === null) continue;

      if (field.type === 'color') {
        values[field.key] = rgbToHex(raw);
        continue;
      }
      if (field.type === 'fraction') {
        values[field.key] = Math.round(Number(raw) * 100);
        continue;
      }
      values[field.key] = raw;
    }
    return values;
  }

  /** Which preset a saved domain/service pair came from, if any. */
  function match(domain, service) {
    return PRESETS.filter((preset) => preset.domain === domain && preset.service === service)[0] || null;
  }

  global.ActionPresets = {
    all: PRESETS,
    byId: byId,
    forEntity: forEntity,
    buildData: buildData,
    readValues: readValues,
    match: match,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex
  };
})(window);
