/**
 * Key styling: the settings model, the text template engine and the shared
 * image cache.
 *
 * A key is described by a style object (colours, icons, three text slots). It
 * belongs to a button in the library, can be overridden per key, and in `html`
 * mode carries a raw HTML snippet the user wrote.
 */
(function (global) {
  'use strict';

  const DEFAULT_STYLE = Object.freeze({
    mode: 'classic', // 'classic' | 'html'

    bg_off: '#2a2d33',
    bg_on: '', // empty = derive from the entity (domain accent / light colour)
    bg_unavailable: '#212226',
    text_off: '',
    text_on: '',
    radius: 28,

    icon_off: '',
    icon_on: '',
    icon_size: 64,

    top: '{{area}}',
    center: '{{value}}',
    bottom: '{{name}}',

    show_bar: '1',
    html: ''
  });

  /** Style keys, so the editor and the settings merge stay in sync. */
  const STYLE_KEYS = Object.keys(DEFAULT_STYLE);

  /**
   * Style fields of an object, keeping empty strings.
   *
   * Used for a button's own style, where "" is a decision: an empty text zone
   * means *no text*, not "fall back to the default".
   */
  function sanitizeStyle(source) {
    const out = {};
    if (!source) return out;
    for (const key of STYLE_KEYS) {
      if (source[key] !== undefined && source[key] !== null) out[key] = source[key];
    }
    return out;
  }

  /**
   * Style fields of an object, dropping empty strings.
   *
   * Used for the per-key override layer, where an empty field means "inherit
   * from the button definition".
   */
  function pickStyle(source) {
    const out = {};
    if (!source) return out;
    for (const key of STYLE_KEYS) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
        out[key] = source[key];
      }
    }
    return out;
  }

  /** Defaults filled in, the given style respected verbatim. Idempotent. */
  function baseStyle(source) {
    return Object.assign({}, DEFAULT_STYLE, sanitizeStyle(source));
  }

  /** A button's own style, with per-key overrides applied on top. */
  function mergeStyle(own, overrides) {
    return Object.assign({}, DEFAULT_STYLE, sanitizeStyle(own), pickStyle(overrides));
  }

  // --- template engine ------------------------------------------------------

  const FILTERS = {
    upper: (value) => String(value).toUpperCase(),
    lower: (value) => String(value).toLowerCase(),
    round: (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? String(Math.round(num)) : String(value);
    },
    title: (value) =>
      String(value).replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1))
  };

  /**
   * Resolves `{{placeholder}}` against a context.
   *
   * Supported: `{{name}}`, `{{area}}`, `{{floor}}`, `{{device}}`, `{{state}}`,
   * `{{value}}`, `{{entity_id}}`, `{{domain}}`, `{{brightness}}`, `{{unit}}`,
   * any attribute via `{{attr:temperature}}`, and filters via
   * `{{name|upper}}` / `{{attr:temperature|round}}`.
   *
   * Unknown placeholders resolve to an empty string rather than staying
   * visible — a key is too small to show debug output.
   */
  function resolveTemplate(template, context) {
    if (!template) return '';
    return String(template).replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, expression) => {
      const parts = expression.split('|').map((part) => part.trim());
      const key = parts.shift();
      let value;

      if (key.indexOf('attr:') === 0) {
        const attribute = key.slice(5);
        value = context.attributes ? context.attributes[attribute] : undefined;
      } else {
        value = context[key];
      }

      if (value === undefined || value === null) return '';
      if (Array.isArray(value)) value = value.join(', ');

      for (const filterName of parts) {
        const filter = FILTERS[filterName];
        if (filter) value = filter(value);
      }
      return String(value);
    });
  }

  // --- image cache ----------------------------------------------------------

  const imageCache = new Map(); // cache key -> Promise<HTMLImageElement|null>

  const MDI_PREFIX = 'mdi:';

  /** `mdi:lightbulb` -> an SVG data URL filled with the given colour. */
  function mdiDataUrl(name, color) {
    const path = (global.MDI_ICONS || {})[name];
    if (!path) return '';
    return (
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="128" height="128">' +
          '<path fill="' +
          (color || '#ffffff') +
          '" d="' +
          path +
          '"/></svg>'
      )
    );
  }

  function isMdi(value) {
    return String(value || '').indexOf(MDI_PREFIX) === 0;
  }

  function mdiNames() {
    return Object.keys(global.MDI_ICONS || {}).sort();
  }

  /**
   * Loads an icon once per colour; resolves to null instead of throwing.
   *
   * @param {string} url  `mdi:<name>`, a file path, or a data URL
   * @param {string} [color] fill colour for mdi icons
   */
  function loadImage(url, color) {
    if (!url) return Promise.resolve(null);

    const mdi = isMdi(url);
    const source = mdi ? mdiDataUrl(url.slice(MDI_PREFIX.length), color) : toImageUrl(url);
    if (!source) return Promise.resolve(null);

    const cacheKey = mdi ? url + '|' + (color || '') : url;
    if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

    const promise = new Promise((resolve) => {
      const img = new global.Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = source;
    });
    imageCache.set(cacheKey, promise);
    return promise;
  }

  /** Absolute Windows/macOS paths from the file dialog need a file:// prefix. */
  function toImageUrl(url) {
    const value = String(url);
    if (/^(data:|file:|https?:|\.|\/)/i.test(value)) return value;
    if (/^[A-Za-z]:[\\/]/.test(value)) return 'file:///' + value.replace(/\\/g, '/');
    return value;
  }

  function clearImageCache() {
    imageCache.clear();
  }

  // --- HTML mode ------------------------------------------------------------

  /**
   * Renders an HTML snippet to an image via SVG foreignObject.
   *
   * Verified in Chromium: the canvas stays untainted, so the result can be
   * exported as a PNG. Caveats, and they are sharp ones: no scripts run, and
   * external images or fonts must be inlined as data URLs.
   */
  function htmlToImage(html, size) {
    const side = size || 196;
    const body =
      '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' +
      side +
      'px;height:' +
      side +
      'px;box-sizing:border-box;overflow:hidden">' +
      html +
      '</div>';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      side +
      '" height="' +
      side +
      '"><foreignObject width="' +
      side +
      '" height="' +
      side +
      '">' +
      body +
      '</foreignObject></svg>';

    return new Promise((resolve) => {
      const img = new global.Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  global.KeyStyle = {
    DEFAULT_STYLE: DEFAULT_STYLE,
    STYLE_KEYS: STYLE_KEYS,
    sanitizeStyle: sanitizeStyle,
    pickStyle: pickStyle,
    baseStyle: baseStyle,
    mergeStyle: mergeStyle,
    resolveTemplate: resolveTemplate,
    loadImage: loadImage,
    isMdi: isMdi,
    mdiNames: mdiNames,
    mdiDataUrl: mdiDataUrl,
    toImageUrl: toImageUrl,
    clearImageCache: clearImageCache,
    htmlToImage: htmlToImage
  };
})(window);
