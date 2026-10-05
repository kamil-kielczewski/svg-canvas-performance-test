/* =============================================================================
 * canvas-interaction.js  --  Canvas specific half of the interaction layer.
 *
 * Canvas has no DOM nodes for the drawn shapes, so hit testing MUST be done
 * analytically. We delegate to the shared geometric picker, which works on the
 * very same cached geometry the renderer draws -> what you see is what you hit.
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});

  class CanvasInteraction {
    constructor(renderer) {
      this.renderer = renderer;
      this.element = renderer.canvas;
      this.controller = null;          // injected by App
    }
    /** Client (page) coordinates -> viewport/CSS pixel coordinates. */
    clientToScreen(cx, cy) {
      const r = this.element.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    }
    /** No native hit testing on Canvas -> shared analytic pick. */
    pick(e, wx, wy) {
      return this.controller.geometricPick(wx, wy);
    }
    setCursor(name) { this.element.style.cursor = name; }
  }

  SQAR.CanvasInteraction = CanvasInteraction;
})(window);
