/**
 * The control popup: a small window with the right knobs for one device.
 *
 * Same host rules as the designer (see designer-window.js): only the main
 * service may call `openView`, the path must be absolute, and the window needs
 * a uuid of its own — sharing one with an action makes the host drop its whole
 * bookkeeping for that uuid when the window closes. This one uses
 * `…matUlanziHa.control`, so designer and control window cannot bring each
 * other down.
 *
 * Unlike the designer this window is opened per device, so it also carries the
 * entity and connection in its parameters.
 */
(function (global) {
  'use strict';

  const HEARTBEAT_TIMEOUT_MS = 6000;
  const VIEW_PATH = '/property-inspector/control/control.html';

  /** Big enough for a colour picker, small enough to feel like a menu. */
  const WIDTH = 420;
  const HEIGHT = 520;

  /** Clear of the screen centre, where Studio itself sits. */
  const DEFAULT_X = 80;
  const DEFAULT_Y = 80;

  function ControlWindow(options) {
    const opts = options || {};
    this.ud = opts.ud;
    this.location = opts.location || global.location;
    this.log = opts.log || function () {};
    this.now = opts.now || Date.now;
    this.senderUuid = opts.senderUuid || '';
    this.width = opts.width || WIDTH;
    this.height = opts.height || HEIGHT;

    this.lastSeen = 0;
    this.context = null;
    this.stale = null;
    /** What the open window is showing, so a second press can switch it. */
    this.showing = '';
  }

  ControlWindow.prototype.viewPath = function () {
    const base = String(this.location.href)
      .split('?')[0]
      .split('#')[0]
      .replace(/\/plugin\/[^/]*$/, '');
    return base.replace(/^file:\/\//, '') + VIEW_PATH;
  };

  ControlWindow.prototype.noteAlive = function (context, entityId) {
    this.lastSeen = this.now();
    if (context) this.context = context;
    if (entityId) this.showing = entityId;
  };

  ControlWindow.prototype.noteClosed = function () {
    this.lastSeen = 0;
    if (this.context) this.stale = this.context;
    this.context = null;
    this.showing = '';
  };

  ControlWindow.prototype.isAlive = function () {
    return this.lastSeen > 0 && this.now() - this.lastSeen < HEARTBEAT_TIMEOUT_MS;
  };

  /** Asks a window-less page to close itself so it stops holding a connection. */
  ControlWindow.prototype.retireStale = function () {
    if (!this.stale || !this.ud) return;
    this.ud.sendToPropertyInspector({ response: 'control:close' }, this.stale);
    this.stale = null;
  };

  /**
   * @param {object} spec {entityId, connectionId, name, x, y}
   * @returns {'switched'|'opened'} whether an open window was re-aimed
   */
  ControlWindow.prototype.open = function (spec) {
    const wunsch = spec || {};

    if (this.isAlive() && this.context) {
      // Already up: point it at the new device instead of stacking windows.
      this.log('control window switches to ' + wunsch.entityId);
      this.ud.sendToPropertyInspector(
        { response: 'control:show', entity: wunsch.entityId, connection: wunsch.connectionId, name: wunsch.name },
        this.context
      );
      this.showing = wunsch.entityId;
      return 'switched';
    }

    this.retireStale();

    const params = {
      uuid: this.senderUuid || this.ud.uuid,
      key: 'control',
      actionid: 'control',
      address: this.ud.address,
      port: this.ud.port,
      language: this.ud.language,
      entity: wunsch.entityId || '',
      connection: wunsch.connectionId || '',
      label: wunsch.name || '',
      nonce: String(this.now())
    };

    this.log('openView ' + this.viewPath() + ' for ' + wunsch.entityId);
    // x and y are honoured precisely (measured); leaving them out centres it.
    // Centred would put it on top of Studio, where it is easy to miss. Unless
    // the button says otherwise, it opens clear of the middle.
    this.ud.openView(
      this.viewPath(),
      this.width,
      this.height,
      wunsch.x === undefined ? DEFAULT_X : wunsch.x,
      wunsch.y === undefined ? DEFAULT_Y : wunsch.y,
      params
    );
    this.showing = wunsch.entityId || '';
    return 'opened';
  };

  global.ControlWindow = ControlWindow;
})(window);
