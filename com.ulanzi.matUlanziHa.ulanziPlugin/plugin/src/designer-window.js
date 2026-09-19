/**
 * Opens the designer as a real Studio window.
 *
 * `openView` works, but three of its conditions are undocumented and each one
 * fails silently — all of this was measured over the DevTools port, not guessed:
 *
 *  1. Only the main service may call it. Sent from a property inspector nothing
 *     happens at all: no window, no error.
 *  2. The url must be a bare path; parameters belong in the `param` object. The
 *     host appends them itself.
 *  3. The path must be absolute. The host prepends `file://` verbatim, so
 *     `./property-inspector/x.html` becomes `file://property-inspector/x.html`
 *     — first segment read as a host name, window lands on a Chromium error
 *     page. That is what an "empty window" really is.
 *
 * And the one that cost the most: **the window must not share its uuid with an
 * action.** The host keeps its bookkeeping per uuid, and when a view closes it
 * drops everything under that uuid. Given the action uuid, closing the designer
 * silently cut the property inspector off from the host — sockets stayed open,
 * every message and every settings request vanished — and the host also refused
 * to open a second view. Both symptoms, one cause. Under its own uuid the window
 * opens and closes as often as you like (measured at ~370 ms per cycle), and
 * `sendToPlugin` still reaches us because the host resolves the main service by
 * stripping the last uuid segment.
 */
(function (global) {
  'use strict';

  /** A designer that stopped answering for this long is treated as gone. */
  const HEARTBEAT_TIMEOUT_MS = 6000;
  const VIEW_PATH = '/property-inspector/designer/designer.html';

  /** Far enough from the centre that Studio cannot hide it. */
  const OFFSET_X = 60;
  const OFFSET_Y = 40;

  function DesignerWindow(options) {
    options = options || {};
    this.ud = options.ud;
    this.location = options.location || global.location;
    this.log = options.log || function () {};
    this.now = options.now || Date.now;
    this.width = options.width || 1280;
    this.height = options.height || 860;

    /** Own uuid, deliberately not an action's — see the header. */
    this.senderUuid = options.senderUuid || '';

    /** Last heartbeat of a live designer, 0 when none is known. */
    this.lastSeen = 0;
    /** Identity of the live designer, so we can talk to it. */
    this.context = null;
    /**
     * A page that lost its window but is still loaded. The host destroys the
     * window when the user closes it with its own X and leaves the page
     * running — including its Home Assistant connection. Retire it before
     * opening the next one.
     */
    this.stale = null;
  }

  /** The plugin root as a path the host can turn into a valid file:// url. */
  DesignerWindow.prototype.viewPath = function () {
    const base = String(this.location.href)
      .split('?')[0]
      .split('#')[0]
      .replace(/\/plugin\/[^/]*$/, '');
    return base.replace(/^file:\/\//, '') + VIEW_PATH;
  };

  DesignerWindow.prototype.noteAlive = function (context) {
    this.lastSeen = this.now();
    if (context) this.context = context;
  };

  DesignerWindow.prototype.noteClosed = function () {
    this.lastSeen = 0;
    if (this.context) this.stale = this.context;
    this.context = null;
  };

  DesignerWindow.prototype.isAlive = function () {
    return this.lastSeen > 0 && this.now() - this.lastSeen < HEARTBEAT_TIMEOUT_MS;
  };

  /**
   * @returns {'focus'|'opened'} what the caller should tell the user:
   *   focus — a designer is already running, we asked it to switch button
   *   opened — a window is on its way
   */
  DesignerWindow.prototype.open = function (buttonId) {
    if (this.isAlive()) {
      this.log('designer already open, switching it to ' + (buttonId || '(none)'));
      if (this.context && this.ud) {
        this.ud.sendToPropertyInspector(
          { response: 'designer:select', button: buttonId || '' },
          this.context
        );
      }
      return 'focus';
    }

    this.retireStale();
    this.send(buttonId);
    return 'opened';
  };

  /** Asks a window-less page to close itself, so it stops holding a connection. */
  DesignerWindow.prototype.retireStale = function () {
    if (!this.stale || !this.ud) return;
    this.log('retiring the previous designer page');
    this.ud.sendToPropertyInspector({ response: 'designer:close' }, this.stale);
    this.stale = null;
  };

  DesignerWindow.prototype.send = function (buttonId) {
    const path = this.viewPath();
    this.log('openView ' + path);
    // Deliberately offset instead of centred: Studio itself sits in the middle
    // of the screen at almost exactly this size, so a centred window lands on
    // top of it and looks like nothing happened at all.
    this.ud.openView(path, this.width, this.height, OFFSET_X, OFFSET_Y, {
      uuid: this.senderUuid || this.ud.uuid,
      key: 'designer',
      actionid: 'designer',
      address: this.ud.address,
      port: this.ud.port,
      language: this.ud.language,
      button: buttonId || '',
      // Read by claimOwnIdentity() so two windows never share a socket.
      nonce: String(this.now())
    });
  };

  global.DesignerWindow = DesignerWindow;
})(window);
