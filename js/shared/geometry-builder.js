/* =============================================================================
 * geometry-builder.js  --  STEP 2 of the pipeline: GEOMETRY PREPARATION.
 *
 * ============================ CACHE BOUNDARY ================================
 * EVERYTHING in this file runs OUTSIDE the render benchmark.
 * It turns the abstract model (polylines + numbers) into ready-to-draw data:
 *
 *   wall.poly          Float64Array(8)  -- the thick wall SURFACE polygon
 *   wall.pathData      string           -- same polygon as SVG path data
 *   room.interiorPoly  Float64Array     -- the room interior area polygon
 *   room.style         {interior, wallFill, wallStroke}
 *   icon.drawX/Y/Scale pre-multiplied placement for the Canvas renderer
 *
 * The renderers are then *pure consumers*: they only issue draw calls / create
 * DOM nodes from this cache. They never compute geometry.
 *
 * `prepare()`           -> full rebuild (configuration changed)
 * `buildRoomGeometry()` -> ONE room only (used while dragging a wall segment)
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});
  const G = SQAR.Geometry;
  const Colors = SQAR.Colors;

  /** Dark outline width of a thick wall, in scene units. */
  function outlineWidthFor(room, cfg) {
    return Math.max(room.thickness * (cfg.outlinePercent / 100), room.thickness * 0.02, 0.05);
  }

  /**
   * ---- styles (colours) -- cheap, re-runnable on its own -----------------
   * Resolves one palette entry (or the single "uncoloured" picker) into the
   * three parts of a room, honouring cfg.transparentColors. BOTH renderer
   * forms are precomputed here, outside any measurement:
   *   interior / wallFill / wallStroke   -> CSS colour strings, used by Canvas
   *   *Color + *Alpha                    -> colour + opacity,   used by SVG
   * The renderers never branch on the colour mode; they just read these.
   */
  function buildRoomStyle(room, cfg) {
    const v = cfg.colorRooms
      ? Colors.forIndex(room.colorIndex, cfg.transparentColors)
      : (cfg._uncolored || (cfg._uncolored = Colors.variants(cfg.baseColor, cfg.transparentColors)));
    room.style = {
      // Canvas
      interior: v.roomFill,
      wallFill: v.wallFill,
      wallStroke: v.wallStroke,
      // SVG
      interiorColor: v.roomFillColor, interiorAlpha: v.roomFillAlpha,
      wallFillColor: v.wallFillColor, wallFillAlpha: v.wallFillAlpha,
      wallStrokeColor: v.wallStrokeColor, wallStrokeAlpha: v.wallStrokeAlpha
    };
  }

  /** ---- geometry of ONE room (5 wall polygons + interior polygon) -------- */
  function buildRoomGeometry(room, cfg) {
    const pts = room.points;
    const thick = cfg.wallMode === 'thick' && room.thickness > 0;
    room.outlineWidth = thick ? outlineWidthFor(room, cfg) : 0;

    if (thick) {
      const t = room.thickness / 2;
      // Left normal points INSIDE the room (see model.js), so +t = inner face.
      const inner = G.offsetPolyline(pts, +t, room._innerBuf || (room._innerBuf = new Float64Array(12)));
      const outer = G.offsetPolyline(pts, -t, room._outerBuf || (room._outerBuf = new Float64Array(12)));

      for (let i = 0; i < 5; i++) {
        const w = room.walls[i];
        let q = w.poly;
        if (!q) q = w.poly = new Float64Array(8);
        // Wall body = quad between the outer and the inner face of the segment.
        q[0] = outer[2 * i];     q[1] = outer[2 * i + 1];
        q[2] = outer[2 * i + 2]; q[3] = outer[2 * i + 3];
        q[4] = inner[2 * i + 2]; q[5] = inner[2 * i + 3];
        q[6] = inner[2 * i];     q[7] = inner[2 * i + 1];
        w.thickness = room.thickness;
        w.pathData = G.polyToPathData(q, true);
      }
      // Room interior = inner face polyline closed across the door opening.
      room.interiorPoly = Float64Array.from(inner);
      room.interiorPathData = G.polyToPathData(room.interiorPoly, true);
    } else {
      for (let i = 0; i < 5; i++) {
        const w = room.walls[i];
        w.poly = null;
        w.thickness = room.lineWidth;
        w.pathData = 'M' + G.fmt(pts[2 * i]) + ' ' + G.fmt(pts[2 * i + 1]) +
                     'L' + G.fmt(pts[2 * i + 2]) + ' ' + G.fmt(pts[2 * i + 3]);
      }
      room.interiorPoly = Float64Array.from(pts);
      room.interiorPathData = G.polyToPathData(room.interiorPoly, true);
    }
  }

  /** ---- icon placement (mirrors SVG <use> + preserveAspectRatio meet) ---- */
  function buildIcon(icon, cfg, asset) {
    const room = icon.room;
    icon.size = cfg.iconSizeMode === 'fixed'
      ? cfg.iconSize
      : (cfg.iconScalePercent / 100) * Math.min(room.w, room.h);

    const vb = asset.viewBox;
    const s = Math.min(icon.size / vb.w, icon.size / vb.h);   // "meet"
    icon.drawScale = s;
    // top-left of the size x size box + centring offset - viewBox origin
    icon.drawX = icon.x - icon.size / 2 + (icon.size - vb.w * s) / 2 - vb.x * s;
    icon.drawY = icon.y - icon.size / 2 + (icon.size - vb.h * s) / 2 - vb.y * s;
  }

  /** ---- full preparation pass (configuration changed) -------------------- */
  function prepare(scene, cfg, asset) {
    cfg._uncolored = null;
    const rooms = scene.rooms;
    for (let i = 0; i < rooms.length; i++) {
      buildRoomStyle(rooms[i], cfg);
      buildRoomGeometry(rooms[i], cfg);
    }
    const icons = scene.icons;
    for (let i = 0; i < icons.length; i++) buildIcon(icons[i], cfg, asset);
    scene.prepared = true;
    return scene;
  }

  /** ---- style-only pass (colour toggles) --------------------------------- */
  function prepareStyles(scene, cfg) {
    cfg._uncolored = null;            // the picker may have changed
    for (let i = 0; i < scene.rooms.length; i++) buildRoomStyle(scene.rooms[i], cfg);
  }

  SQAR.GeometryBuilder = { prepare, prepareStyles, buildRoomGeometry, buildRoomStyle, buildIcon };
})(window);
