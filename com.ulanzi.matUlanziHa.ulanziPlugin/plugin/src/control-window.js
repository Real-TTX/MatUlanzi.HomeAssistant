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

  /** Only used when the screen will not say how big it is. */
  const FALLBACK_X = 80;
  const FALLBACK_Y = 80;

  /**
   * A starting guess at the title bar, so even the first window of a session
   * lands in the middle. Measured on Windows (31 px); the first window that
   * opens replaces it with the truth, whatever host this turns out to be.
   */
  const FRAME_GUESS = { x: 0, y: 31 };

  function ControlWindow(options) {
    const opts = options || {};
    this.ud = opts.ud;
    this.location = opts.location || global.location;
    this.log = opts.log || function () {};
    this.now = opts.now || Date.now;
    this.senderUuid = opts.senderUuid || '';
    this.width = opts.width || WIDTH;
    this.height = opts.height || HEIGHT;
    this.screen = opts.screen || global.screen;
    /** How much bigger the host makes the window than we ask for. */
    this.frame = { x: FRAME_GUESS.x, y: FRAME_GUESS.y };

    this.lastSeen = 0;
    this.context = null;
    this.stale = null;
    /** What the open window is showing, so a second press can switch it. */
    this.showing = '';
  }

  /**
   * The middle of the screen.
   *
   * Left to itself the host centres the window too - but only because the SDK
   * drops a zero coordinate, so "centred" is whatever the host happens to mean
   * that day. Working area rather than raw screen size, so the window does not
   * sit half behind the task bar.
   */
  ControlWindow.prototype.centre = function () {
    const schirm = this.screen || {};
    const breite = Number(schirm.availWidth || schirm.width) || 0;
    const hoehe = Number(schirm.availHeight || schirm.height) || 0;
    if (!breite || !hoehe) return { x: FALLBACK_X, y: FALLBACK_Y };

    // Never zero: the SDK reads that as "no preference" and centres it itself.
    return {
      x: Math.max(1, Math.round((breite - this.width - this.frame.x) / 2)),
      y: Math.max(1, Math.round((hoehe - this.height - this.frame.y) / 2))
    };
  };

  ControlWindow.prototype.viewPath = function () {
    const base = String(this.location.href)
      .split('?')[0]
      .split('#')[0]
      .replace(/\/plugin\/[^/]*$/, '');
    return base.replace(/^file:\/\//, '') + VIEW_PATH;
  };

  ControlWindow.prototype.noteAlive = function (context, entityId, outer) {
    this.lastSeen = this.now();
    if (context) this.context = context;
    if (entityId) this.showing = entityId;
    if (outer) this.noteFrame(outer);
  };

  /**
   * What the window really measured, so the next one can be aimed properly.
   *
   * The host draws a title bar around the size it was given and then insists on
   * placing the window itself - a page that moves itself is quietly put back.
   * So the only way to land in the middle is to ask for the right spot, and
   * that needs the frame's size, which nobody says out loud.
   */
  ControlWindow.prototype.noteFrame = function (outer) {
    const breite = Number(outer[0]);
    const hoehe = Number(outer[1]);
    if (!isFinite(breite) || !isFinite(hoehe)) return;
    this.frame = {
      x: Math.max(0, Math.round(breite - this.width)),
      y: Math.max(0, Math.round(hoehe - this.height))
    };
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

  /** Asks the open window to close itself. */
  ControlWindow.prototype.close = function () {
    if (!this.isAlive() || !this.context) return false;
    this.log('control window closes');
    this.ud.sendToPropertyInspector({ response: 'control:close' }, this.context);
    this.lastSeen = 0;
    this.context = null;
    this.showing = '';
    this.stale = null;
    return true;
  };

  /**
   * The same hold that opened the window closes it again.
   *
   * Only for the device it is already showing: holding another key while the
   * window is up means "show me that one instead", not "go away".
   *
   * @param {object} spec {entityId, connectionId, name, x, y}
   * @returns {'closed'|'switched'|'opened'}
   */
  ControlWindow.prototype.toggle = function (spec) {
    const wunsch = spec || {};
    if (this.isAlive() && this.context && this.showing && this.showing === wunsch.entityId) {
      this.close();
      return 'closed';
    }
    return this.open(wunsch);
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

    // x and y are honoured precisely (measured), so the middle is worked out
    // here rather than left to the host. A button may still name its own spot.
    const mitte = this.centre();
    const x = wunsch.x === undefined ? mitte.x : wunsch.x;
    const y = wunsch.y === undefined ? mitte.y : wunsch.y;

    this.log('openView ' + this.viewPath() + ' for ' + wunsch.entityId + ' at ' + x + ',' + y);
    this.ud.openView(this.viewPath(), this.width, this.height, x, y, params);
    this.showing = wunsch.entityId || '';
    return 'opened';
  };

  global.ControlWindow = ControlWindow;
})(window);
