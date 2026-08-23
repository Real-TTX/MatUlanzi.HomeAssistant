/**
 * Room-aware entity picker for property inspectors.
 *
 * Every row shows `Room › Device` plus the entity_id and its live state, so two
 * entities both called "Deckenlicht" are still tellable apart. Rows for lights,
 * switches and fans get an Identify button that briefly actuates the entity —
 * the fastest way to find out which lamp you are actually looking at.
 */
(function (global) {
  'use strict';

  /** Identify actuates the device, so only offer it where that is harmless. */
  const IDENTIFIABLE = ['light', 'switch', 'fan'];

  const TYPE_FILTERS = [
    { key: 'all', label: 'All types', domains: null },
    { key: 'light', label: 'Lights', domains: ['light'] },
    { key: 'switch', label: 'Switches', domains: ['switch', 'input_boolean'] },
    { key: 'scene', label: 'Scenes', domains: ['scene', 'script'] },
    { key: 'cover', label: 'Covers', domains: ['cover'] },
    { key: 'media', label: 'Media', domains: ['media_player'] }
  ];

  class EntityPicker {
    /**
     * @param {object} options
     * @param {HTMLElement} options.root
     * @param {HaClient} options.client
     * @param {HaRegistry} options.registry
     * @param {string[]} [options.domains] domains this action can use
     * @param {function} [options.t] translator
     * @param {function} [options.onSelect] receives the chosen entity_id
     */
    constructor(options) {
      this.root = options.root;
      this.client = options.client;
      this.registry = options.registry;
      this.domains = options.domains || null;
      this.t = options.t || ((key) => key);
      this.onSelect = options.onSelect || function () {};

      /** @type {string[]} every entity currently on the button */
      this.selected = [];
      this.query = '';
      this.typeFilter = 'all';
      this.areaId = '';

      this._build();
      const rerender = Utils.debounce(() => this.renderList(), 300);
      this._unsubscribe = [
        this.client.on('state', rerender),
        this.client.on('status', rerender),
        this.client.on('states', rerender)
      ];
    }

    // --- markup -------------------------------------------------------------

    _build() {
      const doc = global.document;
      this.root.innerHTML = '';

      this.search = doc.createElement('input');
      this.search.type = 'search';
      this.search.className = 'ha-search';
      this.search.placeholder = this.t('Search room, device or name');
      this.search.addEventListener(
        'input',
        Utils.debounce(() => {
          this.query = this.search.value;
          this.renderList();
        }, 140)
      );
      this.root.appendChild(this.search);

      this.filters = doc.createElement('div');
      this.filters.className = 'ha-filters';
      for (const filter of TYPE_FILTERS) {
        const chip = doc.createElement('button');
        chip.type = 'button';
        chip.className = 'ha-chip';
        chip.textContent = this.t(filter.label);
        chip.setAttribute('aria-pressed', String(filter.key === this.typeFilter));
        chip.addEventListener('click', () => {
          this.typeFilter = filter.key;
          for (const other of this.filters.children) {
            other.setAttribute('aria-pressed', String(other === chip));
          }
          this.renderList();
        });
        this.filters.appendChild(chip);
      }
      this.root.appendChild(this.filters);

      this.areaSelect = doc.createElement('select');
      this.areaSelect.className = 'ha-area-select';
      this.areaSelect.addEventListener('change', () => {
        this.areaId = this.areaSelect.value;
        this.renderList();
      });
      this.root.appendChild(this.areaSelect);

      this.list = doc.createElement('div');
      this.list.className = 'ha-list';
      this.root.appendChild(this.list);

      this.summary = doc.createElement('div');
      this.summary.className = 'ha-selected';
      this.root.appendChild(this.summary);

      this.renderAreas();
      this.renderList();
    }

    renderAreas() {
      const doc = global.document;
      this.areaSelect.innerHTML = '';
      const all = doc.createElement('option');
      all.value = '';
      all.textContent = this.t('All rooms');
      this.areaSelect.appendChild(all);

      for (const area of this.registry.areas()) {
        const option = doc.createElement('option');
        option.value = area.id;
        option.textContent = area.floor ? area.floor + ' › ' + area.name : area.name;
        this.areaSelect.appendChild(option);
      }
      this.areaSelect.value = this.areaId;
    }

    // --- list ---------------------------------------------------------------

    _activeDomains() {
      const filter = TYPE_FILTERS.find((entry) => entry.key === this.typeFilter);
      if (filter && filter.domains) {
        if (!this.domains) return filter.domains;
        return filter.domains.filter((domain) => this.domains.indexOf(domain) !== -1);
      }
      return this.domains;
    }

    renderList() {
      const doc = global.document;
      this.list.innerHTML = '';

      if (!this.registry.isLoaded) {
        // Without this distinction a dead connection just says "Loading…" forever.
        this.list.appendChild(
          this._empty(this.client.isOnline ? this.t('Loading') : this.t('Not connected'))
        );
        this.renderSummary();
        return;
      }

      const records = this.registry.search(this.query, {
        domains: this._activeDomains(),
        areaId: this.areaId,
        limit: 80
      });

      if (!records.length) {
        this.list.appendChild(this._empty(this.t('No matches')));
        this.renderSummary();
        return;
      }

      const fragment = doc.createDocumentFragment();
      for (const record of records) fragment.appendChild(this._row(record));
      this.list.appendChild(fragment);
      this.renderSummary();
    }

    _empty(text) {
      const div = global.document.createElement('div');
      div.className = 'ha-empty';
      div.textContent = text;
      return div;
    }

    _row(record) {
      const doc = global.document;
      const stateObj = this.client.getState(record.entityId);
      const domains = global.HaDomains;
      const isActive = domains.isActive(record.entityId, stateObj);
      const unavailable = domains.isUnavailable(stateObj);

      const row = doc.createElement('button');
      row.type = 'button';
      row.className = 'ha-row';
      row.setAttribute('aria-selected', String(this.isSelected(record.entityId)));
      row.addEventListener('click', () => this.select(record.entityId));

      const dot = doc.createElement('span');
      dot.className = 'ha-dot';
      if (!unavailable && isActive) {
        dot.style.background = domains.accentColor(record.entityId, stateObj);
      }
      row.appendChild(dot);

      const main = doc.createElement('span');
      main.className = 'ha-row-main';

      const name = doc.createElement('span');
      name.className = 'ha-row-name';
      name.textContent = record.name;
      main.appendChild(name);

      const meta = doc.createElement('span');
      meta.className = 'ha-row-meta';
      if (record.areaName) {
        const area = doc.createElement('span');
        area.className = 'ha-row-area';
        area.textContent = record.areaName;
        meta.appendChild(area);
        meta.appendChild(doc.createTextNode(' · '));
      }
      const rest = [];
      if (record.deviceName && record.deviceName !== record.name) rest.push(record.deviceName);
      rest.push(record.entityId);
      meta.appendChild(doc.createTextNode(rest.join(' · ')));
      main.appendChild(meta);
      row.appendChild(main);

      const state = doc.createElement('span');
      state.className = 'ha-row-state';
      state.textContent = unavailable ? '—' : String(stateObj.state);
      row.appendChild(state);

      if (IDENTIFIABLE.indexOf(record.domain) !== -1) {
        const identify = doc.createElement('span');
        identify.className = 'ha-identify';
        identify.textContent = '⚡';
        identify.title = this.t('Identify');
        identify.addEventListener('click', (event) => {
          event.stopPropagation(); // do not select the row
          this.identify(record.entityId);
        });
        row.appendChild(identify);
      }

      return row;
    }

    renderSummary() {
      this.summary.innerHTML = '';
      if (!this.selected.length) return;
      const doc = global.document;
      const record = this.registry.get(this.selected[0]);

      const label = doc.createElement('span');
      label.textContent = this.t('Selected') + ':';
      this.summary.appendChild(label);

      const value = doc.createElement('span');
      value.textContent = record
        ? (record.areaName ? record.areaName + ' › ' : '') + record.name
        : this.selected[0];
      this.summary.appendChild(value);

      const id = doc.createElement('span');
      id.className = 'ha-selected-id';
      id.textContent =
        this.selected.length > 1
          ? '+' + (this.selected.length - 1) + ' ' + this.t('more')
          : this.selected[0];
      this.summary.appendChild(id);
    }

    // --- actions ------------------------------------------------------------

    /** A click never removes anything — the owner decides what to do. */
    select(entityId) {
      this.onSelect(entityId);
    }

    /** @param {string|string[]} value */
    setSelected(value) {
      if (Array.isArray(value)) this.selected = value.filter(Boolean);
      else this.selected = value ? [value] : [];
      this.renderList();
    }

    isSelected(entityId) {
      return this.selected.indexOf(entityId) !== -1;
    }

    /**
     * Briefly actuates the entity so the user can see which one it is, then puts
     * it back — identifying a lamp must not leave it burning.
     */
    async identify(entityId) {
      const domain = global.HaDomains.domainOf(entityId);
      const target = { entity_id: entityId };
      const before = this.client.getState(entityId);
      const wasOn = Boolean(before) && String(before.state).toLowerCase() === 'on';

      // A light that is already on can flash without changing state at all.
      if (domain === 'light' && wasOn) {
        try {
          await this.client.callService('light', 'turn_on', { flash: 'short' }, target);
          return;
        } catch (err) {
          /* no flash support — blink it instead */
        }
      }

      const blink = wasOn ? 'turn_off' : 'turn_on';
      const restore = wasOn ? 'turn_on' : 'turn_off';
      const restoreData = {};
      if (wasOn && domain === 'light' && before.attributes && before.attributes.brightness) {
        restoreData.brightness = before.attributes.brightness;
      }

      try {
        await this.client.callService(domain, blink, {}, target);
      } catch (err) {
        $UD.toast(err.message);
        return;
      }

      global.setTimeout(() => {
        this.client.callService(domain, restore, restoreData, target).catch(() => {});
      }, 1200);
    }

    destroy() {
      for (const off of this._unsubscribe || []) off();
      this._unsubscribe = [];
    }
  }

  global.EntityPicker = EntityPicker;
})(window);
