/**
 * A window you can pull a shutter down over.
 *
 * A percentage slider is technically enough, but nobody thinks about a blind in
 * percent — they think "down to about there". So the control *is* the window:
 * drag the bottom edge of the shutter, release, and the cover goes there.
 *
 * The geometry is a plain function so it can be tested; a wrong inversion here
 * would send 80 % when you asked for 20 %.
 */
(function (global) {
  'use strict';

  const doc = global.document;

  /**
   * Home Assistant counts 100 as fully open, and a shutter hangs from the top —
   * so the further down you drag, the smaller the number.
   *
   * @param {number} y      pointer position
   * @param {number} top    top edge of the window box
   * @param {number} height height of the window box
   * @returns {number} 0..100
   */
  function positionFromY(y, top, height) {
    if (!height) return 0;
    const bedeckt = (y - top) / height;
    const offen = 1 - bedeckt;
    return Math.min(100, Math.max(0, Math.round(offen * 100)));
  }

  /** How far down the shutter hangs, as a CSS percentage. */
  function coveredPercent(position) {
    const wert = Number(position);
    if (!isFinite(wert)) return 0;
    return Math.min(100, Math.max(0, 100 - wert));
  }

  function element(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * @param {object} options
   *   position   current position, 0..100
   *   onPreview  (percent) => void   while dragging
   *   onCommit   (percent) => void   on release
   * @returns {{node: HTMLElement, set: function}}
   */
  function coverField(options) {
    const opts = options || {};
    const onPreview = opts.onPreview || function () {};
    const onCommit = opts.onCommit || function () {};

    const node = element('div', 'ha-cover');
    const box = element('div', 'ha-cover-box');
    const shutter = element('div', 'ha-cover-shutter');
    const readout = element('div', 'ha-cover-readout');

    box.appendChild(shutter);
    box.appendChild(readout);
    node.appendChild(box);

    let position = Number(opts.position);
    if (!isFinite(position)) position = 0;
    let dragging = false;

    function paint(wert) {
      shutter.style.height = coveredPercent(wert) + '%';
      readout.textContent = Math.round(wert) + ' %';
    }

    function positionAt(event) {
      const rect = box.getBoundingClientRect();
      return positionFromY(event.clientY, rect.top, rect.height);
    }

    box.addEventListener('pointerdown', (event) => {
      dragging = true;
      box.setPointerCapture(event.pointerId);
      node.classList.add('dragging');
      position = positionAt(event);
      paint(position);
      onPreview(position);
      event.preventDefault();
    });

    box.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      position = positionAt(event);
      paint(position);
      onPreview(position);
    });

    function finish(event) {
      if (!dragging) return;
      dragging = false;
      node.classList.remove('dragging');
      try {
        box.releasePointerCapture(event.pointerId);
      } catch (err) {
        /* the pointer may already be gone */
      }
      // Only on release: a shutter motor should not chase every pixel.
      onCommit(position);
    }

    box.addEventListener('pointerup', finish);
    box.addEventListener('pointercancel', finish);

    paint(position);

    return {
      node: node,
      set: (wert) => {
        if (dragging) return; // never fight the hand that is dragging
        position = Number(wert);
        if (!isFinite(position)) position = 0;
        paint(position);
      }
    };
  }

  global.CoverControl = {
    coverField: coverField,
    positionFromY: positionFromY,
    coveredPercent: coveredPercent
  };
})(window);
