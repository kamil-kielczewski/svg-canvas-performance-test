/* =============================================================================
 * configuration.js  --  Shared configuration + its UI schema.
 *
 * Every field declares `rebuild`, i.e. HOW MUCH of the pipeline must re-run
 * when it changes:
 *
 *   'scene'    -> SceneGenerator.generate() + GeometryBuilder.prepare()
 *   'geometry' -> GeometryBuilder.prepare()           (topology unchanged)
 *   'style'    -> GeometryBuilder.prepareStyles()     (colours only)
 *   'render'   -> nothing is recomputed, only re-render
 *
 * Dragging an element triggers NONE of these (see interaction-controller.js).
 *
 * The whole configuration is mirrored into location.hash so that canvas.html
 * and svg.html can be opened with byte-identical settings -- which is what
 * makes the comparison fair.
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});

  const SCHEMA = [
    { section: 'Scene' },
    // Unbounded on purpose: there is no upper limit, the stepper just counts up.
    // SceneGenerator stops recursing on its own once children would be smaller
    // than their own walls, so an absurd value can never recurse forever.
    { key: 'levels', label: 'Hierarchy levels', type: 'stepper', min: 1, step: 1, def: 6, rebuild: 'scene', highlight: true,
      hint: 'Rooms = (4^levels − 1) / 3 — 6:1365, 8:21845, 10:349525, 12:5.6M. There is NO cap: a high value will hang or crash the tab, on purpose.' },
    { key: 'rootSize', label: 'Root room size', type: 'range', min: 200, max: 4000, step: 50, def: 1200, unit: 'u', rebuild: 'scene' },
    { key: 'wallMarginPercent', label: 'Margin: child → parent wall', type: 'range', min: 0, max: 30, step: 0.5, def: 6, unit: '%', rebuild: 'scene' },
    { key: 'childGapPercent', label: 'Margin: between children', type: 'range', min: 0, max: 40, step: 0.5, def: 8, unit: '%', rebuild: 'scene' },
    { key: 'doorPercent', label: 'Door opening width', type: 'range', min: 0, max: 80, step: 1, def: 22, unit: '%', rebuild: 'scene' },
    { key: 'transparentColors', label: 'Transparent colours', type: 'bool', def: true, rebuild: 'style',
      hint: 'On: room, wall body and outline share one colour at alpha 0.2 / 0.8 / 1. Off: three opaque HSL shades.' },

    { section: 'Walls' },
    { key: 'wallMode', label: 'Wall mode', type: 'select', def: 'thick', rebuild: 'scene',
      options: [['line', 'Line (axis only)'], ['thick', 'Thick (surface geometry)']] },
    { key: 'wallThickness', label: 'Base thickness (level 0)', type: 'range', min: 0.5, max: 120, step: 0.5, def: 26, unit: 'u', rebuild: 'scene' },
    { key: 'thicknessMode', label: 'Thickness per level', type: 'select', def: 'decreasing', rebuild: 'scene',
      options: [['constant', 'Constant'], ['decreasing', 'Decreasing']] },
    { key: 'thicknessDecay', label: 'Decay factor / level', type: 'range', min: 0.2, max: 1, step: 0.01, def: 0.55, rebuild: 'scene',
      hint: 'Rooms shrink by ~0.4 per level. A larger decay makes deep walls proportionally thicker until they hit the 25 % of-room clamp that keeps the hierarchy valid; ~0.4 keeps every level self-similar.' },
    { key: 'minThickness', label: 'Min thickness', type: 'range', min: 0.1, max: 10, step: 0.1, def: 0.4, unit: 'u', rebuild: 'scene' },
    { key: 'lineWidth', label: 'Line width (line mode)', type: 'range', min: 0.2, max: 20, step: 0.2, def: 3, unit: 'u', rebuild: 'scene' },
    { key: 'outlinePercent', label: 'Wall outline width', type: 'range', min: 1, max: 40, step: 1, def: 12, unit: '% of t', rebuild: 'geometry' },
    // Room, wall body and wall outline share ONE colour and differ only in
    // alpha (1 / 0.8 / 0.2), so there is exactly one colour to pick.
    { key: 'baseColor', label: 'Base colour (uncoloured mode)', type: 'color', def: '#4a5a6b', rebuild: 'style',
      hint: 'Expanded into the three room parts by the same rule as a palette colour (see Transparent colours).' },

    { section: 'Rooms' },
    { key: 'showRooms', label: 'Show rooms', type: 'bool', def: true, rebuild: 'render' },
    { key: 'roomFill', label: 'Room interior fill', type: 'bool', def: true, rebuild: 'render' },
    { key: 'wallFill', label: 'Wall fill', type: 'bool', def: true, rebuild: 'render' },
    { key: 'colorRooms', label: 'Colour rooms (16 palette)', type: 'bool', def: true, rebuild: 'style' },

    { section: 'Icons' },
    { key: 'showIcons', label: 'Show icons', type: 'bool', def: true, rebuild: 'render' },
    { key: 'iconSizeMode', label: 'Icon sizing', type: 'select', def: 'proportional', rebuild: 'geometry',
      options: [['fixed', 'Fixed size'], ['proportional', 'Proportional to room']] },
    { key: 'iconSize', label: 'Icon size (fixed)', type: 'range', min: 1, max: 300, step: 1, def: 24, unit: 'u', rebuild: 'geometry' },
    { key: 'iconScalePercent', label: 'Icon size (proportional)', type: 'range', min: 5, max: 95, step: 1, def: 45, unit: '%', rebuild: 'geometry' },

    // Rendered into #bench-config, i.e. above the render stats, next to the
    // Benchmark buttons -- not into the main #panel.
    { section: 'Benchmark', container: 'bench' },
    { key: 'iterations', label: 'Benchmark iterations', type: 'number', min: 1, max: 100000, step: 1, def: 100, rebuild: 'none' },
    { key: 'benchFlush', label: 'Force rasterise/layout flush', type: 'bool', def: false, rebuild: 'none',
      hint: 'Adds a synchronous read-back after each render so deferred work is included.' },
    { key: 'svgFullRebuild', label: 'SVG: full rebuild every frame', type: 'bool', def: false, rebuild: 'render', only: 'svg',
      hint: 'Off = natural SVG behaviour (attribute updates). On = apples-to-apples with Canvas.' },
    { key: 'canvasPath2D', label: 'Canvas: cache Path2D objects', type: 'bool', def: false, rebuild: 'geometry', only: 'canvas',
      hint: 'Off = classic immediate-mode path commands. On = retained paths, the closest analogue of the SVG DOM.' }
  ];

  const FIELDS = SCHEMA.filter((f) => f.key);

  function defaults() {
    const o = {};
    FIELDS.forEach((f) => { o[f.key] = f.def; });
    return o;
  }

  function coerce(field, raw) {
    switch (field.type) {
      case 'range':
      case 'number':
      case 'stepper': {
        let v = parseFloat(raw);
        if (isNaN(v)) v = field.def;
        if (field.min != null) v = Math.max(field.min, v);
        if (field.max != null) v = Math.min(field.max, v);
        return v;
      }
      case 'bool': return raw === true || raw === '1' || raw === 'true';
      case 'select': return field.options.some((o) => o[0] === raw) ? raw : field.def;
      default: return String(raw);
    }
  }

  class Configuration {
    constructor(initial) {
      this.values = Object.assign(defaults(), initial || {});
      this._listeners = [];
      FIELDS.forEach((f) => {
        Object.defineProperty(this, f.key, {
          enumerable: true,
          get: () => this.values[f.key],
          set: (v) => this.set(f.key, v)
        });
      });
    }
    field(key) { return FIELDS.find((f) => f.key === key); }
    set(key, raw) {
      const f = this.field(key);
      const v = coerce(f, raw);
      if (this.values[key] === v) return false;
      this.values[key] = v;
      this._listeners.forEach((fn) => fn(key, v, f));
      return true;
    }
    onChange(fn) { this._listeners.push(fn); }

    /* ---- URL hash round-trip (keeps both pages in sync) ---------------- */
    toQuery() {
      return FIELDS.map((f) => {
        const v = this.values[f.key];
        return encodeURIComponent(f.key) + '=' +
          encodeURIComponent(f.type === 'bool' ? (v ? '1' : '0') : v);
      }).join('&');
    }
    static fromQuery(q) {
      const o = {};
      (q || '').replace(/^#/, '').split('&').forEach((pair) => {
        if (!pair) return;
        const i = pair.indexOf('=');
        const k = decodeURIComponent(pair.slice(0, i));
        const v = decodeURIComponent(pair.slice(i + 1));
        const f = FIELDS.find((x) => x.key === k);
        if (f) o[k] = coerce(f, v);
      });
      return new Configuration(o);
    }
  }

  SQAR.Configuration = Configuration;
  SQAR.ConfigSchema = SCHEMA;
  SQAR.ConfigFields = FIELDS;
})(window);
