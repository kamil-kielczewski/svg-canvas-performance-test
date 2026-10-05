/* =============================================================================
 * ui.js  --  Declarative configuration panel.
 *
 * The panel is generated from SQAR.ConfigSchema, so canvas.html and svg.html
 * expose EXACTLY the same options (plus the few renderer specific ones that
 * declare `only`). There is no hand written, per-page UI to drift apart.
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /**
   * @param {object} containers  { default: HTMLElement, [name]: HTMLElement }
   *        A schema section may declare `container: 'name'` to be rendered
   *        somewhere else in the sidebar (the Benchmark section goes next to
   *        the Benchmark buttons, above the render stats).
   */
  function buildPanel(containers, config, kind, onFieldChange) {
    const controls = {};
    let section = null;

    SQAR.ConfigSchema.forEach(function (f) {
      if (f.section) {
        section = el('section', 'panel-section');
        section.appendChild(el('h2', null, f.section));
        (containers[f.container] || containers.default).appendChild(section);
        return;
      }
      if (f.only && f.only !== kind) return;

      const row = el('div', 'row');
      // `highlight` marks the one setting that dominates the benchmark result.
      const label = el('label', 'row-label' + (f.highlight ? ' highlight' : ''), f.label);
      row.appendChild(label);

      const value = config.values[f.key];
      let primary;

      switch (f.type) {
        case 'range': {
          const wrap = el('div', 'range-wrap');
          const r = el('input');
          r.type = 'range'; r.min = f.min; r.max = f.max; r.step = f.step; r.value = value;
          const n = el('input', 'num');
          n.type = 'number'; n.min = f.min; n.max = f.max; n.step = f.step; n.value = value;
          const sync = (v, src) => {
            if (src !== r) r.value = v;
            if (src !== n) n.value = v;
            if (config.set(f.key, v)) onFieldChange(f);
          };
          r.addEventListener('input', () => sync(r.value, r));
          n.addEventListener('change', () => sync(n.value, n));
          wrap.appendChild(r); wrap.appendChild(n);
          if (f.unit) wrap.appendChild(el('span', 'unit', f.unit));
          row.appendChild(wrap);
          primary = { set: (v) => { r.value = v; n.value = v; } };
          break;
        }
        case 'stepper': {
          // Deliberately NOT a slider: a value with no upper bound cannot be
          // expressed by one, and stepping must be one level at a time.
          const wrap = el('div', 'stepper');
          const dec = el('button', 'step', '\u25C0');
          const inc = el('button', 'step', '\u25B6');
          const n = el('input', 'num step-val');
          n.type = 'number'; n.min = f.min; n.step = f.step; n.value = value;
          if (f.max != null) n.max = f.max;
          dec.title = 'one level less'; inc.title = 'one level more';
          const apply = (v) => {
            const changed = config.set(f.key, v);
            const cur = config.values[f.key];
            n.value = cur;
            dec.disabled = f.min != null && cur <= f.min;
            inc.disabled = f.max != null && cur >= f.max;
            if (changed) onFieldChange(f);
          };
          dec.addEventListener('click', () => apply(config.values[f.key] - f.step));
          inc.addEventListener('click', () => apply(config.values[f.key] + f.step));
          n.addEventListener('change', () => apply(n.value));
          // Left/right arrow keys do the same while the control has focus.
          wrap.addEventListener('keydown', (ev) => {
            if (ev.key === 'ArrowLeft') { apply(config.values[f.key] - f.step); ev.preventDefault(); }
            else if (ev.key === 'ArrowRight') { apply(config.values[f.key] + f.step); ev.preventDefault(); }
          });
          wrap.appendChild(dec); wrap.appendChild(n); wrap.appendChild(inc);
          if (f.unit) wrap.appendChild(el('span', 'unit', f.unit));
          row.appendChild(wrap);
          dec.disabled = f.min != null && value <= f.min;
          inc.disabled = f.max != null && value >= f.max;
          primary = { set: (v) => { n.value = v; dec.disabled = f.min != null && v <= f.min; } };
          break;
        }
        case 'number': {
          const n = el('input', 'num wide');
          n.type = 'number'; n.min = f.min; n.max = f.max; n.step = f.step; n.value = value;
          n.addEventListener('change', () => { if (config.set(f.key, n.value)) onFieldChange(f); });
          row.appendChild(n);
          primary = { set: (v) => { n.value = v; } };
          break;
        }
        case 'select': {
          const s = el('select');
          f.options.forEach(([v, t]) => {
            const o = el('option', null, t); o.value = v; s.appendChild(o);
          });
          s.value = value;
          s.addEventListener('change', () => { if (config.set(f.key, s.value)) onFieldChange(f); });
          row.appendChild(s);
          primary = { set: (v) => { s.value = v; } };
          break;
        }
        case 'bool': {
          const c = el('input');
          c.type = 'checkbox'; c.checked = !!value;
          c.addEventListener('change', () => { if (config.set(f.key, c.checked)) onFieldChange(f); });
          row.classList.add('row-bool');
          row.appendChild(c);
          primary = { set: (v) => { c.checked = !!v; } };
          break;
        }
        case 'color': {
          const c = el('input');
          c.type = 'color'; c.value = value;
          c.addEventListener('input', () => { if (config.set(f.key, c.value)) onFieldChange(f); });
          row.appendChild(c);
          primary = { set: (v) => { c.value = v; } };
          break;
        }
      }

      controls[f.key] = primary;
      section.appendChild(row);
      if (f.hint) section.appendChild(el('p', 'hint', f.hint));
    });

    return {
      controls,
      refresh() {
        Object.keys(controls).forEach((k) => controls[k] && controls[k].set(config.values[k]));
      }
    };
  }

  SQAR.UI = { buildPanel, el };
})(window);
