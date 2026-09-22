/**
 * The action list of a button: what happens, when, and to which entity.
 *
 * Replaces the fixed pairs the designer used to offer. A row says "on a long
 * press, set light.floor_lamp to 40 % warm white"; the next row can say
 * something else for the same press. Services and their fields come from Home
 * Assistant, so this file only arranges them.
 */
(function (global) {
  'use strict';

  const doc = global.document;

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function option(value, label) {
    const node = doc.createElement('option');
    node.value = value;
    node.textContent = label;
    return node;
  }

  function newId() {
    return 'act-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  /**
   * @param {object} deps
   *   host        where to render
   *   t           translator
   *   entitiesOf  () => entity ids of the button
   *   labelOf     (entityId) => readable name
   *   catalogue   () => Promise of the get_services answer
   *   stateOf     (entityId) => the entity's current state, or null
   *   renderFields(host, service, data, onChange)  the shared field renderer
   *   collect(host)        reads those fields back
   *   merge(json, service, values)  merges them into the JSON
   *   onChange(actions)    called whenever something changed
   */
  function ActionList(deps) {
    this.deps = deps;
    this.actions = [];
  }

  ActionList.prototype.set = function (actions) {
    this.actions = (actions || []).map((action) => Object.assign({}, action));
    this.render();
  };

  ActionList.prototype.get = function () {
    return this.actions.map((action) => Object.assign({}, action));
  };

  ActionList.prototype._changed = function () {
    this.deps.onChange(this.get());
  };

  ActionList.prototype.add = function () {
    this.actions.push({
      id: newId(),
      trigger: 'press',
      kind: 'service',
      entity: '',
      domain: '',
      service: '',
      data: ''
    });
    this.render();
    this._changed();
  };

  ActionList.prototype.remove = function (id) {
    this.actions = this.actions.filter((action) => action.id !== id);
    this.render();
    this._changed();
  };

  ActionList.prototype.render = function () {
    const deps = this.deps;
    const host = deps.host;
    host.innerHTML = '';

    for (const action of this.actions) {
      host.appendChild(this._row(action));
    }

    const add = element('button', 'wide', '+ ' + deps.t('Action'));
    add.type = 'button';
    add.addEventListener('click', () => this.add());
    host.appendChild(add);

    if (!this.actions.length) {
      const hint = element('p', 'hint', deps.t('No actions yet — the button behaves as before.'));
      host.appendChild(hint);
    }
  };

  ActionList.prototype._row = function (action) {
    const deps = this.deps;
    const t = deps.t;

    const row = element('div', 'ha-action');

    const head = element('div', 'ha-action-head');

    const trigger = doc.createElement('select');
    trigger.appendChild(option('press', t('Short press')));
    trigger.appendChild(option('long', t('Long press')));
    trigger.appendChild(option('double', t('Double click')));
    trigger.value = action.trigger || 'press';
    trigger.addEventListener('change', () => {
      action.trigger = trigger.value;
      this._changed();
    });

    const entity = doc.createElement('select');
    entity.appendChild(option('', t('All entities')));
    for (const id of deps.entitiesOf()) entity.appendChild(option(id, deps.labelOf(id)));
    entity.value = action.entity || '';
    entity.addEventListener('change', () => {
      action.entity = entity.value;
      // A different entity means a different domain, so the service list and
      // its fields have to be built again.
      this.render();
      this._changed();
    });

    const kind = doc.createElement('select');
    kind.appendChild(option('service', t('Home Assistant service')));
    kind.appendChild(option('window', t('Open control window')));
    kind.appendChild(option('identify', t('Identify (show what it is)')));
    kind.appendChild(option('none', t('Nothing')));
    kind.value = ['window', 'identify', 'none'].indexOf(action.kind) !== -1 ? action.kind : 'service';
    kind.addEventListener('change', () => {
      action.kind = kind.value;
      if (action.kind !== 'service') {
        // The window needs no service; leaving the old one would show a call
        // that never happens.
        action.domain = '';
        action.service = '';
        action.data = '';
      }
      this.render();
      this._changed();
    });

    const service = doc.createElement('select');
    service.appendChild(option('', '…'));

    const remove = element('button', 'ha-action-remove', '\u2715');
    remove.type = 'button';
    remove.title = t('Remove this action');
    remove.addEventListener('click', () => this.remove(action.id));

    // Reads the way the decision is actually made: when does it happen, what
    // kind of thing happens, and only then the details. The kind used to sit
    // below the service it governs, which was backwards.
    head.appendChild(trigger);
    head.appendChild(kind);
    head.appendChild(entity);
    if (action.kind === 'service') head.appendChild(service);
    head.appendChild(remove);

    head.classList.toggle('ha-action-head-window', action.kind !== 'service');
    row.appendChild(head);

    const fields = element('div', 'ha-action-fields');
    if (action.kind === 'service') row.appendChild(fields);

    const json = doc.createElement('textarea');
    json.className = 'ha-action-json';
    json.spellcheck = false;
    json.value = action.data || '';
    json.placeholder = '{ }';
    if (action.kind !== 'service') json.classList.add('hidden');
    json.addEventListener('change', () => {
      action.data = json.value;
      this._changed();
      this._fillFields(action, fields, json);
    });
    row.appendChild(json);

    // The entity decides which services are on offer; without one we fall back
    // to the button's first entity so the list is never empty.
    if (action.kind !== 'service') return row;

    const fuer = action.entity || deps.entitiesOf()[0] || '';
    deps.catalogue().then((katalog) => {
      if (!katalog) return;
      const angebote = global.HaServices.servicesFor(katalog, fuer, (deps.stateOf ? deps.stateOf(fuer) : null));
      service.innerHTML = '';
      service.appendChild(option('', '— ' + t('Pick an action') + ' —'));
      for (const eintrag of angebote) {
        const id = eintrag.domain + '.' + eintrag.service;
        service.appendChild(option(id, id + (eintrag.label ? ' — ' + eintrag.label : '')));
      }
      service.value = action.domain ? action.domain + '.' + action.service : '';

      service.addEventListener('change', () => {
        const wahl = String(service.value || '');
        const punkt = wahl.indexOf('.');
        action.domain = punkt === -1 ? '' : wahl.slice(0, punkt);
        action.service = punkt === -1 ? '' : wahl.slice(punkt + 1);
        // Data from the previous service would be rejected by the new one.
        action.data = '';
        json.value = '';
        this._changed();
        this._fillFields(action, fields, json);
      });

      this._fillFields(action, fields, json);
    });

    return row;
  };

  /** Draws the chosen service's own fields, and keeps the JSON in step. */
  ActionList.prototype._fillFields = function (action, host, json) {
    const deps = this.deps;
    if (!action.domain || !action.service) {
      host.innerHTML = '';
      return;
    }
    deps.catalogue().then((katalog) => {
      if (!katalog) return;
      const fuer = action.entity || deps.entitiesOf()[0] || '';
      const dienst = global.HaServices.find(katalog, action.domain, action.service, (deps.stateOf ? deps.stateOf(fuer) : null));
      const parsed = global.SwitchPlan.parseData(action.data);
      deps.renderFields(host, dienst, parsed.error ? {} : parsed.data, () => {
        action.data = deps.merge(action.data, dienst, deps.collect(host));
        json.value = action.data;
        this._changed();
      });
    });
  };

  global.ActionList = ActionList;
})(window);
