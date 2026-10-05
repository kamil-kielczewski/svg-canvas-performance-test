/* =============================================================================
 * svg-interaction.js  --  SVG specific half of the interaction layer.
 *
 * SVG owns real DOM nodes, so the natural hit test is the browser's own:
 * `event.target` already tells us which element is under the cursor. We walk up
 * from it and read the data-* attributes the renderer stamped on the nodes.
 *
 * Fallback: when the pointer is over a NON-PAINTED area (e.g. room fill turned
 * off, or the transparent interior of a stroke-only icon) the DOM test returns
 * nothing. We then use the shared analytic picker so the interaction still
 * behaves the same as in the Canvas build.
 *
 * Room interiors resolve to `null` on purpose: dragging them pans the view, so
 * a room is grabbed by its walls (alt + drag grabs a single wall segment).
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});

  class SvgInteraction {
    constructor(renderer) {
      this.renderer = renderer;
      this.element = renderer.svg;
      this.controller = null;           // injected by App
    }

    clientToScreen(cx, cy) {
      const r = this.element.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    }

    /** NATIVE SVG hit testing first, shared geometric pick as a fallback. */
    pick(e, wx, wy) {
      const native = this._pickNative(e.target);
      return native || this.controller.geometricPick(wx, wy);
    }

    _pickNative(node) {
      const scene = this.controller.scene;
      let el = node, iconId = null, wallIndex = null;
      while (el && el !== this.element) {
        if (iconId === null && el.hasAttribute && el.hasAttribute('data-icon')) {
          iconId = +el.getAttribute('data-icon');
        }
        if (wallIndex === null && el.hasAttribute && el.hasAttribute('data-wall')) {
          wallIndex = +el.getAttribute('data-wall');
        }
        if (el.hasAttribute && el.hasAttribute('data-room')) {
          const room = scene.roomsById.get(+el.getAttribute('data-room'));
          if (!room) return null;
          if (iconId !== null && room.icon && room.icon.id === iconId) {
            return { type: 'icon', room: room, icon: room.icon };
          }
          if (wallIndex !== null) return { type: 'wall', room: room, index: wallIndex };
          // The interior fill is NOT a drag handle -- it is the pan surface,
          // exactly like in the Canvas build (see InteractionController).
          return null;
        }
        el = el.parentNode;
      }
      return null;
    }

    setCursor(name) { this.element.style.cursor = name; }
  }

  SQAR.SvgInteraction = SvgInteraction;
})(window);
