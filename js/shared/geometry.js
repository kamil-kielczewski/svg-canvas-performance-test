/* =============================================================================
 * geometry.js  --  Pure geometric helpers.
 *
 * ARCHITECTURE NOTE:
 * This module knows NOTHING about Canvas, SVG or the DOM. It only operates on
 * plain numbers / flat Float64Array point buffers:
 *
 *      polyline / polygon  =  [x0, y0, x1, y1, x2, y2, ...]
 *
 * Flat arrays are used on purpose: the scene can contain >100k polygons and
 * flat typed arrays keep allocation pressure (and therefore GC noise during the
 * benchmark) as low as possible.
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});

  const EPS = 1e-9;

  /**
   * Offsets an OPEN polyline by `dist` along its left normal, using mitered
   * joins at the interior vertices and butt caps at the two ends.
   *
   * The "left normal" of a direction (dx,dy) is (-dy, dx). With a screen-style
   * coordinate system (y pointing down) and the vertex order produced by
   * SceneGenerator, the left normal points towards the INSIDE of the room.
   * => offsetPolyline(pts, +t/2) gives the inner wall face,
   *    offsetPolyline(pts, -t/2) gives the outer wall face.
   */
  function offsetPolyline(pts, dist, out) {
    const n = pts.length >> 1;
    out = out || new Float64Array(pts.length);
    if (n < 2) { out.set(pts); return out; }

    const segCount = n - 1;
    const nx = new Float64Array(segCount);
    const ny = new Float64Array(segCount);

    for (let i = 0; i < segCount; i++) {
      const dx = pts[2 * i + 2] - pts[2 * i];
      const dy = pts[2 * i + 3] - pts[2 * i + 1];
      const l = Math.hypot(dx, dy) || 1;
      nx[i] = -dy / l;
      ny[i] = dx / l;
    }

    // First vertex: butt cap, use first segment normal.
    out[0] = pts[0] + nx[0] * dist;
    out[1] = pts[1] + ny[0] * dist;

    // Interior vertices: miter between the two adjacent segment normals.
    for (let i = 1; i < n - 1; i++) {
      let mx = nx[i - 1] + nx[i];
      let my = ny[i - 1] + ny[i];
      const ml = Math.hypot(mx, my);
      if (ml < 1e-6) {           // 180 degree fold -> degenerate, fall back
        mx = nx[i]; my = ny[i];
      } else {
        mx /= ml; my /= ml;
      }
      let cos = mx * nx[i] + my * ny[i];
      // Miter limit: never let a very sharp corner explode into infinity.
      if (Math.abs(cos) < 0.25) cos = cos < 0 ? -0.25 : 0.25;
      const s = dist / cos;
      out[2 * i] = pts[2 * i] + mx * s;
      out[2 * i + 1] = pts[2 * i + 1] + my * s;
    }

    // Last vertex: butt cap, use last segment normal.
    const li = n - 1;
    out[2 * li] = pts[2 * li] + nx[segCount - 1] * dist;
    out[2 * li + 1] = pts[2 * li + 1] + ny[segCount - 1] * dist;

    return out;
  }

  /** Squared distance from point (px,py) to segment (ax,ay)-(bx,by). */
  function pointSegmentDistSq(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 < EPS ? 0 : ((px - ax) * dx + (py - ay) * dy) / l2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const qx = ax + t * dx - px;
    const qy = ay + t * dy - py;
    return qx * qx + qy * qy;
  }

  /** Even-odd / crossing-number point in polygon test on a flat array. */
  function pointInPolygon(px, py, poly) {
    const n = poly.length >> 1;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[2 * i], yi = poly[2 * i + 1];
      const xj = poly[2 * j], yj = poly[2 * j + 1];
      if ((yi > py) !== (yj > py) &&
          px < ((xj - xi) * (py - yi)) / (yj - yi + EPS) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** Axis aligned bounding box of a flat polygon -> {minX,minY,maxX,maxY}. */
  function polyBBox(poly, box) {
    box = box || { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < poly.length; i += 2) {
      const x = poly[i], y = poly[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    box.minX = minX; box.minY = minY; box.maxX = maxX; box.maxY = maxY;
    return box;
  }

  /**
   * Serializes a flat polygon to an SVG path "d" string.
   * Used ONLY by the SVG renderer path, but kept here because it is a pure
   * geometry -> string conversion and is part of the cached geometry step.
   */
  function polyToPathData(poly, close) {
    if (poly.length < 4) return '';
    let d = 'M' + fmt(poly[0]) + ' ' + fmt(poly[1]);
    for (let i = 2; i < poly.length; i += 2) {
      d += 'L' + fmt(poly[i]) + ' ' + fmt(poly[i + 1]);
    }
    return close ? d + 'Z' : d;
  }

  /**
   * Deterministic number formatting for SVG attribute payloads.
   *
   * Precision must be RELATIVE, not absolute: deep hierarchy levels have local
   * coordinates far below 1 scene unit, and a fixed 2-decimal rounding used to
   * collapse them all to zero -- deep rooms existed in the model but rendered
   * as nothing. Above 1 unit we stay short (4 decimals); below it we keep 7
   * significant digits, which is ample for any depth that fits in memory.
   */
  function fmt(v) {
    if (!isFinite(v)) return 0;
    const a = v < 0 ? -v : v;
    if (a === 0) return 0;
    if (a >= 1) return Math.round(v * 1e4) / 1e4;
    return Number(v.toPrecision(7));
  }

  SQAR.Geometry = {
    EPS,
    offsetPolyline,
    pointSegmentDistSq,
    pointInPolygon,
    polyBBox,
    polyToPathData,
    fmt
  };
})(window);
