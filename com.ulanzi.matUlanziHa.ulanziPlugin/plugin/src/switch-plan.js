/**
 * What to send to switch one entity on or off.
 *
 * A plain `toggle` cannot carry parameters, so as soon as a button says *how*
 * it wants a device switched on — colour, brightness, a transition — the call
 * has to become an explicit `turn_on` in the entity's own domain. That is the
 * whole job of this module, and it stays free of side effects so the tricky
 * part is testable.
 */
(function (global) {
  'use strict';

  /** Domains whose "on" is not called turn_on. */
  const ON_SERVICE = {
    cover: 'open_cover',
    lock: 'lock'
  };
  const OFF_SERVICE = {
    cover: 'close_cover',
    lock: 'unlock'
  };

  /** Domains that have no on/off at all — data is still allowed. */
  const FIRE_AND_FORGET = {
    scene: 'turn_on',
    script: 'turn_on',
    button: 'press',
    input_button: 'press',
    automation: 'trigger'
  };

  function domainOf(entityId) {
    return String(entityId || '').split('.')[0];
  }

  /**
   * @param {string} json the data a button carries, as typed by the user
   * @returns {{data: object}|{error: string}} never throws
   */
  function parseData(json) {
    const raw = String(json === undefined || json === null ? '' : json).trim();
    if (!raw) return { data: null };
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { error: 'not an object' };
      }
      return { data: value };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * The call that switches `entityId` on or off, honouring the extra data.
   *
   * @param {string} entityId
   * @param {boolean} wantOn
   * @param {string} json extra data for this direction, '' for none
   * @returns {{domain,service,data}|null} null when nothing extra was asked for,
   *          which lets the caller keep its plain toggle.
   */
  function switchPlan(entityId, wantOn, json) {
    const parsed = parseData(json);
    if (parsed.error || !parsed.data) return null;

    const domain = domainOf(entityId);
    if (!domain) return null;

    if (FIRE_AND_FORGET[domain]) {
      return { domain: domain, service: FIRE_AND_FORGET[domain], data: parsed.data };
    }

    const service = wantOn
      ? ON_SERVICE[domain] || 'turn_on'
      : OFF_SERVICE[domain] || 'turn_off';

    return { domain: domain, service: service, data: parsed.data };
  }

  /**
   * The data a button uses for one entity: its own override wins over the
   * button-wide default, so three lamps can share one colour or each get its own.
   */
  function dataFor(def, entityId, wantOn) {
    const perEntity = (def && def.entityActions && def.entityActions[entityId]) || null;
    const own = perEntity ? (wantOn ? perEntity.on : perEntity.off) : '';
    if (String(own || '').trim()) return own;
    return (def && (wantOn ? def.onData : def.offData)) || '';
  }

  /** True when this button asks for anything beyond a plain toggle. */
  function hasExtras(def) {
    if (!def) return false;
    if (String(def.onData || '').trim() || String(def.offData || '').trim()) return true;
    const perEntity = def.entityActions || {};
    return Object.keys(perEntity).some((id) => {
      const entry = perEntity[id] || {};
      return String(entry.on || '').trim() || String(entry.off || '').trim();
    });
  }

  global.SwitchPlan = {
    switchPlan: switchPlan,
    parseData: parseData,
    dataFor: dataFor,
    hasExtras: hasExtras
  };
})(window);
