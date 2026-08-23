/**
 * Builds the Home Assistant address an "open" key should send to the browser.
 *
 * Kept separate and free of side effects because the interesting part is the
 * string, and a wrong string opens the wrong page silently.
 *
 * Measured host behaviour that shaped this: `openUrl` opens a full https address
 * reliably, but `local: true` opens nothing at all — neither a relative nor an
 * absolute path. So every target here is a remote url.
 */
(function (global) {
  'use strict';

  const TARGETS = Object.freeze({
    entity: 'entity',
    area: 'area',
    dashboard: 'dashboard',
    url: 'url'
  });

  const DEFAULT_DASHBOARD = 'lovelace/0';

  function withoutTrailingSlash(url) {
    return String(url || '')
      .trim()
      .replace(/\/+$/, '');
  }

  /**
   * @param {string} baseUrl the connection's Home Assistant url
   * @param {object} spec {target, entityId, area, dashboard, url}
   * @returns {string} the address, or '' when the definition is incomplete
   */
  function build(baseUrl, spec) {
    const open = spec || {};
    const target = open.target || TARGETS.entity;

    if (target === TARGETS.url) {
      const raw = String(open.url || '').trim();
      if (!raw) return '';
      // A bare host would be read as a relative path by the host, which then
      // opens nothing.
      return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw;
    }

    const base = withoutTrailingSlash(baseUrl);
    if (!base) return '';

    if (target === TARGETS.area) {
      if (!open.area) return '';
      return base + '/config/areas/area/' + encodeURIComponent(open.area);
    }

    if (target === TARGETS.dashboard) {
      const path = String(open.dashboard || '')
        .trim()
        .replace(/^\/+/, '');
      return base + '/' + (path || DEFAULT_DASHBOARD);
    }

    // Entity: the more-info dialog opens over whatever dashboard is default, so
    // no dashboard path has to be guessed.
    if (!open.entityId) return '';
    return base + '/?more-info-entity-id=' + encodeURIComponent(open.entityId);
  }

  /** Short, human-readable description of what a key will open. */
  function describe(spec, names) {
    const open = spec || {};
    const lookup = names || {};
    if (open.target === TARGETS.url) return open.url || '';
    if (open.target === TARGETS.area) return lookup.area || open.area || '';
    if (open.target === TARGETS.dashboard) return open.dashboard || DEFAULT_DASHBOARD;
    return lookup.entity || open.entityId || '';
  }

  global.HaLinks = { build: build, describe: describe, TARGETS: TARGETS, DEFAULT_DASHBOARD: DEFAULT_DASHBOARD };
})(window);
