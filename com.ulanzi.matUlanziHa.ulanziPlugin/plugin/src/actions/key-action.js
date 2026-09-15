/**
 * One instance per key on the deck.
 *
 * The key stores only a reference to a library button; what it shows and does
 * comes from that definition, resolved fresh on every render so designer edits
 * appear immediately.
 *
 * A button drives one entity or a group. For groups, `group_rule` decides what
 * wins when members disagree: `any_on` (one member on -> key on) or `all_on`
 * (every member must be on).
 */
(function (global) {
  'use strict';

  const RENDER_DEBOUNCE_MS = 100;
  const LONG_PRESS_MS = 600;
  const MIN_REFRESH_MS = 5000;

  class KeyAction {
    /**
     * @param {object} deps {context, ud, pool, library, renderer, i18n, log}
     */
    constructor(deps) {
      this.context = deps.context;
      this.$UD = deps.ud;
      this.pool = deps.pool;
      this.getLibrary = deps.library;
      this.renderer = deps.renderer;
      this.i18n = deps.i18n;
      // Shared by every key: the device a context key currently follows.
      this.targets = deps.targets || null;
      this._log = deps.log || function () {};

      this.settings = {};
      this.active = true;
      this.busy = false;
      this._renderTimer = null;
      this._rendering = false;
      this._dirty = false;
      this._lastImage = '';
      this._refreshTimer = null;
      this._refreshMs = 0;
    }

    /** Called for `add`, `paramfromapp` and `paramfromplugin`. */
    setSettings(param) {
      this.settings = param || {};
      this._lastImage = ''; // definition may have changed entirely
      this.scheduleRender();
    }

    /**
     * Redraw and re-send even if the image would be byte-identical.
     * Used after a library reload, where the definition changed underneath us.
     */
    forceRepaint() {
      this._lastImage = '';
      this.scheduleRender();
    }

    setActive(active) {
      const wasActive = this.active;
      this.active = Boolean(active);
      if (this.active && !wasActive) {
        this._lastImage = ''; // the deck may have dropped our image
        this.render();
      }
    }

    /** The library button (or legacy inline settings) behind this key. */
    definition() {
      return this.getLibrary().resolveKey(this.settings);
    }

    /** The pool entry serving this key. */
    connection(definition) {
      const def = definition || this.definition();
      return this.pool.get(def ? def.connection : '');
    }

    /** True when this key cares about the given change. */
    watches(connectionId, entityId) {
      const def = this.definition();
      if (!def) return false;

      // A context key has no entity of its own, so it watches whatever it
      // currently follows.
      if (def.targetMode === 'context') {
        const target = this.effectiveTarget(def);
        if (!target || target.entityId !== entityId) return false;
        const entry = this.targetConnection(target, def);
        return Boolean(entry) && entry.id === connectionId;
      }

      if (def.entityIds.indexOf(entityId) === -1) return false;
      const entry = this.connection(def);
      return Boolean(entry) && entry.id === connectionId;
    }

    // --- group state ----------------------------------------------------------

    /**
     * Folds the members into the single state a key can show.
     * @returns {{active: boolean, onCount: number, offCount: number,
     *            total: number, available: number, unavailable: boolean}}
     */
    aggregate(definition, entry) {
      const def = definition || this.definition();
      const domains = global.HaDomains;
      const ids = def ? def.entityIds : [];

      let available = 0;
      let onCount = 0;
      for (const entityId of ids) {
        const stateObj = entry ? entry.client.getState(entityId) : null;
        if (domains.isUnavailable(stateObj)) continue;
        available += 1;
        if (domains.isActive(entityId, stateObj)) onCount += 1;
      }

      const active =
        def && def.groupRule === global.GROUP_RULES.all_on
          ? available > 0 && onCount === available
          : onCount > 0;

      return {
        active: active,
        onCount: onCount,
        offCount: available - onCount,
        total: ids.length,
        available: available,
        unavailable: available === 0
      };
    }

    // --- input --------------------------------------------------------------

    async handlePress(pressDurationMs) {
      const def = this.definition();

      if (pressDurationMs > LONG_PRESS_MS) {
        this.handleLongPress(def);
        return;
      }

      // These run before the entity guard on purpose: a dashboard link, a
      // notify service and a context key all work without an entity of their own.
      if (def && def.type === 'open') {
        this.openInHomeAssistant(def);
        return;
      }
      if (def && def.type === 'service') {
        await this.callConfiguredService(def);
        return;
      }
      if (def && def.type === 'step') {
        await this.stepTarget(def);
        return;
      }
      if (def && def.targetMode === 'context') {
        await this.toggleContextTarget(def);
        return;
      }

      if (!def || !def.entityIds.length) {
        this.$UD.toast(this.i18n.t('No button'));
        return;
      }
      // Info keys are display-only; a press just tells you what they show.
      if (def.type === 'info') {
        this.identify(def);
        return;
      }

      const entry = this.connection(def);
      if (!entry || !entry.client.isOnline) {
        this.$UD.showAlert(this.context);
        this.$UD.toast(this.i18n.t('Offline'));
        return;
      }

      this.busy = true;
      this.render();

      try {
        if (def.entityIds.length === 1) {
          const entityId = def.entityIds[0];
          const call = global.HaDomains.pressService(entityId, entry.client.getState(entityId));
          await entry.client.callService(call.domain, call.service, call.data, {
            entity_id: entityId
          });
        } else {
          // One call for the whole group: homeassistant.* spans domains, and the
          // aggregate decides the direction so the group ends up uniform.
          const group = this.aggregate(def, entry);
          await entry.client.callService(
            'homeassistant',
            group.active ? 'turn_off' : 'turn_on',
            {},
            { entity_id: def.entityIds }
          );
        }
      } catch (err) {
        this._log('[key] ' + def.entityIds.join(',') + ' failed: ' + err.message);
        this.$UD.showAlert(this.context);
        this.$UD.toast(err.message);
      } finally {
        this.busy = false;
        this.render();
      }
    }

    /**
     * Sends the browser to Home Assistant. `openUrl` only works with a full
     * remote address — a local path opens nothing at all, measured.
     */
    openInHomeAssistant(def) {
      const entry = this.connection(def);
      const base = (entry && entry.url) || (entry && entry.client && entry.client.url) || '';
      const url = global.HaLinks.build(base, def.open);

      if (!url) {
        this.$UD.showAlert(this.context);
        this.$UD.toast(this.i18n.t('Nothing to open — check the button'));
        return;
      }
      this._log('[key] opening ' + url);
      this.$UD.openUrl(url, false, null);
    }

    /**
     * The entity this key acts on right now.
     *
     * A "context" key has no entity of its own: it follows whatever device was
     * last picked elsewhere, which is how one control page can serve every
     * thermostat instead of one page per device.
     *
     * @returns {{entityId:string, connectionId:string, name:string}|null}
     */
    effectiveTarget(definition) {
      const def = definition || this.definition();
      if (!def) return null;

      if (def.targetMode === 'context') {
        const target = this.targets ? this.targets.get() : null;
        if (!target) return null;
        return {
          entityId: target.entityId,
          connectionId: target.connectionId || def.connection,
          name: target.name || target.entityId
        };
      }

      if (!def.entityIds.length) return null;
      return { entityId: def.entityIds[0], connectionId: def.connection, name: def.name || '' };
    }

    /** Connection for a target, which may differ from the button's own. */
    targetConnection(target, definition) {
      const def = definition || this.definition();
      return this.pool.get(target && target.connectionId ? target.connectionId : def && def.connection);
    }

    /** Calls the service the button was configured with. */
    async callConfiguredService(def) {
      const spec = def.service || {};
      if (!spec.domain || !spec.name) {
        this.$UD.showAlert(this.context);
        this.$UD.toast(this.i18n.t('No service configured'));
        return;
      }

      let data = {};
      if (String(spec.data || '').trim()) {
        try {
          data = JSON.parse(spec.data);
        } catch (err) {
          // A typo in the JSON must say so instead of silently sending nothing.
          this.$UD.showAlert(this.context);
          this.$UD.toast(this.i18n.t('Service data is not valid JSON'));
          return;
        }
      }

      const target = this.effectiveTarget(def);
      const entry = this.targetConnection(target, def) || this.connection(def);
      if (!entry || !entry.client.isOnline) {
        this.$UD.showAlert(this.context);
        this.$UD.toast(this.i18n.t('Offline'));
        return;
      }

      // The entity is optional here: notify.* and script.* take none, while
      // climate.set_hvac_mode wants one. Whatever the key points at wins.
      const scope = target && target.entityId ? { entity_id: target.entityId } : null;

      await this._withBusy(async () => {
        await entry.client.callService(spec.domain, spec.name, data, scope);
      }, def);
    }

    /** Nudges the target up or down — the keypad stand-in for a rotary dial. */
    async stepTarget(def) {
      const target = this.effectiveTarget(def);
      if (!target) {
        this.$UD.showAlert(this.context);
        this.$UD.toast(this.i18n.t('No target — long-press a device first'));
        return;
      }

      const entry = this.targetConnection(target, def);
      if (!entry || !entry.client.isOnline) {
        this.$UD.showAlert(this.context);
        this.$UD.toast(this.i18n.t('Offline'));
        return;
      }

      const plan = global.HaDomains.stepPlan(
        target.entityId,
        entry.client.getState(target.entityId),
        def.stepAmount
      );
      if (!plan) {
        this.$UD.showAlert(this.context);
        this.$UD.toast(this.i18n.t('Cannot be adjusted'));
        return;
      }

      await this._withBusy(async () => {
        await entry.client.callService(plan.domain, plan.service, plan.data, {
          entity_id: target.entityId
        });
      }, def);
    }

    /** Remembers this key's entity as the target every context key follows. */
    rememberTarget(def) {
      const entityId = def.entityIds[0];
      if (!entityId || !this.targets) {
        this.$UD.toast(this.i18n.t('Nothing to remember'));
        return;
      }
      const entry = this.connection(def);
      const record = entry ? entry.registry.get(entityId) : null;
      this.targets.set(entityId, def.connection, def.label || def.name || (record && record.name) || entityId);
      this.$UD.toast(this.i18n.t('Target set'));
    }

    /** Shared busy/repaint/error handling for the service-calling paths. */
    async _withBusy(work, def) {
      this.busy = true;
      this.render();
      try {
        await work();
      } catch (err) {
        this._log('[key] ' + ((def && def.name) || this.context) + ' failed: ' + err.message);
        this.$UD.showAlert(this.context);
        this.$UD.toast(err.message);
      } finally {
        this.busy = false;
        this.render();
      }
    }

    /** What a long press does is configurable per button. */
    handleLongPress(def) {
      const what = (def && def.longPress) || 'identify';
      if (what === 'none') return;
      if (what === 'target') {
        this.rememberTarget(def);
        return;
      }
      if (what === 'open') {
        this.openInHomeAssistant(def);
        return;
      }
      this.identify(def);
    }

    /** A context key without its own entity still toggles what it follows. */
    async toggleContextTarget(def) {
      const target = this.effectiveTarget(def);
      if (!target) {
        this.$UD.showAlert(this.context);
        this.$UD.toast(this.i18n.t('No target — long-press a device first'));
        return;
      }
      const entry = this.targetConnection(target, def);
      if (!entry || !entry.client.isOnline) {
        this.$UD.showAlert(this.context);
        this.$UD.toast(this.i18n.t('Offline'));
        return;
      }
      const call = global.HaDomains.pressService(
        target.entityId,
        entry.client.getState(target.entityId)
      );
      await this._withBusy(async () => {
        await entry.client.callService(call.domain, call.service, call.data, {
          entity_id: target.entityId
        });
      }, def);
    }

    /** Long press: say out loud what sits on this key. */
    identify(definition) {
      const def = definition || this.definition();
      if (!def || !def.entityIds.length) {
        this.$UD.toast(this.i18n.t('No button'));
        return;
      }
      const entry = this.connection(def);

      if (def.entityIds.length > 1) {
        const group = this.aggregate(def, entry);
        this.$UD.toast(
          (def.name || '') +
            ' · ' +
            group.onCount +
            '/' +
            group.total +
            ' ' +
            this.i18n.t('On') +
            ' · ' +
            def.entityIds.join(', ')
        );
        return;
      }

      const entityId = def.entityIds[0];
      const record = entry ? entry.registry.get(entityId) : null;
      const stateObj = entry ? entry.client.getState(entityId) : null;

      const parts = [];
      if (this.pool.entries().length > 1 && entry) parts.push(entry.name || entry.id);
      if (record && record.areaName) parts.push(record.areaName);
      parts.push(record ? record.name : entityId);
      parts.push(entityId);
      if (stateObj) parts.push(stateObj.state);
      this.$UD.toast(parts.join(' · '));
    }

    // --- painting -----------------------------------------------------------

    scheduleRender() {
      if (this._renderTimer) return;
      this._renderTimer = global.setTimeout(() => {
        this._renderTimer = null;
        this.render();
      }, RENDER_DEBOUNCE_MS);
    }

    /** Rendering is async (icons, HTML mode), so overlapping calls coalesce. */
    async render() {
      if (!this.active) return;
      if (this._rendering) {
        this._dirty = true;
        return;
      }
      this._rendering = true;

      try {
        const def = this.definition();
        this._syncRefreshTimer(def);
        const image = await this.renderer.render(this.buildView(def), def ? def.style : null);
        if (image && image !== this._lastImage) {
          this._lastImage = image;
          this.$UD.setBaseDataIcon(this.context, image);

          // A record of what actually went to the host, so a key showing
          // something stale can be pinned on the sender or the host.
          if (global.KEY_PAINT_LOG) {
            global.KEY_PAINT_LOG.push({
              at: new Date().toISOString().slice(11, 19),
              key: String(this.context).split('___')[1] || '?',
              button: (def && def.name) || '-',
              bytes: image.length
            });
            if (global.KEY_PAINT_LOG.length > 40) global.KEY_PAINT_LOG.shift();
          }
        }
      } catch (err) {
        this._log('[key] render failed: ' + (err && err.message));
      } finally {
        this._rendering = false;
        if (this._dirty) {
          this._dirty = false;
          this.scheduleRender();
        }
      }
    }

    /**
     * Info keys can ask for a periodic redraw. States arrive pushed, so this is
     * not about freshness — it is what keeps `{{age}}` moving.
     */
    _syncRefreshTimer(definition) {
      const seconds = definition ? Number(definition.refreshInterval) || 0 : 0;
      const wanted = seconds > 0 ? Math.max(MIN_REFRESH_MS, seconds * 1000) : 0;
      if (wanted === this._refreshMs) return;

      this._refreshMs = wanted;
      if (this._refreshTimer) {
        global.clearInterval(this._refreshTimer);
        this._refreshTimer = null;
      }
      if (wanted) {
        this._refreshTimer = global.setInterval(() => this.scheduleRender(), wanted);
      }
    }

    /** Flags for the renderer plus the placeholder context for templates. */
    buildView(definition) {
      const t = (key) => this.i18n.t(key);
      const def = definition || this.definition();

      if (!def) {
        return { ctx: { name: t('No button'), value: '?' }, unavailable: true };
      }

      // An 'open' key pointing at a room or dashboard has no entity on purpose,
      // and a service key may target nothing at all (notify.*, script.*).
      if (!def.entityIds.length && (def.type === 'open' || def.type === 'service')) {
        return {
          ctx: { name: def.label || def.name || t('Open'), value: '' },
          unavailable: false
        };
      }

      // Context keys show what they follow — or say that they follow nothing.
      if (def.targetMode === 'context') {
        const target = this.effectiveTarget(def);
        if (!target) {
          return {
            ctx: { name: def.label || def.name || t('No target'), value: '—' },
            unavailable: true
          };
        }
        return this._viewFor(def, target.entityId, this.targetConnection(target, def), target.name);
      }

      // A button that exists but has no entity is a configuration mistake. Show
      // its name so it is obvious *which* button needs fixing.
      if (!def.entityIds.length) {
        return {
          ctx: { name: def.name || t('No entity'), value: '!' },
          unavailable: true
        };
      }

      return this._viewFor(def, def.entityIds[0], this.connection(def));
    }

    /**
     * Renders one entity, whether it is the button’s own or the device a
     * context key currently follows.
     */
    _viewFor(def, primary, entry, nameOverride) {
      const t = (key) => this.i18n.t(key);
      const domains = global.HaDomains;
      // A context key renders exactly the one device it follows, never a group.
      const isGroup = def.targetMode !== "context" && def.entityIds.length > 1;
      const record = entry ? entry.registry.get(primary) : null;
      const stateObj = entry ? entry.client.getState(primary) : null;
      const attributes = (stateObj && stateObj.attributes) || {};

      const showRoom =
        def.showRoom === undefined || def.showRoom === null ? true : String(def.showRoom) !== '0';

      const group = this.aggregate(def, entry);

      const ctx = {
        // The button name comes first: it is what the user deliberately typed in
        // the designer, and entity names are often useless on a key (a cover
        // called "Büro" in a room called "Büro").
        name:
          nameOverride ||
          def.label ||
          def.name ||
          (record && record.name) ||
          attributes.friendly_name ||
          primary,
        area: showRoom && record && !isGroup ? record.areaName : '',
        floor: record ? record.floorName : '',
        device: record ? record.deviceName : '',
        connection: entry ? entry.name || '' : '',
        entity_id: primary,
        domain: domains.domainOf(primary),
        state: stateObj ? stateObj.state : '',
        unit: attributes.unit_of_measurement || '',
        brightness:
          typeof attributes.brightness === 'number'
            ? Math.round((attributes.brightness / 255) * 100)
            : '',
        on_count: group.onCount,
        off_count: group.offCount,
        total: group.total,
        age: stateObj ? formatAge(stateObj.last_changed) : '',
        last_changed: stateObj ? stateObj.last_changed || '' : '',
        attributes: attributes
      };

      if (!entry || !entry.client.isOnline) {
        ctx.value = t('Offline');
        return { ctx: ctx, unavailable: true };
      }

      if (isGroup) {
        ctx.value = group.unavailable ? '--' : t(group.active ? 'On' : 'Off');
        return {
          ctx: ctx,
          active: group.active,
          unavailable: group.unavailable,
          accent: this._groupAccent(def, entry),
          progress: this._groupProgress(def, entry),
          busy: this.busy
        };
      }

      ctx.value = domains.valueText(primary, stateObj, t);

      return {
        ctx: ctx,
        active: domains.isActive(primary, stateObj),
        unavailable: domains.isUnavailable(stateObj),
        accent: domains.accentColor(primary, stateObj),
        progress: domains.progressOf(primary, stateObj),
        busy: this.busy
      };
    }

    /** Colour of the first member that is on, else of the first member. */
    _groupAccent(def, entry) {
      const domains = global.HaDomains;
      for (const entityId of def.entityIds) {
        const stateObj = entry ? entry.client.getState(entityId) : null;
        if (domains.isActive(entityId, stateObj)) {
          return domains.accentColor(entityId, stateObj);
        }
      }
      return domains.accentColor(def.entityIds[0], null);
    }

    /** Average of whatever members expose a level. */
    _groupProgress(def, entry) {
      const domains = global.HaDomains;
      let sum = 0;
      let count = 0;
      for (const entityId of def.entityIds) {
        const value = domains.progressOf(entityId, entry ? entry.client.getState(entityId) : null);
        if (typeof value === 'number') {
          sum += value;
          count += 1;
        }
      }
      return count ? sum / count : null;
    }

    destroy() {
      if (this._renderTimer) {
        global.clearTimeout(this._renderTimer);
        this._renderTimer = null;
      }
      if (this._refreshTimer) {
        global.clearInterval(this._refreshTimer);
        this._refreshTimer = null;
      }
    }
  }

  /** Compact age for `{{age}}`: `jetzt`, `5 min`, `3 h`, `2 d`. */
  function formatAge(isoTimestamp) {
    if (!isoTimestamp) return '';
    const then = Date.parse(isoTimestamp);
    if (!Number.isFinite(then)) return '';

    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return seconds + ' s';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + ' min';
    const hours = Math.round(minutes / 60);
    if (hours < 48) return hours + ' h';
    return Math.round(hours / 24) + ' d';
  }

  /** Ring buffer of what the host was actually sent. */
  global.KEY_PAINT_LOG = global.KEY_PAINT_LOG || [];

  global.KeyAction = KeyAction;
  global.keyActionFormatAge = formatAge;
})(window);
