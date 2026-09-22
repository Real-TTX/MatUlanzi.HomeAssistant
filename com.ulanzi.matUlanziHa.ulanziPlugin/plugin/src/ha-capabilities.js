/**
 * What a device can actually do — not what its domain could do in principle.
 *
 * A SONOFF relay flashed as a light is still a light: same domain, same
 * services, and until you look closer it gets a brightness slider it will
 * silently ignore. A roller shutter gets an On/Off pair that means nothing to
 * anyone who owns one. Home Assistant says all of this plainly in two
 * attributes — `supported_features` as a bitmask and `supported_color_modes`
 * as a list — so every control and every ready-made action asks here first.
 *
 * When an entity reports nothing at all we say yes. A missing attribute means
 * an integration that never filled it in, and hiding a control that does work
 * is worse than showing one that might not.
 */
(function (global) {
  'use strict';

  // The bits are Home Assistant's own, one set per domain. They are copied
  // rather than derived because there is nothing here to derive them from.
  const COVER = { open: 1, close: 2, position: 4, stop: 8, open_tilt: 16, close_tilt: 32, stop_tilt: 64, tilt_position: 128 };
  const CLIMATE = { temperature: 1, temperature_range: 2, humidity: 4, fan_mode: 8, preset_mode: 16, swing_mode: 32, aux_heat: 64, turn_off: 128, turn_on: 256 };
  const MEDIA = { pause: 1, seek: 2, volume: 4, mute: 8, previous: 16, next: 32, turn_on: 128, turn_off: 256, volume_step: 1024, source: 2048, stop: 4096, play: 16384, shuffle: 32768, sound_mode: 65536, repeat: 262144 };
  const FAN = { speed: 1, oscillate: 2, direction: 4, preset_mode: 8, turn_off: 16, turn_on: 32 };
  const VACUUM = { turn_on: 1, turn_off: 2, pause: 4, stop: 8, return_home: 16, fan_speed: 32, locate: 512, start: 8192 };
  const LOCK = { open: 1 };
  const HUMIDIFIER = { modes: 1 };
  const WATER_HEATER = { temperature: 1, operation_mode: 2, away_mode: 4 };

  const BITS = {
    cover: COVER,
    climate: CLIMATE,
    media_player: MEDIA,
    fan: FAN,
    vacuum: VACUUM,
    lock: LOCK,
    humidifier: HUMIDIFIER,
    water_heater: WATER_HEATER
  };

  /**
   * The same bits again, this time under the names Home Assistant uses when it
   * writes them into a service description: "light.LightEntityFeature.EFFECT".
   * Only the tail is kept, because that is the part that means something.
   */
  const BY_NAME = {
    light: { EFFECT: 4, FLASH: 8, TRANSITION: 32 },
    cover: { OPEN: 1, CLOSE: 2, SET_POSITION: 4, STOP: 8, OPEN_TILT: 16, CLOSE_TILT: 32, STOP_TILT: 64, SET_TILT_POSITION: 128 },
    climate: { TARGET_TEMPERATURE: 1, TARGET_TEMPERATURE_RANGE: 2, TARGET_HUMIDITY: 4, FAN_MODE: 8, PRESET_MODE: 16, SWING_MODE: 32, AUX_HEAT: 64, TURN_OFF: 128, TURN_ON: 256 },
    media_player: { PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8, PREVIOUS_TRACK: 16, NEXT_TRACK: 32, TURN_ON: 128, TURN_OFF: 256, PLAY_MEDIA: 512, VOLUME_STEP: 1024, SELECT_SOURCE: 2048, STOP: 4096, PLAY: 16384, SHUFFLE_SET: 32768, SELECT_SOUND_MODE: 65536, REPEAT_SET: 262144 },
    fan: { SET_SPEED: 1, OSCILLATE: 2, DIRECTION: 4, PRESET_MODE: 8, TURN_OFF: 16, TURN_ON: 32 },
    vacuum: { TURN_ON: 1, TURN_OFF: 2, PAUSE: 4, STOP: 8, RETURN_HOME: 16, FAN_SPEED: 32, LOCATE: 512, START: 8192 },
    water_heater: { TARGET_TEMPERATURE: 1, OPERATION_MODE: 2, AWAY_MODE: 4 }
  };

  /**
   * Whether an entity has the feature a service description asks for.
   *
   * Home Assistant names it either way round depending on its age: older
   * installations send the bare number 32, newer ones the enum path
   * "light.LightEntityFeature.TRANSITION". Both mean the same bit.
   *
   * Unknown names pass: a release that adds a feature should not make fields
   * disappear here.
   */
  function hasNamedFeature(domain, state, name) {
    const mask = Number(((state && state.attributes) || {}).supported_features);
    if (!isFinite(mask)) return true;

    const zahl = Number(name);
    if (isFinite(zahl) && zahl > 0) return (mask & zahl) !== 0;

    const table = BY_NAME[domain];
    const kurz = String(name || '').split('.').pop().toUpperCase();
    if (!table || !(kurz in table)) return true;
    return (mask & table[kurz]) !== 0;
  }

  /** Colour modes that carry a brightness value with them. */
  const DIMMABLE = ['brightness', 'color_temp', 'hs', 'rgb', 'rgbw', 'rgbww', 'white', 'xy'];
  /** Colour modes that carry an actual colour. */
  const COLOURED = ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'];

  function domainOf(entityId) {
    return String(entityId || '').split('.')[0];
  }

  function attributesOf(state) {
    return (state && state.attributes) || {};
  }

  /** Whether a named feature bit is set for this domain. */
  function hasBit(domain, attrs, name) {
    const table = BITS[domain];
    if (!table || !(name in table)) return false;
    const mask = Number(attrs.supported_features);
    if (!isFinite(mask)) return true;
    return (mask & table[name]) !== 0;
  }

  function colourModes(attrs) {
    const list = attrs.supported_color_modes;
    return Array.isArray(list) ? list.map((mode) => String(mode)) : null;
  }

  function anyMode(modes, wanted) {
    if (!modes) return true;
    return modes.some((mode) => wanted.indexOf(mode) !== -1);
  }

  /**
   * Can this entity do `what`? Unknown names answer no, so a typo hides a
   * control rather than quietly letting everything through.
   */
  function can(entityId, state, what) {
    const domain = domainOf(entityId);
    const attrs = attributesOf(state);

    if (what === 'brightness') {
      if (domain !== 'light') return false;
      return anyMode(colourModes(attrs), DIMMABLE);
    }
    if (what === 'colour') {
      if (domain !== 'light') return false;
      const modes = colourModes(attrs);
      // Without the list, the light's own colour attribute still gives it away.
      if (!modes) return Array.isArray(attrs.rgb_color) || Array.isArray(attrs.hs_color);
      return anyMode(modes, COLOURED);
    }
    if (what === 'kelvin') {
      if (domain !== 'light') return false;
      const modes = colourModes(attrs);
      if (!modes) return typeof attrs.color_temp_kelvin === 'number' || typeof attrs.max_mireds === 'number';
      return modes.indexOf('color_temp') !== -1;
    }

    if (what === 'on_off') {
      // A shutter has no "on". It opens and closes, and saying otherwise is
      // the single most confusing thing a cover control can do.
      if (domain === 'cover') return false;
      if (domain === 'climate' || domain === 'media_player') {
        return hasBit(domain, attrs, 'turn_on') || hasBit(domain, attrs, 'turn_off');
      }
      return ['light', 'switch', 'fan', 'input_boolean', 'humidifier', 'siren', 'automation', 'script', 'remote', 'water_heater'].indexOf(domain) !== -1;
    }

    if (what === 'open_close') return domain === 'cover' && (hasBit(domain, attrs, 'open') || hasBit(domain, attrs, 'close'));
    if (what === 'position') return domain === 'cover' && hasBit(domain, attrs, 'position');
    if (what === 'stop') return domain === 'cover' && hasBit(domain, attrs, 'stop');
    // Two different things: a slat you can aim, and slats you can only tip.
    if (what === 'tilt') return domain === 'cover' && hasBit(domain, attrs, 'tilt_position');
    if (what === 'tilt_move') {
      if (domain !== 'cover') return false;
      return hasBit(domain, attrs, 'open_tilt') || hasBit(domain, attrs, 'close_tilt') || hasBit(domain, attrs, 'stop_tilt');
    }

    if (what === 'temperature') {
      if (domain === 'water_heater') return hasBit(domain, attrs, 'temperature');
      return domain === 'climate' && hasBit(domain, attrs, 'temperature');
    }
    if (what === 'hvac_mode') return domain === 'climate' && (attrs.hvac_modes || []).length > 0;
    if (what === 'fan_mode') return domain === 'climate' && hasBit(domain, attrs, 'fan_mode') && (attrs.fan_modes || []).length > 1;
    if (what === 'swing_mode') return domain === 'climate' && hasBit(domain, attrs, 'swing_mode') && (attrs.swing_modes || []).length > 1;
    if (what === 'preset_mode') {
      if (domain !== 'climate' && domain !== 'fan') return false;
      return hasBit(domain, attrs, 'preset_mode') && (attrs.preset_modes || []).length > 1;
    }
    if (what === 'humidity') return domain === 'climate' && hasBit(domain, attrs, 'humidity');

    if (what === 'volume') return domain === 'media_player' && hasBit(domain, attrs, 'volume');
    if (what === 'mute') return domain === 'media_player' && hasBit(domain, attrs, 'mute');
    if (what === 'play_pause') return domain === 'media_player' && (hasBit(domain, attrs, 'play') || hasBit(domain, attrs, 'pause'));
    if (what === 'track') return domain === 'media_player' && (hasBit(domain, attrs, 'next') || hasBit(domain, attrs, 'previous'));
    if (what === 'source') return domain === 'media_player' && hasBit(domain, attrs, 'source') && (attrs.source_list || []).length > 0;

    if (what === 'speed') return domain === 'fan' && hasBit(domain, attrs, 'speed');
    if (what === 'oscillate') return domain === 'fan' && hasBit(domain, attrs, 'oscillate');

    return false;
  }

  const NAMES = [
    'on_off', 'brightness', 'colour', 'kelvin',
    'open_close', 'position', 'stop', 'tilt', 'tilt_move',
    'temperature', 'hvac_mode', 'fan_mode', 'swing_mode', 'preset_mode', 'humidity',
    'volume', 'mute', 'play_pause', 'track', 'source',
    'speed', 'oscillate'
  ];

  /** Everything at once, for a caller that wants to branch a few times. */
  function of(entityId, state) {
    const ergebnis = {};
    for (const name of NAMES) ergebnis[name] = can(entityId, state, name);
    return ergebnis;
  }

  global.HaCapabilities = {
    can: can,
    hasNamedFeature: hasNamedFeature,
    of: of,
    names: NAMES,
    domainOf: domainOf
  };
})(window);
