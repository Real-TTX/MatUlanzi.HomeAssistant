/**
 * Main service wiring: a pool of Home Assistant connections, a library of
 * button definitions, and one action instance per configured key.
 */
(function (global) {
  'use strict';

  const PLUGIN_UUID = 'com.ulanzi.ulanzistudio.matUlanziHa';
  const LIBRARY_POLL_MS = 8000;
  const LEGACY_LOOKUP_DELAY_MS = 700;
  const KEY_POLL_MS = 5000;
  const TARGET_POLL_MS = 5000;
  // $UD and Utils are the SDK's top-level consts: reachable by bare name only,
  // they live in the global lexical scope, not on window.

  function log() {
    const args = Array.prototype.slice.call(arguments);
    Utils.log.apply(Utils, ['[ha]'].concat(args));
    try {
      $UD.logMessage(args.join(' '), 'debug');
    } catch (err) {
      /* host not ready yet */
    }
  }

  const i18n = new global.I18n('en');
  const pool = new global.HaPool({ log: log });
  const renderer = new global.KeyRenderer();
  // One shared target for every "context" key: long-press a device, and the
  // control keys on any page follow it until it expires.
  const targets = new global.TargetContext({ log: log });
  // The window gets a uuid of its own — never an action's. The host drops its
  // whole bookkeeping for a uuid when a view closes, which used to cut the
  // property inspector off from the host entirely. See designer-window.js.
  const designer = new global.DesignerWindow({
    ud: $UD,
    log: log,
    senderUuid: PLUGIN_UUID + '.designer'
  });

  // Its own uuid again, and a different one from the designer, so closing
  // either window cannot take the other down with it.
  const control = new global.ControlWindow({
    ud: $UD,
    log: log,
    senderUuid: PLUGIN_UUID + '.control'
  });

  /** Connections + button definitions, mirrored from the global settings. */
  let library = new global.Library({});
  let librarySignature = '';
  let libraryMigrated = false;

  /**
   * Ulanzi Studio scopes "global" settings by the UUID of the sender. The
   * designer and the property inspectors run under the *action* UUID, we run
   * under the *plugin* UUID — so asking as ourselves returns an empty bucket.
   * getGlobalSettings(context) lets us ask under an action's identity instead,
   * which is where the library actually lives.
   */
  const settingsContexts = new Set();

  /** Inspector waiting for its designer window to come up. */
  let designerRequestedBy = null;

  /** @type {Map<string, KeyAction>} context -> action instance */
  const actions = new Map();
  /** @type {Map<string, number>} context -> keydown timestamp */
  const pressStart = new Map();

  function ensureAction(message) {
    const context = message.context;
    if (context && !settingsContexts.has(context)) {
      settingsContexts.add(context);
      // A context we did not have before may unlock the library.
      requestGlobalSettings();
    }
    let action = actions.get(context);
    if (!action) {
      action = new global.KeyAction({
        context: context,
        ud: $UD,
        pool: pool,
        library: () => library,
        renderer: renderer,
        i18n: i18n,
      targets: targets,
      control: control,
        log: log
      });
      actions.set(context, action);
    }
    return action;
  }

  function applyParams(message) {
    if (!message || !message.context) return;
    ensureAction(message).setSettings(message.param || {});
  }

  function renderAll() {
    for (const action of actions.values()) action.scheduleRender();
  }

  // --- Home Assistant -------------------------------------------------------

  pool.on('status', (info) => {
    log('connection ' + info.connectionId + ': ' + info.status + (info.error ? ' (' + info.error + ')' : ''));
    if (info.status === global.HA_STATUS.AUTH_FAILED) {
      $UD.toast('Home Assistant: ' + (info.error || 'Token ungültig'));
    }
    renderAll();
  });

  pool.on('states', renderAll);

  pool.on('state', (change) => {
    for (const action of actions.values()) {
      if (action.watches(change.connectionId, change.entityId)) action.scheduleRender();
    }
  });

  /**
   * Asks the shared bucket, plus — until we have migrated once — the per-page
   * buckets an older build wrote into.
   */
  function requestGlobalSettings() {
    $UD.getGlobalSettings(global.LIBRARY_CONTEXT);
    if (libraryMigrated) return;

    // Two phases on purpose: if both buckets were asked at once, a stale copy
    // from an old per-page bucket could answer last and overwrite the good one.
    global.setTimeout(() => {
      if (libraryMigrated) return;
      $UD.getGlobalSettings(); // the plugin's own identity
      for (const context of settingsContexts) $UD.getGlobalSettings(context);
    }, LEGACY_LOOKUP_DELAY_MS);
  }

  function applyGlobalSettings(settings) {
    const blob = settings || {};

    // Several buckets answer; the plugin's own one is usually empty. An empty
    // answer must never overwrite a library we already have.
    const hasContent =
      (blob.connections && blob.connections.length) ||
      (blob.buttons && blob.buttons.length) ||
      blob.ha_url;
    if (!hasContent && (library.connections.length || library.buttons.length)) return;

    const signature = JSON.stringify(blob);
    if (signature === librarySignature) return; // nothing changed, nothing to repaint
    librarySignature = signature;

    // First content we see may still live in a per-page bucket from an older
    // build; copy it into the shared one so everybody reads the same library.
    if (hasContent && !libraryMigrated) {
      libraryMigrated = true;
      $UD.setGlobalSettings(blob, global.LIBRARY_CONTEXT);
      log('library copied into the shared bucket');
    }

    library = global.Library.parse(blob);
    // Icon files may have been replaced on disk behind the same path.
    global.KeyStyle.clearImageCache();
    pool.configure(library.connections);
    log(
      library.connections.length + ' connection(s), ' + library.buttons.length + ' button(s)'
    );

    // The definitions changed under the keys, so ignore the "same image" guard.
    for (const action of actions.values()) action.forceRepaint();
  }

  // A new target changes what every context key shows and acts on.
  targets.on(repaintContextKeys);

  function repaintContextKeys() {
    for (const action of actions.values()) {
      const def = action.definition();
      if (def && def.targetMode === 'context') action.forceRepaint();
    }
  }

  // The target expires lazily — nothing would tell the keys, so notice the
  // moment it lapses and let them fall back to "no target".
  let hadTarget = false;
  global.setInterval(() => {
    const has = Boolean(targets.get());
    if (hadTarget && !has) repaintContextKeys();
    hadTarget = has;
  }, TARGET_POLL_MS);

  // --- UlanziStudio events --------------------------------------------------

  $UD.connect(PLUGIN_UUID);

  $UD.onConnected(() => {
    i18n.setLanguage($UD.language || 'en');
    log('main service connected, language ' + i18n.language);
    requestGlobalSettings();

    // The designer saves into the global settings from its own window. It tells
    // us via sendToPlugin, but that path is not guaranteed by the SDK, so poll
    // as a safety net — applyGlobalSettings ignores unchanged payloads, so an
    // idle plugin does no work at all.
    global.setInterval(requestGlobalSettings, LIBRARY_POLL_MS);
    global.setInterval(pullKeySettings, KEY_POLL_MS);
  });

  $UD.onDidReceiveGlobalSettings((message) => {
    applyGlobalSettings((message && (message.settings || message.param)) || {});
  });

  $UD.onAdd((message) => {
    const action = ensureAction(message);
    if (message.param) action.setSettings(message.param);
    else action.scheduleRender();

    // Studio may not be ready to accept an image the instant a key appears, and
    // a dropped first paint leaves the key blank. A second one costs nothing.
    global.setTimeout(() => action.forceRepaint(), 800);
  });

  $UD.onParamFromApp(applyParams);
  $UD.onParamFromPlugin(applyParams);

  /**
   * Studio's own answer to getSettings — the authoritative copy.
   *
   * Messages a property inspector sends can silently go nowhere (its socket
   * looks open, the host just drops them, e.g. while a popup view is or was
   * open). Pulling the stored settings makes the keys correct regardless, so a
   * lost message costs at most one poll interval instead of leaving a key wrong
   * until the next restart.
   */
  $UD.onDidReceiveSettings((message) => {
    if (!message || !message.context) return;
    const stored = message.settings || message.param;
    if (!stored) return;

    const action = ensureAction(message);
    if (JSON.stringify(action.settings) === JSON.stringify(stored)) return;
    log('settings for ' + message.context + ' differ from ours, taking Studio\'s copy');
    action.setSettings(stored);
    action.forceRepaint();
  });

  function pullKeySettings() {
    for (const context of actions.keys()) $UD.getSettings(context);
  }

  $UD.onSetActive((message) => {
    const action = actions.get(message.context);
    if (action) action.setActive(message.active);
  });

  $UD.onKeyDown((message) => {
    pressStart.set(message.context, Date.now());
  });

  $UD.onRun((message) => {
    const action = ensureAction(message);
    const started = pressStart.get(message.context);
    pressStart.delete(message.context);
    // No keydown seen (e.g. simulator or multi-action) counts as a short press.
    const duration = started ? Date.now() - started : 0;
    action.handlePress(duration);
  });

  $UD.onClear((message) => {
    const items = (message && message.param) || [];
    for (const item of items) {
      const action = actions.get(item.context);
      if (action) {
        action.destroy();
        actions.delete(item.context);
      }
      pressStart.delete(item.context);
    }
  });

  /** Property inspectors and the designer ask for connection status here. */
  $UD.onSendToPlugin((message) => {
    // The SDK wraps sendToPlugin data in `payload`; the others are belt and braces.
    const payload = (message && (message.payload || message.param || message.settings)) || {};

    // The designer just wrote the library and wants the keys refreshed now
    // instead of at the next poll.
    // Only the main service may open a view; an inspector asking the host
    // directly is silently ignored, so it asks us instead.
    if (payload.request === 'open-designer') {
      const outcome = designer.open(payload.button || '');
      // Remembered so we can report back once the window is really up: the
      // inspector keeps its button spinning until then.
      designerRequestedBy = message.context || null;
      $UD.sendToPropertyInspector({ response: 'designer', state: outcome }, message.context);
      if (outcome === 'focus') designerRequestedBy = null;
      return;
    }

    // The designer window reports in while it lives, so we know whether to
    // open a new one or hand the running one a different button.
    if (payload.request === 'designer:hello' || payload.request === 'designer:ping') {
      designer.noteAlive(message.context);
      if (payload.request === 'designer:hello' && designerRequestedBy) {
        $UD.sendToPropertyInspector({ response: 'designer', state: 'ready' }, designerRequestedBy);
        designerRequestedBy = null;
      }
      return;
    }
    if (payload.request === 'control:hello' || payload.request === 'control:ping') {
      control.noteAlive(message.context, payload.entity);
      return;
    }
    if (payload.request === 'control:bye') {
      control.noteClosed();
      return;
    }

    if (payload.request === 'designer:bye') {
      designer.noteClosed();
      requestGlobalSettings();
      pullKeySettings();
      return;
    }

    if (payload.request === 'reload') {
      requestGlobalSettings();
      pullKeySettings();
      return;
    }

    // A property inspector changed this key. This is the direct path, used
    // alongside paramfromplugin because the host does not reliably forward that
    // to us — without it the deck would keep the old picture.
    if (payload.request === 'params' && message.context) {
      const action = ensureAction(message);
      action.setSettings(payload.settings || {});
      action.forceRepaint();
      log('params via sendToPlugin for ' + message.context);
      return;
    }

    if (payload.request !== 'status') return;

    $UD.sendToPropertyInspector(
      {
        response: 'status',
        connections: pool.entries().map((entry) => ({
          id: entry.id,
          name: entry.name,
          status: entry.client.status,
          error: entry.client.lastError,
          haVersion: entry.client.haVersion,
          entityCount: entry.client.states.size
        }))
      },
      message.context
    );
  });

  // Handy while debugging in localhost:9292.
  global.haDebug = {
    pool: pool,
    actions: actions,
    library: () => library,
    paints: () => global.KEY_PAINT_LOG,
    targets: targets,
    designer: designer,
    control: control,
    repaintAll: () => {
      for (const action of actions.values()) action.forceRepaint();
      return actions.size;
    }
  };
})(window);
