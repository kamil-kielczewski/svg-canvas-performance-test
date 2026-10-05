/* =============================================================================
 * svg-renderer.js  --  SVG/DOM backend of the common Renderer interface.
 *
 * Retained mode: the scene becomes a real SVG element tree. A "render" here
 * means CREATING / UPDATING DOM nodes -- that is the honest SVG analogue of
 * Canvas draw calls, and it is what the benchmark times.
 *
 * Like the Canvas backend it consumes ONLY the cached geometry produced by
 * GeometryBuilder (room.interiorPathData, wall.pathData, icon.*). No geometry
 * is computed here.
 *
 * Two render paths, both exposed through the common interface:
 *   renderScene()  -- FULL rebuild (clear + recreate every element). Used by
 *                     the benchmark so Canvas and SVG do comparable work.
 *   renderFrame()  -- one interactive frame. By default it applies only the
 *                     queued attribute updates, because that is how SVG is
 *                     really used. Switch "SVG: full rebuild every frame" on
 *                     to force the apples-to-apples behaviour.
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});
  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const fmt = SQAR.Geometry.fmt;
  const ICON_ID = 'sqar-icon-symbol';

  class SvgRenderer extends SQAR.Renderer {
    constructor(container) {
      super(container);
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'surface');
      svg.setAttribute('shape-rendering', 'auto');
      container.appendChild(svg);
      this.svg = svg;

      this.defs = document.createElementNS(NS, 'defs');
      svg.appendChild(this.defs);

      this.world = document.createElementNS(NS, 'g');
      this.world.setAttribute('class', 'world');
      svg.appendChild(this.world);

      // Element registries (renderer-private; the model stays DOM-free).
      this.roomGroups = new Map();
      this.roomInteriors = new Map();
      this.wallGroups = new Map();
      this.wallPaths = new Map();
      this.iconUses = new Map();

      this._fullDirty = true;
      this._pendingTransform = new Set();
      this._pendingGeometry = new Set();
      this._pendingIcons = new Set();
      this._pendingViewport = false;
      this._pendingSelection = false;
      this._selectedEl = null;
      this._primitiveCount = 0;
    }

    get kind() { return 'svg'; }

    setScene(scene, config, asset) {
      this.scene = scene;
      this.config = config;
      if (this.asset !== asset) { this.asset = asset; this._installSymbol(asset); }
      this.markFullDirty();
    }

    /** The icon is declared ONCE in <defs>; instances are cheap <use> nodes. */
    _installSymbol(asset) {
      this.defs.textContent = '';
      const sym = document.createElementNS(NS, 'symbol');
      sym.setAttribute('id', ICON_ID);
      const vb = asset.viewBox;
      sym.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
      sym.setAttribute('preserveAspectRatio', 'xMidYMid meet');  // == Canvas "meet"
      Object.keys(asset.rootAttrs).forEach((k) => sym.setAttribute(k, asset.rootAttrs[k]));
      sym.innerHTML = asset.innerMarkup;
      this.defs.appendChild(sym);
    }

    /** The SVG backdrop is a CSS layer -- no element, no change in counts. */
    setBackground(color) {
      this.background = color;
      this.svg.style.backgroundColor = color;
    }

    resize(w, h) {
      this.svg.setAttribute('width', w);
      this.svg.setAttribute('height', h);
      this.svg.style.width = w + 'px';
      this.svg.style.height = h + 'px';
    }

    clear() {
      this.world.textContent = '';
      this.roomGroups.clear();
      this.roomInteriors.clear();
      this.wallGroups.clear();
      this.wallPaths.clear();
      this.iconUses.clear();
      this._selectedEl = null;
    }

    markFullDirty() {
      this._fullDirty = true;
      this._pendingTransform.clear();
      this._pendingGeometry.clear();
      this._pendingIcons.clear();
    }

    /* ===================================================================== */
    /* ======================  RENDERING STARTS HERE  ====================== */
    /* ===================================================================== */

    /** FULL render: wipe the tree and recreate every element. Benchmarked op. */
    renderScene() {
      this._primitiveCount = 0;
      this.clear();
      this._applyViewport();
      const frag = document.createDocumentFragment();
      this.renderRoom(this.scene.root, frag);
      this.world.appendChild(frag);
      this._fullDirty = false;
      this._pendingViewport = false;
      this._applySelection();
    }

    /** One interactive frame: natural SVG = only touch what actually changed. */
    renderFrame() {
      if (this._fullDirty || this.config.svgFullRebuild) { this.renderScene(); return; }
      if (this._pendingViewport) { this._applyViewport(); this._pendingViewport = false; }
      this._pendingTransform.forEach((room) => {
        const g = this.roomGroups.get(room.id);
        if (g) g.setAttribute('transform', 'translate(' + fmt(room.tx) + ' ' + fmt(room.ty) + ')');
      });
      this._pendingTransform.clear();
      this._pendingGeometry.forEach((room) => this._applyRoomGeometry(room));
      this._pendingGeometry.clear();
      this._pendingIcons.forEach((icon) => this._applyIcon(icon));
      this._pendingIcons.clear();
      if (this._pendingSelection) { this._applySelection(); this._pendingSelection = false; }
    }

    renderRoom(room, parentNode) {
      const cfg = this.config;
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('data-room', room.id);
      g.setAttribute('transform', 'translate(' + fmt(room.tx) + ' ' + fmt(room.ty) + ')');
      this.roomGroups.set(room.id, g);

      if (cfg.showRooms) {
        const st = room.style;
        if (cfg.roomFill) {
          const p = document.createElementNS(NS, 'path');
          p.setAttribute('class', 'interior');
          p.setAttribute('d', room.interiorPathData);
          // SVG expresses alpha as a separate fill-opacity attribute; the
          // Canvas side uses the matching rgba() string -- identical
          // source-over result. Opaque mode emits no opacity at all.
          p.setAttribute('fill', st.interiorColor);
          if (st.interiorAlpha !== 1) p.setAttribute('fill-opacity', st.interiorAlpha);
          g.appendChild(p);
          this.roomInteriors.set(room.id, p);
          this._primitiveCount++;
        }
        // Wall paint is identical for the 5 segments -> declare it once on the
        // group and let SVG inheritance do the rest (mirrors the single canvas
        // state change per room in CanvasRenderer.renderRoom).
        const thick = cfg.wallMode === 'thick' && room.thickness > 0;
        const wg = document.createElementNS(NS, 'g');
        wg.setAttribute('class', 'walls');
        const filled = thick && cfg.wallFill;
        wg.setAttribute('fill', filled ? st.wallFillColor : 'none');
        if (filled && st.wallFillAlpha !== 1) wg.setAttribute('fill-opacity', st.wallFillAlpha);
        wg.setAttribute('stroke', st.wallStrokeColor);
        if (st.wallStrokeAlpha !== 1) wg.setAttribute('stroke-opacity', st.wallStrokeAlpha);
        wg.setAttribute('stroke-width', fmt(thick ? room.outlineWidth : room.lineWidth));
        wg.setAttribute('stroke-linejoin', 'miter');
        const paths = new Array(5);
        for (let i = 0; i < 5; i++) paths[i] = this.renderWall(room, room.walls[i], wg, i);
        g.appendChild(wg);
        this.wallGroups.set(room.id, wg);
        this.wallPaths.set(room.id, paths);
      }

      if (cfg.showIcons && room.icon) this.renderIcon(room.icon, g);

      const ch = room.children;
      for (let i = 0; i < ch.length; i++) this.renderRoom(ch[i], g);

      parentNode.appendChild(g);
      return g;
    }

    renderWall(room, wall, group, index) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('data-wall', index);
      p.setAttribute('d', wall.pathData);
      group.appendChild(p);
      this._primitiveCount++;
      return p;
    }

    renderIcon(icon, group) {
      const u = document.createElementNS(NS, 'use');
      u.setAttribute('data-icon', icon.id);
      u.setAttribute('href', '#' + ICON_ID);
      u.setAttributeNS(XLINK, 'xlink:href', '#' + ICON_ID);
      const s = icon.size;
      u.setAttribute('x', fmt(icon.x - s / 2));
      u.setAttribute('y', fmt(icon.y - s / 2));
      u.setAttribute('width', fmt(s));
      u.setAttribute('height', fmt(s));
      group.appendChild(u);
      this.iconUses.set(icon.id, u);
      this._primitiveCount++;
      return u;
    }

    /* ---------------- incremental updates (requirement #9) --------------- */

    updateRoomTransform(room) { if (!this._fullDirty) this._pendingTransform.add(room); }
    updateRoomGeometry(room) { if (!this._fullDirty) this._pendingGeometry.add(room); }
    updateIcon(icon) { if (!this._fullDirty) this._pendingIcons.add(icon); }
    updateViewport() { this._pendingViewport = true; }

    _applyViewport() {
      const v = this.viewport;
      this.world.setAttribute('transform',
        'translate(' + fmt(v.tx) + ' ' + fmt(v.ty) + ') scale(' + Number(v.scale.toPrecision(12)) + ')');
    }

    _applyRoomGeometry(room) {
      const paths = this.wallPaths.get(room.id);
      if (paths) for (let i = 0; i < 5; i++) paths[i].setAttribute('d', room.walls[i].pathData);
      const interior = this.roomInteriors.get(room.id);
      if (interior) interior.setAttribute('d', room.interiorPathData);
    }

    _applyIcon(icon) {
      const u = this.iconUses.get(icon.id);
      if (!u) return;
      const s = icon.size;
      u.setAttribute('x', fmt(icon.x - s / 2));
      u.setAttribute('y', fmt(icon.y - s / 2));
      u.setAttribute('width', fmt(s));
      u.setAttribute('height', fmt(s));
    }

    setSelection(sel) { this.selection = sel; this._pendingSelection = true; this._applySelection(); }

    _applySelection() {
      if (this._selectedEl) { this._selectedEl.classList.remove('selected'); this._selectedEl = null; }
      const sel = this.selection;
      if (!sel) return;
      let el = null;
      if (sel.type === 'icon') el = this.iconUses.get(sel.icon.id);
      else { const p = this.wallPaths.get(sel.room.id); el = p && p[sel.index]; }
      if (el) { el.classList.add('selected'); this._selectedEl = el; }
    }

    /**
     * Forces the browser to do the layout work it would otherwise defer.
     * (Paint/compositing still happens asynchronously -- see README notes.)
     */
    flush() { this.svg.getBoundingClientRect(); }

    destroy() { this.svg.remove(); }
  }

  SQAR.SvgRenderer = SvgRenderer;
})(window);
