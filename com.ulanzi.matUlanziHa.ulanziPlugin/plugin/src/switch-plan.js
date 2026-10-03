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

  /**
   * The call one direction of a switching action makes.
   *
   * A plain toggle cannot carry parameters, so a button that wants its shutter
   * to stop at 30 percent on the way down has to name a service per direction.
   * A direction left empty is not an error and not silence - it means "switch
   * it the ordinary way", so one side can be special and the other plain.
   *
   * @returns {{domain,service,data}|{error,domain,service}|null}
   */
  function directionPlan(action, wantOn) {
    if (!action) return null;
    const domain = (wantOn ? action.onDomain : action.offDomain) || '';
    const service = (wantOn ? action.onService : action.offService) || '';
    if (!domain || !service) return null;

    const parsed = parseData(wantOn ? action.onData : action.offData);
    if (parsed.error) return { error: parsed.error, domain: domain, service: service };
    return { domain: domain, service: service, data: parsed.data || {} };
  }

  /**
   * The ordinary way to switch one entity in a given direction.
   *
   * Not every domain has turn_on: a cover opens and closes, a lock locks and
   * unlocks. Asking for `cover.turn_on` gets a service that does not exist and
   * a key that silently does nothing.
   */
  function plainService(entityId, wantOn) {
    const domain = domainOf(entityId);
    if (!domain) return { domain: 'homeassistant', service: wantOn ? 'turn_on' : 'turn_off' };
    if (FIRE_AND_FORGET[domain]) return { domain: domain, service: FIRE_AND_FORGET[domain] };
    return {
      domain: domain,
      service: wantOn ? ON_SERVICE[domain] || 'turn_on' : OFF_SERVICE[domain] || 'turn_off'
    };
  }

  /** Percent values a direction can aim at, and where the entity reports them. */
  const AIMED = {
    position: function (attrs) { return attrs.current_position; },
    tilt_position: function (attrs) { return attrs.current_tilt_position; },
    brightness_pct: function (attrs) {
      return typeof attrs.brightness === 'number' ? Math.round((attrs.brightness / 255) * 100) : undefined;
    }
  };

  /** Slats and dimmers never land exactly; a couple of percent is the same place. */
  const TOLERANCE = 2;

  /**
   * Whether the button should treat this entity as "on" right now.
   *
   * A direction that does not actually switch the thing off cannot be told
   * apart by the usual on/off test. A shutter parked at 30 percent still
   * reports "open", so a key whose AUS means 30 percent would send 30 forever
   * and never open again - the second press does nothing and the button is
   * stuck one way round.
   *
   * When the off direction aims at a value the entity also reports, that value
   * decides instead: at or below it, the button has done its "off" already.
   *
   * @param {boolean} sonst what the ordinary state test said
   */
  function toggleIsOn(state, action, sonst) {
    const plan = directionPlan(action, false);
    if (!plan || plan.error || !plan.data) return sonst;

    const attrs = (state && state.attributes) || {};
    for (const key of Object.keys(AIMED)) {
      const ziel = Number(plan.data[key]);
      if (!isFinite(ziel)) continue;
      const ist = Number(AIMED[key](attrs));
      if (!isFinite(ist)) continue;
      return ist > ziel + TOLERANCE;
    }
    return sonst;
  }

  global.SwitchPlan = {
    switchPlan: switchPlan,
    directionPlan: directionPlan,
    plainService: plainService,
    toggleIsOn: toggleIsOn,
    parseData: parseData,
    dataFor: dataFor,
    hasExtras: hasExtras
  };
})(window);
