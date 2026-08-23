/**
 * Records page errors so they can be read out later, e.g.
 *   tools\cdp.cmd -Title "Key" -Expression "JSON.stringify(window.__errors)"
 *
 * Inside Studio there is no console to look at, and a single exception during
 * setup silently leaves a page half-wired — which looked exactly like a host
 * problem for hours. Loaded first, before anything else.
 */
(function (global) {
  'use strict';

  global.__errors = global.__errors || [];

  function record(entry) {
    global.__errors.push(entry);
    if (global.__errors.length > 30) global.__errors.shift();
  }

  global.addEventListener(
    'error',
    function (event) {
      // Failed <script src> surfaces here with the element as the target.
      const asset = event.target && event.target.src ? String(event.target.src) : '';
      record({
        at: new Date().toISOString().slice(11, 19),
        message: event.message || (event.error && event.error.message) || 'asset failed to load',
        source: String(event.filename || '').split('/').pop(),
        line: event.lineno || 0,
        asset: asset.split('/').pop()
      });
    },
    true
  );

  global.addEventListener('unhandledrejection', function (event) {
    const reason = event.reason;
    record({
      at: new Date().toISOString().slice(11, 19),
      message: 'unhandled rejection: ' + ((reason && reason.message) || String(reason))
    });
  });
})(window);
