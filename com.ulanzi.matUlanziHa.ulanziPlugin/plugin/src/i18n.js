/**
 * Strings drawn onto keys by the main service.
 *
 * Kept in code rather than read from the locale JSONs: the main service runs
 * from file://, where XHR is unreliable, and a key that renders "Off" instead
 * of "Aus" is a worse failure than a duplicated string table.
 * The locale JSONs still drive the plugin list and the property inspectors.
 */
(function (global) {
  'use strict';

  const STRINGS = {
    en: {
      On: 'On',
      Off: 'Off',
      Open: 'Open',
      Closed: 'Closed',
      Locked: 'Locked',
      Unlocked: 'Unlocked',
      Playing: 'Playing',
      Paused: 'Paused',
      Idle: 'Idle',
      Scene: 'Scene',
      Press: 'Press',
      Unavailable: 'n/a',
      'No entity': 'No entity',
      'No button': 'No button',
      Offline: 'Offline',
      'Not configured': 'Setup'
    },
    de_DE: {
      On: 'An',
      Off: 'Aus',
      Open: 'Offen',
      Closed: 'Zu',
      Locked: 'Zu',
      Unlocked: 'Offen',
      Playing: 'Läuft',
      Paused: 'Pause',
      Idle: 'Bereit',
      Scene: 'Szene',
      Press: 'Start',
      Unavailable: 'k.A.',
      'No entity': 'Keine',
      'No button': 'Kein Button',
      Offline: 'Offline',
      'Not configured': 'Setup'
    }
  };

  class I18n {
    constructor(language) {
      this.setLanguage(language || 'en');
    }

    setLanguage(language) {
      this.language = language;
      this._table = STRINGS[language] || STRINGS[String(language).split('_')[0]] || STRINGS.en;
    }

    t(key) {
      if (this._table && this._table[key]) return this._table[key];
      return STRINGS.en[key] || key;
    }
  }

  global.I18n = I18n;
})(window);
