/**
 * Draws a 196x196 key image and returns it as a PNG data URL for
 * $UD.setBaseDataIcon().
 *
 * Two modes:
 *   classic — room / value / name zones, colours and icons from the style
 *   html    — the user's own HTML+CSS, rendered via SVG foreignObject
 */
(function (global) {
  'use strict';

  const SIZE = 196;
  const FONT_STACK = '"Segoe UI", "Source Han Sans SC", "PingFang SC", sans-serif';

  const COLORS = {
    background: '#1e1f22',
    borderUnavailable: '#4a4d54',
    textIdle: '#eceef0',
    subIdle: '#9aa0a6',
    textUnavailable: '#71757c',
    textOnLight: '#14161a',
    textOnDark: '#ffffff'
  };

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  /** Relative luminance of a css rgb()/#hex colour, 0..1. */
  function luminance(color) {
    let r = 0;
    let g = 0;
    let b = 0;
    const rgb = /rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
    if (rgb) {
      r = Number(rgb[1]);
      g = Number(rgb[2]);
      b = Number(rgb[3]);
    } else {
      let hex = String(color).replace('#', '');
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
      if (hex.length < 6) return 0.5;
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  /** Largest font size (<= start) at which the text fits maxWidth. */
  function fitFontSize(ctx, text, maxWidth, start, min, weight) {
    let size = start;
    while (size > min) {
      ctx.font = weight + ' ' + size + 'px ' + FONT_STACK;
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 2;
    }
    ctx.font = weight + ' ' + size + 'px ' + FONT_STACK;
    return size;
  }

  /** Greedy word wrap, at most maxLines; dropped words become an ellipsis. */
  function wrapLines(ctx, text, maxWidth, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    let consumed = 0;
    let overflow = false;

    for (; consumed < words.length; consumed++) {
      const candidate = current ? current + ' ' + words[consumed] : words[consumed];
      if (!current || ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      lines.push(current);
      current = words[consumed];
      if (lines.length === maxLines) {
        overflow = true;
        break;
      }
    }
    if (current && !overflow) {
      if (lines.length < maxLines) lines.push(current);
      else overflow = true;
    }

    return lines.map((line, index) => {
      const isLast = index === lines.length - 1;
      return ellipsise(ctx, isLast && overflow ? line + '…' : line, maxWidth);
    });
  }

  function ellipsise(ctx, text, maxWidth) {
    let out = String(text);
    while (out.length > 1 && ctx.measureText(out).width > maxWidth) {
      out = out.slice(0, -2) + '…';
    }
    return out;
  }

  class KeyRenderer {
    /**
     * Deliberately stateless.
     *
     * One renderer is shared by every key, and drawing is asynchronous — it
     * waits for icons to load. A canvas held on the instance therefore had two
     * keys painting on it at once: the first drew its background, awaited its
     * icon, and meanwhile the second drew its own background over it. The
     * result was one key wearing another key’s picture. Each render now gets
     * its own canvas, so they cannot meet.
     */
    _newCanvas() {
      const canvas = global.document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      return { canvas: canvas, ctx: canvas.getContext('2d') };
    }

    /**
     * @param {object} view
     * @param {object}  view.ctx          template context (name, area, value, …)
     * @param {boolean} [view.active]
     * @param {boolean} [view.unavailable]
     * @param {string}  [view.accent]     colour derived from the entity
     * @param {number}  [view.progress]   0..1 fill bar
     * @param {boolean} [view.busy]       pending service call marker
     * @param {object} [style]            see KeyStyle.DEFAULT_STYLE
     * @returns {Promise<string>} PNG data URL
     */
    async render(view, style) {
      const merged = global.KeyStyle.baseStyle(style);
      if (merged.mode === 'html' && merged.html) {
        const image = await this._renderHtml(view, merged);
        if (image) return image;
        // Fall through to classic so a broken template never blanks the key.
      }
      return this._renderClassic(view, merged);
    }

    async _renderHtml(view, style) {
      const html = global.KeyStyle.resolveTemplate(style.html, view.ctx || {});
      const image = await global.KeyStyle.htmlToImage(html, SIZE);
      if (!image) return null;

      const flaeche = this._newCanvas();
      const ctx = flaeche.ctx;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(image, 0, 0, SIZE, SIZE);
      try {
        return flaeche.canvas.toDataURL('image/png');
      } catch (err) {
        return null; // tainted canvas — caller falls back to classic
      }
    }

    async _renderClassic(view, style) {
      const flaeche = this._newCanvas();
      const ctx = flaeche.ctx;
      const context = view.ctx || {};
      const active = Boolean(view.active) && !view.unavailable;

      const top = global.KeyStyle.resolveTemplate(style.top, context);
      const center = global.KeyStyle.resolveTemplate(style.center, context);
      const bottom = global.KeyStyle.resolveTemplate(style.bottom, context);

      const background = view.unavailable
        ? style.bg_unavailable
        : active
          ? style.bg_on || view.accent || '#3fa8f5'
          : style.bg_off;

      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = COLORS.background;
      ctx.fillRect(0, 0, SIZE, SIZE);

      const inset = 4;
      roundRect(ctx, inset, inset, SIZE - inset * 2, SIZE - inset * 2, Number(style.radius) || 28);
      ctx.fillStyle = background;
      ctx.fill();
      if (view.unavailable) {
        ctx.strokeStyle = COLORS.borderUnavailable;
        ctx.lineWidth = 3;
        if (ctx.setLineDash) ctx.setLineDash([9, 7]);
        ctx.stroke();
        if (ctx.setLineDash) ctx.setLineDash([]);
      }

      const bright = luminance(background) > 0.55;
      const configured = active ? style.text_on : style.text_off;
      const textColor = view.unavailable
        ? COLORS.textUnavailable
        : configured || (bright ? COLORS.textOnLight : COLORS.textOnDark);
      const subColor = view.unavailable
        ? COLORS.textUnavailable
        : configured
          ? configured
          : bright
            ? 'rgba(20,22,26,0.72)'
            : 'rgba(255,255,255,0.75)';

      // mdi: icons are tinted, so they need the text colour — hence loading them
      // only now that it is known.
      const iconSource = active ? style.icon_on || style.icon_off : style.icon_off;
      const icon = iconSource
        ? await global.KeyStyle.loadImage(iconSource, textColor)
        : null;

      const padding = 18;
      const maxWidth = SIZE - padding * 2;

      if (top) {
        ctx.fillStyle = subColor;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        fitFontSize(ctx, top, maxWidth - 14, 20, 14, 'bold');
        ctx.fillText(ellipsise(ctx, top, maxWidth - 14), padding, padding - 2);
      }

      if (view.busy) {
        ctx.beginPath();
        ctx.arc(SIZE - padding - 4, padding + 5, 5, 0, Math.PI * 2);
        ctx.fillStyle = subColor;
        ctx.fill();
      }

      const hasBar = style.show_bar !== '0' && typeof view.progress === 'number' && view.progress >= 0;
      const bottomLines = bottom ? 1 : 0;

      if (icon) {
        const size = Math.max(24, Math.min(120, Number(style.icon_size) || 64));
        const iconY = bottomLines ? 34 : 46;
        ctx.drawImage(icon, (SIZE - size) / 2, iconY, size, size);

        if (center) {
          ctx.fillStyle = textColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          fitFontSize(ctx, center, maxWidth, 32, 18, 'bold');
          ctx.fillText(center, SIZE / 2, iconY + size + 18);
        }
      } else if (center) {
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        fitFontSize(ctx, center, maxWidth, center.length > 4 ? 46 : 54, 22, 'bold');
        ctx.fillText(center, SIZE / 2, SIZE / 2 - 6);
      }

      if (bottom) {
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = 'bold 23px ' + FONT_STACK;
        const lines = wrapLines(ctx, bottom, maxWidth, icon ? 1 : 2);
        const baseline = SIZE - padding - (hasBar ? 14 : 0);
        const lineHeight = 25;
        lines.forEach((line, index) => {
          ctx.fillText(line, SIZE / 2, baseline - (lines.length - 1 - index) * lineHeight);
        });
      }

      if (hasBar) {
        const barX = padding + 2;
        const barW = SIZE - (padding + 2) * 2;
        const barY = SIZE - padding - 4;
        const barH = 7;
        roundRect(ctx, barX, barY, barW, barH, barH / 2);
        ctx.fillStyle = bright ? 'rgba(20,22,26,0.22)' : 'rgba(255,255,255,0.22)';
        ctx.fill();

        const filled = Math.max(0.02, Math.min(1, view.progress));
        roundRect(ctx, barX, barY, barW * filled, barH, barH / 2);
        ctx.fillStyle = bright ? 'rgba(20,22,26,0.85)' : 'rgba(255,255,255,0.9)';
        ctx.fill();
      }

      return flaeche.canvas.toDataURL('image/png');
    }
  }

  global.KeyRenderer = KeyRenderer;
})(window);
