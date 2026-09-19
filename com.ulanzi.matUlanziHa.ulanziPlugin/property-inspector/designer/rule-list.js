/**
 * The display rules of a button: condition on the left, look on the right.
 *
 * Replaces "icon when on, icon when off", which could not say "red below 20 %".
 * A button with no rules stays on automatic; this only appears once you ask to
 * customise, and then it starts from what the domain suggests rather than from
 * an empty table.
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
    return 'rule-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  /**
   * @param {object} deps host, t, entitiesOf, labelOf, attributesOf, onChange, pickIcon
   */
  function RuleList(deps) {
    this.deps = deps;
    this.rules = [];
  }

  RuleList.prototype.set = function (rules) {
    this.rules = (rules || []).map((rule) => Object.assign({ id: newId() }, rule));
    this.render();
  };

  RuleList.prototype.get = function () {
    return this.rules.map((rule) => Object.assign({}, rule));
  };

  RuleList.prototype._changed = function () {
    this.deps.onChange(this.get());
  };

  RuleList.prototype.add = function (rule) {
    this.rules.push(
      Object.assign({ id: newId(), scope: 'any', what: 'state', op: '=', value: '', icon: '', bg: '' }, rule || {})
    );
    this.render();
    this._changed();
  };

  RuleList.prototype.remove = function (id) {
    this.rules = this.rules.filter((rule) => rule.id !== id);
    this.render();
    this._changed();
  };

  RuleList.prototype.move = function (id, delta) {
    const at = this.rules.findIndex((rule) => rule.id === id);
    const ziel = at + delta;
    if (at === -1 || ziel < 0 || ziel >= this.rules.length) return;
    const [rule] = this.rules.splice(at, 1);
    this.rules.splice(ziel, 0, rule);
    this.render();
    this._changed();
  };

  RuleList.prototype.render = function () {
    const deps = this.deps;
    const host = deps.host;
    host.innerHTML = '';

    for (const rule of this.rules) host.appendChild(this._row(rule));

    const add = element('button', 'wide', '+ ' + deps.t('Rule'));
    add.type = 'button';
    add.addEventListener('click', () => this.add());
    host.appendChild(add);

    const hinweis = element('p', 'hint', deps.t('The first rule that matches wins.'));
    host.appendChild(hinweis);
  };

  RuleList.prototype._row = function (rule) {
    const deps = this.deps;
    const t = deps.t;
    const row = element('div', 'ha-rule');

    const bedingung = element('div', 'ha-rule-when');

    const scope = doc.createElement('select');
    scope.appendChild(option('any', t('any of them')));
    scope.appendChild(option('all', t('all of them')));
    for (const id of deps.entitiesOf()) scope.appendChild(option(id, deps.labelOf(id)));
    scope.value = rule.scope || 'any';
    scope.addEventListener('change', () => {
      rule.scope = scope.value;
      this._changed();
    });

    const was = doc.createElement('select');
    was.appendChild(option('state', t('State')));
    for (const name of deps.attributesOf()) was.appendChild(option('attr:' + name, name));
    // An attribute the entity does not currently report is still valid; keep it.
    if (rule.what && rule.what !== 'state' && !deps.attributesOf().some((n) => 'attr:' + n === rule.what)) {
      was.appendChild(option(rule.what, rule.what.slice(5)));
    }
    was.value = rule.what || 'state';
    was.addEventListener('change', () => {
      rule.what = was.value;
      this._changed();
    });

    const op = doc.createElement('select');
    for (const zeichen of global.DisplayRules.OPERATORS) op.appendChild(option(zeichen, zeichen));
    op.appendChild(option('unavailable', t('is unavailable')));
    op.value = rule.op || '=';
    op.addEventListener('change', () => {
      rule.op = op.value;
      wert.classList.toggle('hidden', op.value === 'unavailable');
      this._changed();
    });

    const wert = doc.createElement('input');
    wert.type = 'text';
    wert.value = rule.value === undefined || rule.value === null ? '' : rule.value;
    wert.placeholder = 'on';
    wert.classList.toggle('hidden', rule.op === 'unavailable');
    wert.addEventListener('change', () => {
      rule.value = wert.value;
      this._changed();
    });

    bedingung.appendChild(scope);
    bedingung.appendChild(was);
    bedingung.appendChild(op);
    bedingung.appendChild(wert);

    const aussehen = element('div', 'ha-rule-then');

    const icon = doc.createElement('input');
    icon.type = 'text';
    icon.placeholder = 'mdi:lightbulb';
    icon.value = rule.icon || '';
    icon.addEventListener('change', () => {
      rule.icon = icon.value;
      this._changed();
    });

    const waehlen = element('button', '', t('Choose'));
    waehlen.type = 'button';
    waehlen.addEventListener('click', () => {
      deps.pickIcon(icon.value, (gewaehlt) => {
        icon.value = gewaehlt;
        rule.icon = gewaehlt;
        this._changed();
      });
    });

    const farbe = doc.createElement('input');
    farbe.type = 'color';
    farbe.value = /^#[0-9a-f]{6}$/i.test(rule.bg || '') ? rule.bg : '#2a2d33';
    farbe.title = t('Background');
    farbe.addEventListener('change', () => {
      rule.bg = farbe.value;
      this._changed();
    });

    const runter = element('button', 'ha-rule-move', '\u2193');
    runter.type = 'button';
    runter.title = t('Later');
    runter.addEventListener('click', () => this.move(rule.id, 1));

    const hoch = element('button', 'ha-rule-move', '\u2191');
    hoch.type = 'button';
    hoch.title = t('Earlier');
    hoch.addEventListener('click', () => this.move(rule.id, -1));

    const weg = element('button', 'ha-rule-move', '\u2715');
    weg.type = 'button';
    weg.title = t('Remove this rule');
    weg.addEventListener('click', () => this.remove(rule.id));

    aussehen.appendChild(icon);
    aussehen.appendChild(waehlen);
    aussehen.appendChild(farbe);
    aussehen.appendChild(hoch);
    aussehen.appendChild(runter);
    aussehen.appendChild(weg);

    row.appendChild(bedingung);
    row.appendChild(aussehen);
    return row;
  };

  global.RuleList = RuleList;
})(window);
