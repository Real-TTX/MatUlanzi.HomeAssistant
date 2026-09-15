/**
 * The device a "context" key currently points at.
 *
 * This is the keypad answer to the rotary Smart Dialer other plugins offer:
 * the host has no encoder on this hardware and gives plugins no way to build or
 * switch a page, so instead one generic control page follows whatever device
 * you last picked. Long-press a thermostat, and the -1°/COOL/+1° keys aim at
 * that thermostat until the target expires.
 *
 * Deliberately dumb and free of side effects — the main service owns the single
 * instance and tells the keys when it changed.
 */
(function (global) {
  'use strict';

  /** Long enough to walk to another page, short enough not to surprise later. */
  const DEFAULT_TTL_MS = 120000;

  function TargetContext(options) {
    const opts = options || {};
    this.ttlMs = opts.ttlMs || DEFAULT_TTL_MS;
    this.now = opts.now || Date.now;
    this.log = opts.log || function () {};
    this._target = null;
    this._listeners = [];
  }

  TargetContext.prototype.on = function (listener) {
    this._listeners.push(listener);
    return () => {
      const at = this._listeners.indexOf(listener);
      if (at !== -1) this._listeners.splice(at, 1);
    };
  };

  TargetContext.prototype._emit = function () {
    for (const listener of this._listeners.slice()) {
      try {
        listener(this.get());
      } catch (err) {
        this.log('[target] listener failed: ' + (err && err.message));
      }
    }
  };

  /**
   * @param {string} entityId
   * @param {string} connectionId
   * @param {string} [name] what to show while this target is active
   */
  TargetContext.prototype.set = function (entityId, connectionId, name) {
    if (!entityId) return false;
    this._target = {
      entityId: entityId,
      connectionId: connectionId || '',
      name: name || '',
      at: this.now()
    };
    this.log('[target] now ' + entityId);
    this._emit();
    return true;
  };

  /** The current target, or null when nothing was picked or it expired. */
  TargetContext.prototype.get = function () {
    if (!this._target) return null;
    if (this.now() - this._target.at > this.ttlMs) {
      // Expired targets are dropped lazily: no timer to keep alive, and a key
      // asking is exactly the moment the answer matters.
      this._target = null;
      return null;
    }
    return {
      entityId: this._target.entityId,
      connectionId: this._target.connectionId,
      name: this._target.name
    };
  };

  /** Milliseconds until the target expires, 0 when there is none. */
  TargetContext.prototype.remaining = function () {
    if (!this.get()) return 0;
    return Math.max(0, this.ttlMs - (this.now() - this._target.at));
  };

  TargetContext.prototype.clear = function () {
    if (!this._target) return false;
    this._target = null;
    this.log('[target] cleared');
    this._emit();
    return true;
  };

  global.TargetContext = TargetContext;
})(window);
