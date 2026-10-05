/* =============================================================================
 * icon-asset.js  --  Shared SVG icon asset.
 *
 * ONE source of truth for the icon used by BOTH renderers:
 *
 *   SVG renderer    -> the raw markup is injected once into <defs> as a
 *                      <symbol>, instances are cheap <use> elements.
 *   Canvas renderer -> the markup is parsed ONCE into a flat list of
 *                      {path: Path2D, fill, stroke, strokeWidth, ...} draw ops.
 *                      Path2D accepts SVG path data verbatim, so the vector
 *                      shape (and therefore the pixels) stay equivalent.
 *
 * This parsing is part of the ASSET PREPARATION step. It happens once, before
 * any measurement, and is never part of the render benchmark.
 *
 * TO CHANGE THE ICON: replace DEFAULT_ICON_SVG below (same content as
 * assets/icon.svg). Keeping it inline means the app also works from file://
 * where fetch() of a local file is blocked by CORS. When served over http(s)
 * you can instead call SQAR.IconAsset.loadFromUrl('assets/icon.svg').
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});

  const DEFAULT_ICON_SVG = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"',
    '     stroke="#243447" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
    '  <path d="M4 10.5V7.2A2.2 2.2 0 0 1 6.2 5h11.6A2.2 2.2 0 0 1 20 7.2v3.3"/>',
    '  <path d="M4 10.5a2.2 2.2 0 0 1 2.2 2.2V15h11.6v-2.3a2.2 2.2 0 0 1 2.2-2.2 2 2 0 0 1 0 4v4.5H4V14.5a2 2 0 0 1 0-4z"/>',
    '  <path d="M7.6 15v-2.3h8.8V15"/>',
    '  <path d="M6.5 19.2v1.3M17.5 19.2v1.3"/>',
    '</svg>'
  ].join('\n');

  const SHAPE_TAGS = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'];
  const INHERITED = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity'];

  /* ---- element -> SVG path data -------------------------------------- */
  function shapeToPathData(el) {
    const n = (a, d) => {
      const v = parseFloat(el.getAttribute(a));
      return isNaN(v) ? (d || 0) : v;
    };
    switch (el.tagName.toLowerCase()) {
      case 'path':
        return el.getAttribute('d') || '';
      case 'rect': {
        const x = n('x'), y = n('y'), w = n('width'), h = n('height');
        const rx = Math.min(n('rx', n('ry')), w / 2);
        const ry = Math.min(n('ry', n('rx')), h / 2);
        if (rx > 0 && ry > 0) {
          return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}` +
                 `V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
                 `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
                 `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
        }
        return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      }
      case 'circle': {
        const cx = n('cx'), cy = n('cy'), r = n('r');
        return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
      }
      case 'ellipse': {
        const cx = n('cx'), cy = n('cy'), rx = n('rx'), ry = n('ry');
        return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
      }
      case 'line':
        return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
      case 'polyline':
      case 'polygon': {
        const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        if (pts.length < 4) return '';
        let d = `M${pts[0]} ${pts[1]}`;
        for (let i = 2; i + 1 < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
        return el.tagName.toLowerCase() === 'polygon' ? d + 'Z' : d;
      }
      default:
        return '';
    }
  }

  /* ---- minimal transform="" parser (translate/scale/rotate/matrix) ---- */
  function parseTransform(str) {
    let m = [1, 0, 0, 1, 0, 0];           // a b c d e f
    if (!str) return m;
    const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g;
    let t;
    while ((t = re.exec(str))) {
      const a = t[2].trim().split(/[\s,]+/).map(Number);
      let n;
      switch (t[1]) {
        case 'matrix':    n = [a[0], a[1], a[2], a[3], a[4], a[5]]; break;
        case 'translate': n = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
        case 'scale':     n = [a[0] || 1, 0, 0, (a.length > 1 ? a[1] : a[0]) || 1, 0, 0]; break;
        case 'rotate': {
          const r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
          n = [c, s, -s, c, 0, 0];
          if (a.length >= 3) {  // rotate(angle cx cy)
            m = mul(m, [1, 0, 0, 1, a[1], a[2]]);
            m = mul(m, n);
            n = [1, 0, 0, 1, -a[1], -a[2]];
          }
          break;
        }
      }
      m = mul(m, n);
    }
    return m;
  }
  function mul(p, q) {
    return [
      p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
      p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
      p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]
    ];
  }

  /* ---- full parse ---------------------------------------------------- */
  function parse(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName === 'parsererror') throw new Error('Invalid icon SVG');

    const vb = (root.getAttribute('viewBox') || '0 0 24 24').trim().split(/[\s,]+/).map(Number);
    const viewBox = { x: vb[0] || 0, y: vb[1] || 0, w: vb[2] || 24, h: vb[3] || 24 };

    const shapes = [];
    (function walk(el, inherited, matrix) {
      const style = Object.assign({}, inherited);
      INHERITED.forEach(function (a) {
        const v = el.getAttribute && el.getAttribute(a);
        if (v != null && v !== '') style[a] = v;
      });
      const m = mul(matrix, parseTransform(el.getAttribute && el.getAttribute('transform')));

      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (SHAPE_TAGS.indexOf(tag) >= 0) {
        const d = shapeToPathData(el);
        if (d) {
          shapes.push({
            d: d,
            matrix: m,
            fill: style.fill && style.fill !== 'none' ? style.fill : null,
            stroke: style.stroke && style.stroke !== 'none' ? style.stroke : null,
            strokeWidth: parseFloat(style['stroke-width']) || 1,
            lineCap: style['stroke-linecap'] || 'butt',
            lineJoin: style['stroke-linejoin'] || 'miter'
          });
        }
      }
      for (let c = el.firstElementChild; c; c = c.nextElementSibling) walk(c, style, m);
    })(root, { fill: 'none', stroke: null, 'stroke-width': '1' }, [1, 0, 0, 1, 0, 0]);

    // Canvas-side preparation: build the Path2D objects ONCE.
    const canvasOps = shapes.map(function (s) {
      return {
        path: new Path2D(s.d),
        matrix: s.matrix,
        fill: s.fill,
        stroke: s.stroke,
        strokeWidth: s.strokeWidth,
        lineCap: s.lineCap,
        lineJoin: s.lineJoin
      };
    });

    return {
      source: svgText,
      viewBox: viewBox,
      shapes: shapes,
      canvasOps: canvasOps,
      /** Inner markup of the <svg> element -- used to build the SVG <symbol>. */
      innerMarkup: root.innerHTML,
      rootAttrs: (function () {
        const o = {};
        for (let i = 0; i < root.attributes.length; i++) {
          const a = root.attributes[i];
          if (a.name !== 'xmlns' && a.name !== 'viewBox' && a.name !== 'width' && a.name !== 'height') {
            o[a.name] = a.value;
          }
        }
        return o;
      })()
    };
  }

  SQAR.IconAsset = {
    DEFAULT_ICON_SVG,
    parse,
    /** Parses the built-in icon (works from file://). */
    loadDefault() { return parse(DEFAULT_ICON_SVG); },
    /** Optional: load an external .svg when the app is served over http(s). */
    loadFromUrl(url) {
      return fetch(url).then((r) => r.text()).then(parse);
    }
  };
})(window);
