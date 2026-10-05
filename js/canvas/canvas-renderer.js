/* =============================================================================
 * canvas-renderer.js  --  Canvas 2D backend of the common Renderer interface.
 *
 * Immediate mode: every frame re-issues the draw calls for the whole scene.
 * That IS the natural Canvas model, so it is what we measure.
 *
 * It consumes ONLY the cached geometry produced by GeometryBuilder
 * (room.interiorPoly, wall.poly, icon.drawX/drawY/drawScale). No geometry is
 * ever computed inside this file -- everything below renderScene() is pure
 * rasterisation work.
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});

  const HILITE = '#ff2d7a';

  class CanvasRenderer extends SQAR.Renderer {
    constructor(container) {
      super(container);
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'surface';
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this.dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.background = '#ffffff';
      this._primitiveCount = 0;
      this.selection = null;
      this.asset = null;
    }

    get kind() { return 'canvas'; }

    setScene(scene, config, asset) {
      this.scene = scene;
      this.config = config;
      this.asset = asset;
      // Optional renderer-side geometry cache (still OUTSIDE the benchmark).
      this.rebuildPathCache();
    }

    /* ---- optional Path2D cache (geometry preparation, not rendering) ---- */
    rebuildPathCache() {
      const on = !!(this.config && this.config.canvasPath2D);
      this.usePath2D = on;
      if (!this.scene) return;
      const rooms = this.scene.rooms;
      for (let i = 0; i < rooms.length; i++) {
        if (on) this.buildRoomPathCache(rooms[i]);
        else { rooms[i]._p2dInterior = null; for (let k = 0; k < 5; k++) rooms[i].walls[k]._p2d = null; }
      }
    }
    buildRoomPathCache(room) {
      room._p2dInterior = new Path2D(room.interiorPathData);
      for (let k = 0; k < 5; k++) room.walls[k]._p2d = new Path2D(room.walls[k].pathData);
    }

    resize(w, h) {
      this.dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.round(w * this.dpr));
      this.canvas.height = Math.max(1, Math.round(h * this.dpr));
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
    }

    /** Canvas has no backdrop layer -- clear() IS the background repaint. */
    setBackground(color) { this.background = color; }

    clear() {
      const c = this.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = this.background || '#ffffff';
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /* ===================================================================== */
    /* ======================  RENDERING STARTS HERE  ====================== */
    /* ===================================================================== */

    /** FULL render of the scene -- this is the operation the benchmark times. */
    renderScene() {
      const c = this.ctx, v = this.viewport, d = this.dpr;
      this._primitiveCount = 0;
      this.clear();
      // World -> device transform (pan/zoom + devicePixelRatio) in ONE matrix.
      c.setTransform(d * v.scale, 0, 0, d * v.scale, d * v.tx, d * v.ty);
      c.lineJoin = 'miter';
      c.lineCap = 'butt';
      c.miterLimit = 4;
      this.renderRoom(this.scene.root);
      if (this.selection) this._renderSelection();
    }

    /** One frame of interaction == a full redraw (the Canvas way). */
    renderFrame() { this.renderScene(); }

    renderRoom(room) {
      const c = this.ctx, cfg = this.config;
      c.save();
      c.translate(room.tx, room.ty);          // hierarchical local transform

      if (cfg.showRooms) {
        const st = room.style;
        if (cfg.roomFill) {
          c.fillStyle = st.interior;
          if (this.usePath2D) c.fill(room._p2dInterior);
          else { this._tracePoly(room.interiorPoly, true); c.fill(); }
          this._primitiveCount++;
        }
        // Wall colours are identical for all 5 segments of a room -> set the
        // canvas state once per room (the Canvas analogue of SVG inheritance).
        const thick = cfg.wallMode === 'thick' && room.thickness > 0;
        c.strokeStyle = st.wallStroke;
        c.fillStyle = st.wallFill;
        c.lineWidth = thick ? room.outlineWidth : room.lineWidth;
        for (let i = 0; i < 5; i++) this.renderWall(room, room.walls[i], thick);
      }

      if (cfg.showIcons && room.icon) this.renderIcon(room.icon);

      const ch = room.children;
      for (let i = 0; i < ch.length; i++) this.renderRoom(ch[i]);
      c.restore();
    }

    renderWall(room, wall, thick) {
      const c = this.ctx;
      if (thick) {
        // Surface geometry: a filled polygon + a darker outline stroke.
        if (this.usePath2D) {
          if (this.config.wallFill) c.fill(wall._p2d);
          c.stroke(wall._p2d);
        } else {
          this._tracePoly(wall.poly, true);
          if (this.config.wallFill) c.fill();
          c.stroke();
        }
      } else {
        // Line mode: only the wall axis.
        c.beginPath();
        c.moveTo(wall.ax, wall.ay);
        c.lineTo(wall.bx, wall.by);
        c.stroke();
      }
      this._primitiveCount++;
    }

    renderIcon(icon) {
      const c = this.ctx, ops = this.asset.canvasOps;
      c.save();
      c.translate(icon.drawX, icon.drawY);
      c.scale(icon.drawScale, icon.drawScale);
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const m = op.matrix;
        const ident = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
        if (!ident) { c.save(); c.transform(m[0], m[1], m[2], m[3], m[4], m[5]); }
        if (op.fill) { c.fillStyle = op.fill; c.fill(op.path); }
        if (op.stroke) {
          c.strokeStyle = op.stroke;
          c.lineWidth = op.strokeWidth;
          c.lineCap = op.lineCap;
          c.lineJoin = op.lineJoin;
          c.stroke(op.path);
        }
        if (!ident) c.restore();
      }
      c.restore();
      c.lineCap = 'butt';
      c.lineJoin = 'miter';
      this._primitiveCount++;
    }

    /* ---------------------- internal helpers --------------------------- */

    _tracePoly(poly, close) {
      const c = this.ctx;
      c.beginPath();
      c.moveTo(poly[0], poly[1]);
      for (let i = 2; i < poly.length; i += 2) c.lineTo(poly[i], poly[i + 1]);
      if (close) c.closePath();
    }

    _renderSelection() {
      const sel = this.selection, c = this.ctx, v = this.viewport;
      const room = sel.room;
      const off = room.worldOffset();
      c.save();
      c.setTransform(this.dpr * v.scale, 0, 0, this.dpr * v.scale, this.dpr * v.tx, this.dpr * v.ty);
      c.translate(off.x, off.y);
      c.strokeStyle = HILITE;
      c.lineWidth = 2 / v.scale;             // constant ~2 screen pixels
      if (sel.type === 'icon') {
        const ic = sel.icon;
        c.strokeRect(ic.x - ic.size / 2, ic.y - ic.size / 2, ic.size, ic.size);
      } else {                       // 'wall' -- the only other drag handle
        const w = room.walls[sel.index];
        if (w.poly) { this._tracePoly(w.poly, true); c.stroke(); }
        else { c.beginPath(); c.moveTo(w.ax, w.ay); c.lineTo(w.bx, w.by); c.stroke(); }
      }
      c.restore();
    }

    /* ---- incremental updates: Canvas simply redraws (immediate mode) ---- */
    markFullDirty() { /* nothing retained -> nothing to invalidate */ }
    updateRoomTransform() { }
    updateRoomGeometry(room) { if (this.usePath2D) this.buildRoomPathCache(room); }
    updateIcon() { }
    updateViewport() { }

    /**
     * Forces the 2D context to finish the queued raster work. Used only when
     * "Force rasterise/layout flush" is enabled in the benchmark panel.
     */
    flush() { this.ctx.getImageData(0, 0, 1, 1); }

    destroy() { this.canvas.remove(); }
  }

  SQAR.CanvasRenderer = CanvasRenderer;
})(window);
