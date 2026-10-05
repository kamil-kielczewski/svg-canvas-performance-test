/* =============================================================================
 * model.js  --  Renderer independent scene model.
 *
 * Nothing in this file references Canvas, SVG or the DOM.
 *
 * COORDINATE SYSTEM
 * -----------------
 * The scene is HIERARCHICAL. Every Room stores:
 *   - tx, ty  : its translation relative to its PARENT room's local origin
 *   - points  : its wall polyline in its OWN local space (origin at 0,0)
 *
 * That split is the key to requirement #9: dragging a whole room only mutates
 * two numbers (tx, ty) -- no geometry is regenerated at all. Dragging a single
 * wall segment mutates the local polyline and only THAT room's cached geometry
 * is rebuilt (5 wall polygons + 1 interior polygon).
 *
 * WALL POLYLINE
 * -------------
 * A room is a rectangle with exactly one door opening, encoded as an OPEN
 * polyline with 6 points = 5 segments (= 5 Wall objects):
 *
 *      P2 ------------------- P3          P0 : door jamb (left)
 *       |                     |           P1 : bottom-left corner
 *       |                     |           P2 : top-left corner
 *       |                     |           P3 : top-right corner
 *       |                     |           P4 : bottom-right corner
 *      P1 --- P0     P5 ----- P4          P5 : door jamb (right)
 *                 ^ door opening
 * ========================================================================== */
(function (global) {
  'use strict';
  const SQAR = (global.SQAR = global.SQAR || {});

  let nextId = 1;

  class Wall {
    /**
     * @param {Room} room   owner
     * @param {number} index segment index 0..4 (point index -> index, index+1)
     */
    constructor(room, index) {
      this.id = nextId++;
      this.room = room;
      this.index = index;
      // --- cached geometry (filled by GeometryBuilder, never by the renderer)
      this.poly = null;      // Float64Array(8): thick wall quad (surface geometry)
      this.pathData = '';    // SVG "d" of `poly` (thick) or of the centre line
      this.thickness = 0;
    }
    get ax() { return this.room.points[2 * this.index]; }
    get ay() { return this.room.points[2 * this.index + 1]; }
    get bx() { return this.room.points[2 * this.index + 2]; }
    get by() { return this.room.points[2 * this.index + 3]; }
  }

  class IconItem {
    constructor(room, x, y, size) {
      this.id = nextId++;
      this.room = room;
      this.x = x;          // local centre inside the owning room
      this.y = y;
      this.size = size;    // bounding box edge, scene units
      // cached placement (filled by GeometryBuilder)
      this.drawX = 0; this.drawY = 0; this.drawScale = 1;
    }
  }

  class Room {
    constructor(level, colorIndex, w, h, tx, ty, parent) {
      this.id = nextId++;
      this.level = level;
      this.colorIndex = colorIndex;
      this.w = w;
      this.h = h;
      this.tx = tx;              // <- mutated by "drag room"
      this.ty = ty;
      this.parent = parent || null;
      this.children = [];
      this.icon = null;
      this.thickness = 0;        // wall thickness in SCENE UNITS (never pixels)

      this.points = new Float64Array(12);   // 6 points -> 5 segments
      this.walls = [];
      for (let i = 0; i < 5; i++) this.walls.push(new Wall(this, i));

      // --- cached geometry / style (GeometryBuilder output) ---------------
      this.interiorPoly = null;      // Float64Array, closed inner face polygon
      this.interiorPathData = '';
      this.style = null;             // {interior, wallFill, wallStroke}
    }

    /** Accumulated world offset (walk to the root). Used for hit-testing. */
    worldOffset(out) {
      out = out || { x: 0, y: 0 };
      let x = 0, y = 0, r = this;
      while (r) { x += r.tx; y += r.ty; r = r.parent; }
      out.x = x; out.y = y;
      return out;
    }
  }

  class SceneModel {
    constructor(root, config) {
      this.root = root;
      this.config = config;
      this.roomsById = new Map();
      this.rooms = [];
      this.icons = [];
      this.wallCount = 0;
      this.leafCount = 0;
      this.index();
    }

    /** Flat indexes, built once after generation (not during rendering). */
    index() {
      this.rooms.length = 0;
      this.icons.length = 0;
      this.roomsById.clear();
      this.wallCount = 0;
      this.leafCount = 0;
      this.depth = 0;              // levels actually generated (see below)
      const stack = [this.root];
      while (stack.length) {
        const r = stack.pop();
        if (r.level + 1 > this.depth) this.depth = r.level + 1;
        this.rooms.push(r);
        this.roomsById.set(r.id, r);
        this.wallCount += r.walls.length;
        if (!r.children.length) this.leafCount++;
        if (r.icon) this.icons.push(r.icon);
        for (let i = 0; i < r.children.length; i++) stack.push(r.children[i]);
      }
    }

    get roomCount() { return this.rooms.length; }

    /**
     * The configured level count is an upper bound, not a promise: the
     * generator stops recursing as soon as children would be smaller than
     * their own walls. `depth` reports what was really built.
     */
    get depthRequested() { return this.config.levels; }
  }

  SQAR.Model = { Room, Wall, IconItem, SceneModel };
})(window);
