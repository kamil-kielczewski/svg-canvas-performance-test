/* =============================================================================
 * renderer.js  --  Viewport + the COMMON RENDERER INTERFACE.
 *
 * Everything above this line (App, InteractionController, Benchmark, UI) talks
 * ONLY to this interface and therefore never knows whether it drives a Canvas
 * or an SVG tree.
 *
 *   setScene(scene, config, asset)   bind prepared geometry (no drawing)
 *   resize(w, h)                     viewport surface size changed
 *   setViewport(viewport)            pan / zoom transform changed
 *   clear()                          wipe the output surface
 *   setBackground(color)             backdrop colour (benchmark alternates it)
 *   renderScene()                    FULL render -- the benchmarked operation
 *   renderRoom/renderWall/renderIcon per-element primitives used by renderScene
 *   renderFrame()                    what one interactive frame costs for this
 *                                    technology (Canvas: full redraw,
 *                                    SVG: apply queued attribute updates)
 *   markFullDirty()                  force a full rebuild on the next frame
 *   updateRoomTransform(room)        incremental: a room's local transform changed
 *   updateRoomGeometry(room)         incremental: one wall segment was dragged
 *   updateIcon(icon)                 incremental: icon was dragged
 *   updateViewport()                 incremental: pan / zoom
 *   flush()                          force deferred rasterise/layout work
 *   destroy()
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});

  /** World -> screen: sx = x * scale + tx. No rotation, uniform scale. */
  class Viewport {
    constructor() { this.tx = 0; this.ty = 0; this.scale = 1; this.width = 1; this.height = 1; }
    toWorldX(sx) { return (sx - this.tx) / this.scale; }
    toWorldY(sy) { return (sy - this.ty) / this.scale; }
    toScreenX(x) { return x * this.scale + this.tx; }
    toScreenY(y) { return y * this.scale + this.ty; }
    panBy(dxScreen, dyScreen) { this.tx += dxScreen; this.ty += dyScreen; }
    /** Zoom keeping the world point under the cursor pinned to the cursor. */
    zoomAt(sx, sy, factor, minScale, maxScale) {
      const wx = this.toWorldX(sx), wy = this.toWorldY(sy);
      let s = this.scale * factor;
      s = Math.max(minScale || 1e-4, Math.min(maxScale || 1e4, s));
      this.scale = s;
      this.tx = sx - wx * s;
      this.ty = sy - wy * s;
    }
    fit(worldW, worldH, pad) {
      pad = pad == null ? 24 : pad;
      const s = Math.min((this.width - 2 * pad) / worldW, (this.height - 2 * pad) / worldH);
      this.scale = s > 0 ? s : 1;
      this.tx = (this.width - worldW * this.scale) / 2;
      this.ty = (this.height - worldH * this.scale) / 2;
    }
  }

  /** Abstract base: documents the contract, throws if a backend forgets one. */
  class Renderer {
    constructor(container) {
      this.container = container;
      this.scene = null;
      this.config = null;
      this.background = '#ffffff';
    }
    get kind() { return 'abstract'; }
    setScene() { throw new Error('not implemented'); }
    resize() { throw new Error('not implemented'); }
    setViewport(v) { this.viewport = v; }
    clear() { throw new Error('not implemented'); }
    setBackground(color) { this.background = color; }
    renderScene() { throw new Error('not implemented'); }
    renderRoom() { throw new Error('not implemented'); }
    renderWall() { throw new Error('not implemented'); }
    renderIcon() { throw new Error('not implemented'); }
    renderFrame() { this.renderScene(); }
    markFullDirty() {}
    updateRoomTransform() { this.markFullDirty(); }
    updateRoomGeometry() { this.markFullDirty(); }
    updateIcon() { this.markFullDirty(); }
    updateViewport() {}
    setSelection(sel) { this.selection = sel; }
    flush() {}
    destroy() {}
    /** Number of drawn primitives of the last full render (fairness check). */
    get primitiveCount() { return this._primitiveCount || 0; }
  }

  SQAR.Viewport = Viewport;
  SQAR.Renderer = Renderer;
})(window);
