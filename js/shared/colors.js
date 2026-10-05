/* =============================================================================
 * colors.js  --  The shared 16 colour palette.
 *
 * A room's colour is picked cyclically from a 16 colour palette
 * (room 0 -> colour 0 ... room 16 -> colour 0). Every palette entry is expanded
 * into the three parts of a room, in ONE of two modes selected by the
 * "Transparent colours" switch:
 *
 *   TRANSPARENT (cfg.transparentColors = true)
 *     All three parts use the SAME colour and differ only in alpha:
 *       wall outline 1.0 | wall body 0.8 | room interior 0.2
 *
 *   OPAQUE (cfg.transparentColors = false)
 *     Three distinct, fully opaque shades derived by a pure HSL transform:
 *       wall outline  dark | wall body light | room interior lightest
 *
 * Every entry exposes BOTH forms the two backends need, so neither renderer has
 * to interpret anything at draw time:
 *   - roomFill / wallFill / wallStroke       ready-made CSS strings  (Canvas)
 *   - *Color + *Alpha pairs                  colour + fill-opacity   (SVG)
 * Both describe the exact same source-over composite -> identical pixels.
 *
 * Everything is derived deterministically, so Canvas and SVG always agree.
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});

  // 16 evenly spaced hues. Hard-coded (not computed) so the palette is a real,
  // reviewable palette and can be swapped for a brand palette if needed.
  const BASE = [
    '#d94a4a', '#d9774a', '#d9a44a', '#d9d14a',
    '#b4d94a', '#87d94a', '#4ad95a', '#4ad987',
    '#4ad9b4', '#4ad1d9', '#4aa4d9', '#4a77d9',
    '#4a4ad9', '#774ad9', '#a44ad9', '#d94ab4'
  ];

  /** The three alphas of the TRANSPARENT mode. */
  const ALPHA = { wallStroke: 1, wallFill: 0.8, roomFill: 0.2 };

  /** The three HSL lightness/saturation targets of the OPAQUE mode. */
  const SHADE = {
    roomFill: { s: 0.55, l: 0.925 },   // lightest
    wallFill: { s: 0.80, l: 0.760 },   // light
    wallStroke: { s: 0.95, l: 0.320 }  // darkest
  };

  /* ---------------------- colour space helpers ------------------------- */

  function hexToRgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }

  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function hslToHex(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    const to = (x) => {
      const v = Math.max(0, Math.min(255, Math.round(x * 255)));
      return v.toString(16).padStart(2, '0');
    };
    return '#' + to(r) + to(g) + to(b);
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function rgba(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return a >= 1 ? 'rgb(' + r + ',' + g + ',' + b + ')'
                  : 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /* ------------------------- variant building -------------------------- */

  function part(color, alpha) {
    return { css: alpha >= 1 ? color : rgba(color, alpha), color: color, alpha: alpha };
  }

  /** One base colour -> the three parts of a room, in the requested mode. */
  function variants(hex, transparent) {
    let room, wall, stroke;
    if (transparent) {
      room = part(hex, ALPHA.roomFill);
      wall = part(hex, ALPHA.wallFill);
      stroke = part(hex, ALPHA.wallStroke);
    } else {
      const [r, g, b] = hexToRgb(hex);
      const [h, s] = rgbToHsl(r, g, b);
      const shade = (k) => hslToHex(h, clamp01(s * SHADE[k].s), SHADE[k].l);
      room = part(shade('roomFill'), 1);
      wall = part(shade('wallFill'), 1);
      stroke = part(shade('wallStroke'), 1);
    }
    return {
      base: hex,
      // Canvas form: one ready-made CSS colour string per part.
      roomFill: room.css, wallFill: wall.css, wallStroke: stroke.css,
      // SVG form: colour + opacity per part.
      roomFillColor: room.color, roomFillAlpha: room.alpha,
      wallFillColor: wall.color, wallFillAlpha: wall.alpha,
      wallStrokeColor: stroke.color, wallStrokeAlpha: stroke.alpha
    };
  }

  // Both palettes are built once at load time -> deterministic, zero cost later.
  const PALETTES = {
    transparent: BASE.map((hex) => variants(hex, true)),
    opaque: BASE.map((hex) => variants(hex, false))
  };

  SQAR.Colors = {
    BASE,
    ALPHA,
    SHADE,
    PALETTES,
    SIZE: BASE.length,
    variants,
    rgba,
    /** Cyclic palette lookup: room N -> colour N % 16. */
    forIndex(i, transparent) {
      const p = transparent ? PALETTES.transparent : PALETTES.opaque;
      return p[((i % p.length) + p.length) % p.length];
    },
    hexToRgb, rgbToHsl, hslToHex
  };
})(window);
