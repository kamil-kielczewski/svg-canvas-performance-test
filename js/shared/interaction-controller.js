/* =============================================================================
 * interaction-controller.js  --  SHARED interaction / controller layer.
 *
 *        InteractionController      <-- this file (technology agnostic)
 *                 |
 *                 v
 *        RendererInteraction        <-- CanvasInteraction / SvgInteraction
 *                 |
 *                 v
 *        CanvasRenderer / SvgRenderer
 *
 * The controller owns ALL behaviour (what a drag means, how zoom works, which
 * model fields change). The renderer-specific layer only supplies:
 *    - the DOM element that receives pointer events,
 *    - client -> viewport coordinate conversion,
 *    - an optional NATIVE hit test (SVG uses event.target, Canvas cannot).
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DRAGGABLE
 *    Exactly two things: a single WALL SEGMENT and an ICON. Dragging a wall
 *    DEFORMS its room -- it moves two vertices of that room's polyline and
 *    nothing else. The room's contents (child rooms, icons) keep their own
 *    local positions and therefore stay put. Whole rooms are intentionally not
 *    movable, so a drag never carries a subtree along with it.
 *
 * REQUIREMENT #9 -- dragging never regenerates the scene:
 *    drag wall  -> 2 points of ONE polyline   (1 room's geometry rebuilt: 5+1 polys)
 *    drag icon  -> icon.x/y                   (0 geometry rebuilt)
 *    pan / zoom -> viewport only              (0 geometry rebuilt)
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});
  const G = SQAR.Geometry;
  const GB = SQAR.GeometryBuilder;

  const PICK_TOLERANCE_PX = 6;

  class InteractionController {
    constructor(opts) {
      this.scene = opts.scene;
      this.config = opts.config;
      this.viewport = opts.viewport;
      this.renderer = opts.renderer;
      this.host = opts.host;              // renderer-specific interaction
      this.onChange = opts.onChange || function () {};
      this.onSelection = opts.onSelection || function () {};

      this.selection = null;
      this.drag = null;
      this.hover = null;
      // Wide on purpose: a level-10 room is ~1e-4 scene units across, so the
      // user must be able to zoom far enough in to actually see the deep levels.
      this.minScale = 1e-6;
      this.maxScale = 1e9;

      this._bind();
    }

    setScene(scene) { this.scene = scene; this.selection = null; this.drag = null; }

    /* ================= hit testing (pure geometry, shared) ============== */

    /**
     * Depth-first, children (= visually on top) first.
     * Only ICONS and WALLS are pickable; the room interior stays free so that
     * dragging anywhere inside the drawing always pans the view.
     * @returns {null|{type:'icon'|'wall', room, index?, icon?}}
     */
    geometricPick(wx, wy) {
      const cfg = this.config;
      const tol = PICK_TOLERANCE_PX / this.viewport.scale;   // px -> scene units
      const self = this;

      function visit(room, accX, accY) {
        const ox = accX + room.tx, oy = accY + room.ty;
        const lx = wx - ox, ly = wy - oy;

        // Cheap reject: outside the room's rectangle (+ generous margin).
        const m = room.thickness + tol + 1;
        if (lx < -m || ly < -m || lx > room.w + m || ly > room.h + m) return null;

        for (let i = room.children.length - 1; i >= 0; i--) {
          const hit = visit(room.children[i], ox, oy);
          if (hit) return hit;
        }

        if (cfg.showIcons && room.icon) {
          const ic = room.icon, h = ic.size / 2;
          if (lx >= ic.x - h && lx <= ic.x + h && ly >= ic.y - h && ly <= ic.y + h) {
            return { type: 'icon', room: room, icon: ic };
          }
        }

        if (cfg.showRooms) {
          for (let i = 0; i < room.walls.length; i++) {
            const w = room.walls[i];
            if (w.poly && G.pointInPolygon(lx, ly, w.poly)) return { type: 'wall', room: room, index: i };
            const r = Math.max(w.thickness / 2, tol);
            if (G.pointSegmentDistSq(lx, ly, w.ax, w.ay, w.bx, w.by) <= r * r) {
              return { type: 'wall', room: room, index: i };
            }
          }
          // NOTE: the room INTERIOR is deliberately NOT a pick target -- it is
          // the pan surface. A room is grabbed by its WALLS (see _pointerDown).
        }
        return null;
      }

      return visit(self.scene.root, 0, 0);
    }

    /* ======================= event plumbing ============================= */

    _bind() {
      const el = this.host.element;
      el.style.touchAction = 'none';
      this._onDown = this._pointerDown.bind(this);
      this._onMove = this._pointerMove.bind(this);
      this._onUp = this._pointerUp.bind(this);
      this._onWheel = this._wheel.bind(this);
      el.addEventListener('pointerdown', this._onDown);
      el.addEventListener('pointermove', this._onMove);
      window.addEventListener('pointerup', this._onUp);
      el.addEventListener('wheel', this._onWheel, { passive: false });
      // The context menu is intentionally NOT suppressed -- right click must
      // still open the browser's own menu (inspect, save image, ...).

    }

    destroy() {
      const el = this.host.element;
      el.removeEventListener('pointerdown', this._onDown);
      el.removeEventListener('pointermove', this._onMove);
      window.removeEventListener('pointerup', this._onUp);
      el.removeEventListener('wheel', this._onWheel);
    }

    /**
     * Button mapping:
     *   right button          -> nothing, the browser shows its context menu
     *   middle button, shift  -> pan
     *   drag on an ICON       -> move that icon
     *   drag on a WALL        -> move that single wall SEGMENT (deforms the room)
     *   drag anywhere else    -> pan (room interiors are free on purpose)
     */
    _pointerDown(e) {
      if (e.button === 2) return;        // leave the right button to the browser

      const p = this.host.clientToScreen(e.clientX, e.clientY);
      const wx = this.viewport.toWorldX(p.x), wy = this.viewport.toWorldY(p.y);

      const forcePan = e.button === 1 || e.shiftKey;
      const target = forcePan ? null : this.host.pick(e, wx, wy);

      // Pointer capture keeps the drag alive when the cursor leaves the surface.
      try { this.host.element.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }

      if (!target) {
        this.drag = { mode: 'pan', lastX: p.x, lastY: p.y };
        this.setSelection(null);
      } else {
        // target.type is 'icon' or 'wall' -- those are the only drag handles.
        this.setSelection(target);
        this.drag = { mode: target.type, target: target, lastWX: wx, lastWY: wy };
      }
      this.host.setCursor(this.drag.mode === 'pan' ? 'grabbing' : 'move');
      this.onChange('interaction-start');
      e.preventDefault();
    }

    _pointerMove(e) {
      const p = this.host.clientToScreen(e.clientX, e.clientY);
      if (!this.drag) {
        // Hover feedback only (no rendering work beyond the cursor).
        const wx = this.viewport.toWorldX(p.x), wy = this.viewport.toWorldY(p.y);
        const t = this.host.pick(e, wx, wy);
        this.host.setCursor(t ? 'move' : 'grab');
        this.hover = t;
        return;
      }

      if (this.drag.mode === 'pan') {
        this.viewport.panBy(p.x - this.drag.lastX, p.y - this.drag.lastY);
        this.drag.lastX = p.x; this.drag.lastY = p.y;
        this.renderer.updateViewport();
        this.onChange('viewport');
        return;
      }

      const wx = this.viewport.toWorldX(p.x), wy = this.viewport.toWorldY(p.y);
      // Uniform scale + no rotation => a world delta is valid in every local space.
      const dx = wx - this.drag.lastWX, dy = wy - this.drag.lastWY;
      this.drag.lastWX = wx; this.drag.lastWY = wy;
      const t = this.drag.target;

      switch (this.drag.mode) {
        case 'wall': {
          // --- move both endpoints of the segment; neighbours stay attached
          //     because the polyline shares its vertices. Only THIS room's
          //     cached geometry (5 wall polys + interior) is rebuilt.
          //     The room's CONTENTS are untouched: child rooms and icons carry
          //     their own local transforms, so deforming the shell never drags
          //     the subtree along. ---
          const pts = t.room.points, i = t.index;
          pts[2 * i] += dx;       pts[2 * i + 1] += dy;
          pts[2 * i + 2] += dx;   pts[2 * i + 3] += dy;
          GB.buildRoomGeometry(t.room, this.config);
          this.renderer.updateRoomGeometry(t.room);
          this.onChange('wall-moved');
          break;
        }
        case 'icon': {
          // --- 2 numbers change. NO geometry is regenerated. ---
          t.icon.x += dx; t.icon.y += dy;
          GB.buildIcon(t.icon, this.config, this.renderer.asset);
          this.renderer.updateIcon(t.icon);
          this.onChange('icon-moved');
          break;
        }
      }
    }

    _pointerUp() {
      if (!this.drag) return;
      this.drag = null;
      this.host.setCursor('grab');
      this.onChange('interaction-end');
    }

    _wheel(e) {
      e.preventDefault();
      const p = this.host.clientToScreen(e.clientX, e.clientY);
      // Normalise the delta across deltaMode (pixel / line / page).
      let d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= 400;
      const factor = Math.exp(-d * 0.0015);
      // Zoom around the cursor: the world point under it stays put.
      this.viewport.zoomAt(p.x, p.y, factor, this.minScale, this.maxScale);
      this.renderer.updateViewport();
      this.onChange('viewport');
    }

    setSelection(target) {
      this.selection = target;
      this.renderer.setSelection(target);
      this.onSelection(target);
    }
  }

  SQAR.InteractionController = InteractionController;
  SQAR.PICK_TOLERANCE_PX = PICK_TOLERANCE_PX;
})(window);
