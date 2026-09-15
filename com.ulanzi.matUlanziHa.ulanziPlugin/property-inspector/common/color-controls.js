/**
 * Visual controls for colour, brightness and colour temperature.
 *
 * Built by hand instead of using `<input type="color">` because the native one
 * shows a swatch and hides everything else: you cannot see how warm 2700 K is,
 * and a brightness field that is just a number tells you nothing about what the
 * lamp will look like. Here every slider carries the colour it produces in its
 * own track.
 *
 * The maths lives at the top and is free of the DOM, which is the part worth
 * testing — a wrong conversion silently sends the wrong colour to a lamp.
 */
(function (global) {
  'use strict';

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function toByte(value) {
    return clamp(Math.round(value), 0, 255);
  }

  /**
   * Approximate colour of a black body radiator, so a temperature slider can
   * show roughly what the lamp will do. Tanner Helland's well-known fit.
   */
  function kelvinToRgb(kelvin) {
    const t = clamp(Number(kelvin) || 0, 1000, 40000) / 100;
    let r;
    let g;
    let b;

    if (t <= 66) {
      r = 255;
      g = 99.4708025861 * Math.log(t) - 161.1195681661;
      b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    } else {
      r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
      g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
      b = 255;
    }
    return [toByte(r), toByte(g), toByte(b)];
  }

  function hsvToRgb(h, s, v) {
    const hue = ((Number(h) || 0) % 360 + 360) % 360;
    const sat = clamp(Number(s) || 0, 0, 100) / 100;
    const val = clamp(Number(v) || 0, 0, 100) / 100;

    const c = val * sat;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = val - c;

    let rgb;
    if (hue < 60) rgb = [c, x, 0];
    else if (hue < 120) rgb = [x, c, 0];
    else if (hue < 180) rgb = [0, c, x];
    else if (hue < 240) rgb = [0, x, c];
    else if (hue < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];

    return rgb.map((part) => toByte((part + m) * 255));
  }

  function rgbToHsv(rgb) {
    const r = clamp(Number(rgb && rgb[0]) || 0, 0, 255) / 255;
    const g = clamp(Number(rgb && rgb[1]) || 0, 0, 255) / 255;
    const b = clamp(Number(rgb && rgb[2]) || 0, 0, 255) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;

    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [Math.round(h), Math.round(max === 0 ? 0 : (d / max) * 100), Math.round(max * 100)];
  }

  function rgbCss(rgb) {
    return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
  }

  /** Track for the temperature slider: the actual colours, end to end. */
  function kelvinGradient(min, max, steps) {
    const stufen = steps || 12;
    const stops = [];
    for (let i = 0; i <= stufen; i++) {
      const kelvin = min + ((max - min) * i) / stufen;
      stops.push(rgbCss(kelvinToRgb(kelvin)) + ' ' + Math.round((i / stufen) * 100) + '%');
    }
    return 'linear-gradient(to right, ' + stops.join(', ') + ')';
  }

  /** Track for the brightness slider: black to the colour actually chosen. */
  function brightnessGradient(rgb) {
    return 'linear-gradient(to right, #000 0%, ' + rgbCss(rgb || [255, 255, 255]) + ' 100%)';
  }

  const HUE_GRADIENT =
    'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)';

  /** Handy starting points, so nobody has to hunt for "warm white". */
  const SWATCHES = [
    { label: 'Warm', rgb: [255, 170, 90] },
    { label: 'Neutral', rgb: [255, 220, 180] },
    { label: 'Daylight', rgb: [255, 255, 245] },
    { label: 'Red', rgb: [255, 60, 40] },
    { label: 'Green', rgb: [70, 220, 90] },
    { label: 'Blue', rgb: [60, 130, 255] },
    { label: 'Purple', rgb: [170, 90, 255] }
  ];

  const doc = global.document;

  function element(tag, className) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function slider(min, max, step, value) {
    const input = element('input', 'ha-slider');
    input.type = 'range';
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    return input;
  }

  /**
   * Hue, saturation and brightness as three sliders that each show their own
   * result, plus a swatch row. A 2-D canvas picker would need drag handling and
   * would not survive the property inspector's narrow layout.
   *
   * @returns {{node: HTMLElement, get: function, set: function}}
   */
  function colorField(options) {
    const opts = options || {};
    const onChange = opts.onChange || function () {};

    const node = element('div', 'ha-color');
    const preview = element('div', 'ha-color-preview');
    const hue = slider(0, 360, 1, 30);
    const sat = slider(0, 100, 1, 80);
    const val = slider(0, 100, 1, 100);

    hue.style.background = HUE_GRADIENT;

    const rows = element('div', 'ha-color-rows');
    for (const input of [hue, sat, val]) rows.appendChild(input);

    const head = element('div', 'ha-color-head');
    head.appendChild(preview);
    head.appendChild(rows);
    node.appendChild(head);

    const swatches = element('div', 'ha-swatches');
    for (const swatch of SWATCHES) {
      const button = element('button', 'ha-swatch');
      button.type = 'button';
      button.title = swatch.label;
      button.style.background = rgbCss(swatch.rgb);
      button.addEventListener('click', () => {
        set(swatch.rgb);
        onChange();
      });
      swatches.appendChild(button);
    }
    node.appendChild(swatches);

    function current() {
      return hsvToRgb(hue.value, sat.value, val.value);
    }

    function paint() {
      const rgb = current();
      preview.style.background = rgbCss(rgb);
      // Saturation and brightness show where they are heading, at the current hue.
      const voll = hsvToRgb(hue.value, 100, 100);
      sat.style.background =
        'linear-gradient(to right, ' + rgbCss(hsvToRgb(hue.value, 0, val.value)) + ', ' + rgbCss(hsvToRgb(hue.value, 100, val.value)) + ')';
      val.style.background = 'linear-gradient(to right, #000, ' + rgbCss(voll) + ')';
    }

    function set(rgb) {
      const hsv = rgbToHsv(rgb || [255, 255, 255]);
      hue.value = hsv[0];
      sat.value = hsv[1];
      val.value = hsv[2];
      paint();
    }

    for (const input of [hue, sat, val]) {
      input.addEventListener('input', () => {
        paint();
        onChange();
      });
    }
    paint();

    return { node: node, get: current, set: set };
  }

  /** A brightness slider whose track runs from black to the chosen colour. */
  function brightnessField(options) {
    const opts = options || {};
    const onChange = opts.onChange || function () {};

    const node = element('div', 'ha-visual');
    const input = slider(0, 100, 1, opts.value === undefined ? 50 : opts.value);
    const readout = element('span', 'ha-readout');

    function paint() {
      input.style.background = brightnessGradient(opts.colorOf ? opts.colorOf() : null);
      readout.textContent = input.value + ' %';
    }

    input.addEventListener('input', () => {
      paint();
      onChange();
    });

    node.appendChild(input);
    node.appendChild(readout);
    paint();

    return {
      node: node,
      get: () => Number(input.value),
      set: (value) => {
        input.value = value === '' || value === undefined || value === null ? 50 : value;
        paint();
      },
      refresh: paint
    };
  }

  /** Colour temperature, with the warm-to-cool range visible in the track. */
  function kelvinField(options) {
    const opts = options || {};
    const onChange = opts.onChange || function () {};
    const min = opts.min || 2000;
    const max = opts.max || 6500;

    const node = element('div', 'ha-visual');
    const input = slider(min, max, 50, opts.value === undefined ? 3000 : opts.value);
    const readout = element('span', 'ha-readout');
    input.style.background = kelvinGradient(min, max);

    function paint() {
      readout.textContent = input.value + ' K';
      readout.style.color = rgbCss(kelvinToRgb(input.value));
    }

    input.addEventListener('input', () => {
      paint();
      onChange();
    });

    node.appendChild(input);
    node.appendChild(readout);
    paint();

    return {
      node: node,
      get: () => Number(input.value),
      set: (value) => {
        input.value = value === '' || value === undefined || value === null ? 3000 : value;
        paint();
      }
    };
  }

  /** A plain percentage slider with a readout — position, volume, speed. */
  function percentField(options) {
    const opts = options || {};
    const onChange = opts.onChange || function () {};

    const node = element('div', 'ha-visual');
    const input = slider(0, 100, 1, opts.value === undefined ? 50 : opts.value);
    const readout = element('span', 'ha-readout');

    function paint() {
      readout.textContent = input.value + ' %';
    }

    input.addEventListener('input', () => {
      paint();
      onChange();
    });

    node.appendChild(input);
    node.appendChild(readout);
    paint();

    return {
      node: node,
      get: () => Number(input.value),
      set: (value) => {
        input.value = value === '' || value === undefined || value === null ? 50 : value;
        paint();
      }
    };
  }

  global.ColorControls = {
    kelvinToRgb: kelvinToRgb,
    hsvToRgb: hsvToRgb,
    rgbToHsv: rgbToHsv,
    kelvinGradient: kelvinGradient,
    brightnessGradient: brightnessGradient,
    rgbCss: rgbCss,
    swatches: SWATCHES,
    colorField: colorField,
    brightnessField: brightnessField,
    kelvinField: kelvinField,
    percentField: percentField
  };
})(window);
