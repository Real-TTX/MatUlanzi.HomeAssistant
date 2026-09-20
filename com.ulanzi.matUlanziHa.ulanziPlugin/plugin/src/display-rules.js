/**
 * What a key shows, as a list of rules instead of a fixed on/off pair.
 *
 * "Icon when on, icon when off" cannot say "red below 20 % battery" or "the
 * flame while it heats". A rule can: it names what it looks at, how to compare,
 * and what the key should look like when it matches. The first match wins, and
 * anything unmatched falls through to the button's own style.
 *
 * Free of the DOM and of Home Assistant, because getting a comparison subtly
 * wrong here shows the wrong thing on a key for weeks without anyone noticing.
 */
(function (global) {
  'use strict';

  /** Which entities a rule looks at. */
  const SCOPE = { any: 'any', all: 'all' };

  const OPERATORS = ['=', '!=', '<', '>', '<=', '>='];

  function isUnavailable(state) {
    const wert = String(state === undefined || state === null ? '' : state).toLowerCase();
    return ['unavailable', 'unknown', 'none', ''].indexOf(wert) !== -1;
  }

  /**
   * The value a rule is about: the state itself, or one attribute.
   * @param {object} entity {entityId, state, attributes}
   * @param {string} what 'state' or 'attr:<name>'
   */
  function valueOf(entity, what) {
    if (!entity) return undefined;
    const feld = String(what || 'state');
    if (feld.indexOf('attr:') === 0) {
      const attrs = entity.attributes || {};
      return attrs[feld.slice(5)];
    }
    return entity.state;
  }

  /**
   * Compares as numbers when both sides look numeric, as text otherwise — so
   * `< 20` works on a battery level and `= heat` works on a mode.
   */
  function compare(links, op, rechts) {
    if (op === 'unavailable') return isUnavailable(links);
    if (links === undefined || links === null) return false;

    const a = Number(links);
    const b = Number(rechts);
    const numerisch = !isNaN(a) && !isNaN(b) && String(links).trim() !== '';

    if (numerisch) {
      switch (op) {
        case '=': return a === b;
        case '!=': return a !== b;
        case '<': return a < b;
        case '>': return a > b;
        case '<=': return a <= b;
        case '>=': return a >= b;
        default: return false;
      }
    }

    const x = String(links).toLowerCase();
    const y = String(rechts === undefined || rechts === null ? '' : rechts).toLowerCase();
    switch (op) {
      case '=': return x === y;
      case '!=': return x !== y;
      case '<': return x < y;
      case '>': return x > y;
      case '<=': return x <= y;
      case '>=': return x >= y;
      default: return false;
    }
  }

  /** True when the rule holds for the entities it is about. */
  function matches(rule, entities) {
    const liste = entities || [];
    if (!liste.length) return false;

    const bereich = rule.scope || SCOPE.any;
    const betroffen =
      bereich === SCOPE.any || bereich === SCOPE.all
        ? liste
        : liste.filter((entity) => entity.entityId === bereich);

    if (!betroffen.length) return false;

    const treffer = betroffen.filter((entity) =>
      compare(valueOf(entity, rule.what), rule.op || '=', rule.value)
    );

    if (bereich === SCOPE.all) return treffer.length === betroffen.length;
    return treffer.length > 0;
  }

  /**
   * The look a set of entities should get: the first rule that holds, or null
   * when none does and the button's own style applies unchanged.
   *
   * @param {Array} rules
   * @param {Array} entities [{entityId, state, attributes}]
   * @returns {{icon,bg,text,label}|null}
   */
  function evaluate(rules, entities) {
    for (const rule of rules || []) {
      if (!rule || rule.disabled) continue;
      if (!matches(rule, entities)) continue;
      return {
        icon: rule.icon || '',
        bg: rule.bg || '',
        text: rule.text || '',
        top: rule.top || '',
        center: rule.center || '',
        bottom: rule.bottom || '',
        id: rule.id || ''
      };
    }
    return null;
  }

  /** Folds a rule result into a style, leaving anything it does not mention. */
  function applyTo(style, hit) {
    if (!hit) return style;
    const neu = Object.assign({}, style || {});
    // A rule speaks for both directions: it already knows the state it matched.
    if (hit.icon) {
      neu.icon_on = hit.icon;
      neu.icon_off = hit.icon;
    }
    if (hit.bg) {
      neu.bg_on = hit.bg;
      neu.bg_off = hit.bg;
    }
    if (hit.text) {
      neu.text_on = hit.text;
      neu.text_off = hit.text;
    }

    // The three lines belong to the rule too: "which text" is part of "how it
    // looks", and splitting them across two places was the old mistake.
    for (const zeile of ['top', 'center', 'bottom']) {
      if (hit[zeile]) neu[zeile] = hit[zeile];
    }
    return neu;
  }

  /**
   * Sensible rules for an entity, so dropping one on a key needs no setup and
   * "customise" has something to start from rather than an empty table.
   */
  function suggest(entityId) {
    const domain = String(entityId || '').split('.')[0];

    const anAus = (an, aus) => [
      { scope: SCOPE.any, what: 'state', op: '=', value: 'on', icon: an, bg: '' },
      { scope: SCOPE.all, what: 'state', op: '=', value: 'off', icon: aus, bg: '' }
    ];

    if (domain === 'light') return anAus('mdi:lightbulb', 'mdi:lightbulb-outline');
    if (domain === 'switch') return anAus('mdi:toggle-switch', 'mdi:toggle-switch-off');
    if (domain === 'fan') return anAus('mdi:fan', 'mdi:fan-off');
    if (domain === 'media_player') {
      return [
        { scope: SCOPE.any, what: 'state', op: '=', value: 'playing', icon: 'mdi:play', bg: '' },
        { scope: SCOPE.any, what: 'state', op: '=', value: 'paused', icon: 'mdi:pause', bg: '' },
        { scope: SCOPE.all, what: 'state', op: '=', value: 'off', icon: 'mdi:speaker-off', bg: '' }
      ];
    }
    if (domain === 'cover') {
      return [
        { scope: SCOPE.all, what: 'state', op: '=', value: 'closed', icon: 'mdi:window-shutter', bg: '' },
        { scope: SCOPE.any, what: 'state', op: '=', value: 'open', icon: 'mdi:window-shutter-open', bg: '' }
      ];
    }
    if (domain === 'climate') {
      return [
        { scope: SCOPE.any, what: 'state', op: '=', value: 'heat', icon: 'mdi:fire', bg: '' },
        { scope: SCOPE.any, what: 'state', op: '=', value: 'cool', icon: 'mdi:snowflake', bg: '' },
        { scope: SCOPE.all, what: 'state', op: '=', value: 'off', icon: 'mdi:power', bg: '' }
      ];
    }
    if (domain === 'lock') return anAus('mdi:lock-open-variant', 'mdi:lock');
    if (domain === 'binary_sensor') return anAus('mdi:checkbox-marked-circle', 'mdi:circle-outline');

    return [];
  }

  global.DisplayRules = {
    evaluate: evaluate,
    applyTo: applyTo,
    matches: matches,
    compare: compare,
    valueOf: valueOf,
    suggest: suggest,
    SCOPE: SCOPE,
    OPERATORS: OPERATORS
  };
})(window);
