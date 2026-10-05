/* =============================================================================
 * scene-generator.js  --  STEP 1 of the pipeline: SCENE GENERATION.
 *
 *      Configuration changed
 *            |
 *            v
 *   [1] SceneGenerator.generate()   <-- THIS FILE (topology + raw polylines)
 *            |
 *            v
 *   [2] GeometryBuilder.prepare()   <-- derived/cached render geometry
 *            |
 *            v
 *   [3] renderer.renderScene()      <-- the only thing the benchmark times
 *
 * The generator runs ONCE per configuration change. It never runs while the
 * user drags something.
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});
  const { Room, IconItem, SceneModel } = SQAR.Model;

  /**
   * A wall can never be thicker than the room that owns it. Without this clamp
   * the `minThickness` floor (and `constant` mode) would eventually make the
   * walls wider than the room, which used to abort the recursion a few levels
   * in. Clamping keeps every level geometrically valid, so the hierarchy can
   * keep going down indefinitely.
   */
  const MAX_THICKNESS_RATIO = 0.25;
  function clampToRoom(t, w, h) {
    return Math.min(t, Math.min(w, h) * MAX_THICKNESS_RATIO);
  }

  /** Wall thickness for a hierarchy level, in SCENE UNITS (never pixels). */
  function thicknessForLevel(cfg, level) {
    if (cfg.wallMode === 'line') return 0;
    if (cfg.thicknessMode === 'constant') return cfg.wallThickness;
    return Math.max(cfg.minThickness, cfg.wallThickness * Math.pow(cfg.thicknessDecay, level));
  }

  /** Centre-line stroke width for a hierarchy level (line mode), scene units. */
  function lineWidthForLevel(cfg, level) {
    if (cfg.thicknessMode === 'constant') return cfg.lineWidth;
    return Math.max(cfg.minThickness, cfg.lineWidth * Math.pow(cfg.thicknessDecay, level));
  }

  /** Fills the 6 point / 5 segment polyline of a room (local coordinates). */
  function buildPolyline(room, doorPercent) {
    const w = room.w, h = room.h;
    const doorW = Math.max(0, Math.min(w * 0.9, (doorPercent / 100) * w));
    const cx = w / 2;
    const p = room.points;
    p[0] = cx - doorW / 2; p[1] = h;   // P0 door jamb left
    p[2] = 0;              p[3] = h;   // P1 bottom-left
    p[4] = 0;              p[5] = 0;   // P2 top-left
    p[6] = w;              p[7] = 0;   // P3 top-right
    p[8] = w;              p[9] = h;   // P4 bottom-right
    p[10] = cx + doorW / 2; p[11] = h; // P5 door jamb right
  }

  function generate(cfg) {
    const counter = { n: 0 };           // -> cyclic colour index (room N -> N % 16)
    // Safety net, NOT a geometric limit: without it a few extra clicks on the
    // levels stepper would ask for millions of rooms and kill the tab.
    //
    // It is applied as a WHOLE-LEVEL limit, never as a running node counter:
    // a depth-first cut-off would leave one branch deep and its siblings empty,
    // and a lopsided scene is useless as a benchmark. So we keep the deepest
    // COMPLETE tree that fits the budget. `scene.budgetHit` reports when it bites.
    const budget = Math.max(1, cfg.maxRooms);
    let levelLimit = 1;
    while (levelLimit < cfg.levels && (Math.pow(4, levelLimit + 1) - 1) / 3 <= budget) levelLimit++;

    function makeRoom(level, w, h, tx, ty, parent) {
      const room = new Room(level, counter.n++, w, h, tx, ty, parent);
      room.thickness = clampToRoom(thicknessForLevel(cfg, level), w, h);
      room.lineWidth = clampToRoom(lineWidthForLevel(cfg, level), w, h);
      buildPolyline(room, cfg.doorPercent);

      const isLastLevel = level + 1 >= levelLimit;
      if (!isLastLevel) {
        // Inner usable rectangle = room rect inset by half the wall thickness
        // (so children never overlap the wall body) plus the configurable
        // margin between children and the parent walls.
        const minSide = Math.min(w, h);
        const inset = room.thickness / 2 + (cfg.wallMarginPercent / 100) * minSide;
        const ix = inset, iy = inset;
        const iw = w - 2 * inset, ih = h - 2 * inset;
        // Configurable margin BETWEEN sibling rooms.
        const gap = (cfg.childGapPercent / 100) * Math.min(iw, ih);
        const cw = (iw - gap) / 2;
        const ch = (ih - gap) / 2;

        // The ONLY limits are (a) real degeneracy -- children would have zero
        // or negative size, which can only happen with extreme margins -- and
        // (b) the explicit room budget below. There is deliberately NO absolute
        // minimum size: rooms shrink geometrically, so level N+1 must always be
        // drawable as long as level N was. `clampToRoom` guarantees the walls
        // shrink with the room instead of outgrowing it.
        const tiny = cfg.rootSize * 1e-9;        // float64 sanity floor only
        if (cw > tiny && ch > tiny) {
          for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 2; col++) {
              room.children.push(makeRoom(
                level + 1, cw, ch,
                ix + col * (cw + gap),
                iy + row * (ch + gap),
                room
              ));
            }
          }
        }
      }

      // Icons live on LEAF rooms only (rooms without children).
      if (!room.children.length) {
        // Size is finalised by the GeometryBuilder (it depends on config only);
        // the position is part of the model because the user can drag it.
        room.icon = new IconItem(room, w / 2, h / 2, 0);
      }
      return room;
    }

    const root = makeRoom(0, cfg.rootSize, cfg.rootSize, 0, 0, null);
    const scene = new SceneModel(root, cfg);
    scene.budgetHit = levelLimit < cfg.levels;
    return scene;
  }

  SQAR.SceneGenerator = { generate, thicknessForLevel, lineWidthForLevel, buildPolyline, clampToRoom };
})(window);
