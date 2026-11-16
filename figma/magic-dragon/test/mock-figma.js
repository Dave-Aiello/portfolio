/* A stand-in for the Figma plugin API, for running plugin/code.js in Node.
   It records every node and enforces the rules real Figma enforces, so mistakes
   fail here instead of in Dave's Figma: fonts loaded before any text edit, valid
   paint/effect/reaction objects, images are PNG/JPEG/GIF no larger than 4096 px,
   nothing appended inside an instance, prototype destinations are top-level frames
   on the same page, currentPage only changed through setCurrentPageAsync. */
const crypto = require("crypto");

function createMock(opts) {
  opts = opts || {};
  const fonts = opts.fonts || [];
  const loaded = new Set();
  const fontKey = (f) => f.family + "|" + f.style;
  let seq = 0;
  const nodes = new Map();
  const images = new Map();
  const variables = new Map();
  const collections = [];
  const textStyles = new Map();
  const notes = { notify: [], close: null, deprecations: [] };
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });

  const fail = (msg) => { throw new Error(msg); };
  const isNum = (v) => typeof v === "number" && isFinite(v);
  const inRange = (v, a, b) => isNum(v) && v >= a && v <= b;
  const oneOf = (v, list, what) => { if (list.indexOf(v) < 0) fail("Invalid " + what + ": " + JSON.stringify(v)); };
  function keysOnly(o, allowed, what) {
    if (!o || typeof o !== "object") fail(what + " must be an object");
    for (const k of Object.keys(o)) if (allowed.indexOf(k) < 0) fail("Unrecognized key \"" + k + "\" in " + what);
  }
  function rgbCheck(c, alpha, what) {
    keysOnly(c, alpha ? ["r", "g", "b", "a"] : ["r", "g", "b"], what);
    for (const k of alpha ? ["r", "g", "b", "a"] : ["r", "g", "b"]) if (!inRange(c[k], 0, 1)) fail(what + "." + k + " must be 0..1, got " + c[k]);
  }
  function matrixCheck(m, what) {
    if (!Array.isArray(m) || m.length !== 2 || m.some((r) => !Array.isArray(r) || r.length !== 3 || r.some((v) => !isNum(v)))) fail(what + " must be a 2x3 matrix");
  }
  function checkPaint(p) {
    if (!p || typeof p !== "object") fail("Paint must be an object");
    if (p.type === "SOLID") {
      keysOnly(p, ["type", "color", "opacity", "visible", "blendMode", "boundVariables"], "SOLID paint");
      rgbCheck(p.color, false, "paint.color");
      if (p.opacity !== undefined && !inRange(p.opacity, 0, 1)) fail("paint.opacity must be 0..1");
      if (p.boundVariables) {
        const v = p.boundVariables.color;
        if (!v || v.type !== "VARIABLE_ALIAS" || !variables.has(v.id)) fail("boundVariables.color must alias a variable");
      }
    } else if (p.type === "IMAGE") {
      keysOnly(p, ["type", "imageHash", "scaleMode", "imageTransform", "scalingFactor", "rotation", "filters", "opacity", "visible", "blendMode"], "IMAGE paint");
      if (!images.has(p.imageHash)) fail("imageHash does not refer to an image created with figma.createImage");
      oneOf(p.scaleMode, ["FILL", "FIT", "CROP", "TILE"], "scaleMode");
      if (p.imageTransform !== undefined) { if (p.scaleMode !== "CROP") fail("imageTransform needs scaleMode CROP"); matrixCheck(p.imageTransform, "imageTransform"); }
    } else if (/^GRADIENT_/.test(p.type)) {
      keysOnly(p, ["type", "gradientTransform", "gradientStops", "opacity", "visible", "blendMode"], "gradient paint");
      matrixCheck(p.gradientTransform, "gradientTransform");
      if (!Array.isArray(p.gradientStops) || p.gradientStops.length < 2) fail("gradientStops needs 2+ stops");
      p.gradientStops.forEach((s) => { keysOnly(s, ["position", "color", "boundVariables"], "gradient stop"); if (!inRange(s.position, 0, 1)) fail("stop position 0..1"); rgbCheck(s.color, true, "stop.color"); });
    } else fail("Unknown paint type " + p.type);
  }
  function checkEffect(e) {
    keysOnly(e, ["type", "color", "offset", "radius", "spread", "visible", "blendMode", "showShadowBehindNode"], "effect");
    oneOf(e.type, ["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"], "effect type");
    if (/SHADOW/.test(e.type)) {
      rgbCheck(e.color, true, "effect.color");
      keysOnly(e.offset, ["x", "y"], "effect.offset");
      if (!isNum(e.offset.x) || !isNum(e.offset.y)) fail("effect.offset must be numbers");
      if (typeof e.blendMode !== "string") fail("effect.blendMode is required");
    }
    if (!isNum(e.radius) || e.radius < 0) fail("effect.radius must be >= 0");
    if (typeof e.visible !== "boolean") fail("effect.visible is required");
  }

  function pageOf(n) { while (n && n.type !== "PAGE") n = n.parent; return n; }
  function insideInstance(n) { for (let p = n; p; p = p.parent) if (p.type === "INSTANCE") return true; return false; }
  function topLevel(n) {
    if (!n || !n.parent) return false;
    let p = n.parent;
    while (p && p.type === "SECTION") p = p.parent;
    return p && p.type === "PAGE";
  }

  const CONTAINERS = new Set(["PAGE", "FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "SECTION", "GROUP", "DOCUMENT"]);
  const LAYOUT = new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"]);

  class Node {
    constructor(type) {
      this.id = ++seq + ":" + 1;
      this.type = type;
      this.name = type.charAt(0) + type.slice(1).toLowerCase();
      this.parent = null;
      if (CONTAINERS.has(type)) this.children = [];
      this._x = 0; this._y = 0; this.width = 100; this.height = 100;
      this._fills = []; this._strokes = []; this._effects = [];
      this.visible = true; this.opacity = 1;
      this.strokeWeight = 1; this.strokeAlign = "INSIDE";
      this.cornerRadius = 0; this.clipsContent = type === "FRAME" || type === "COMPONENT" || type === "INSTANCE";
      this._layoutMode = "NONE";
      this.reactions = [];
      this.plugin = {};
      nodes.set(this.id, this);
    }
    _geom(what) { if (opts.strictInstances !== false && this.parent && insideInstance(this.parent)) fail("in " + what + ": This property cannot be overridden in an instance"); }
    get x() { return this._x; }
    set x(v) { if (!isNum(v)) fail("x must be a number, got " + v); this._geom("set_x"); this._x = v; }
    get y() { return this._y; }
    set y(v) { if (!isNum(v)) fail("y must be a number, got " + v); this._geom("set_y"); this._y = v; }
    get fills() { return this._fills; }
    set fills(v) { if (!Array.isArray(v)) fail("fills must be an array"); v.forEach(checkPaint); this._fills = JSON.parse(JSON.stringify(v)); }
    get strokes() { return this._strokes; }
    set strokes(v) { if (!Array.isArray(v)) fail("strokes must be an array"); v.forEach(checkPaint); this._strokes = JSON.parse(JSON.stringify(v)); }
    get effects() { return this._effects; }
    set effects(v) { if (!Array.isArray(v)) fail("effects must be an array"); v.forEach(checkEffect); this._effects = JSON.parse(JSON.stringify(v)); }
    get layoutMode() { return this._layoutMode; }
    set layoutMode(v) { if (!LAYOUT.has(this.type)) fail("layoutMode not supported on " + this.type); oneOf(v, ["NONE", "HORIZONTAL", "VERTICAL", "GRID"], "layoutMode"); this._layoutMode = v; }
    set primaryAxisAlignItems(v) { oneOf(v, ["MIN", "CENTER", "MAX", "SPACE_BETWEEN"], "primaryAxisAlignItems"); this._paa = v; }
    get primaryAxisAlignItems() { return this._paa || "MIN"; }
    set counterAxisAlignItems(v) { oneOf(v, ["MIN", "CENTER", "MAX", "BASELINE"], "counterAxisAlignItems"); this._caa = v; }
    get counterAxisAlignItems() { return this._caa || "MIN"; }
    set primaryAxisSizingMode(v) { oneOf(v, ["FIXED", "AUTO"], "primaryAxisSizingMode"); this._pas = v; }
    get primaryAxisSizingMode() { return this._pas || "FIXED"; }
    set counterAxisSizingMode(v) { oneOf(v, ["FIXED", "AUTO"], "counterAxisSizingMode"); this._cas = v; }
    get counterAxisSizingMode() { return this._cas || "FIXED"; }
    set dashPattern(v) { if (!Array.isArray(v) || v.some((n) => !isNum(n))) fail("dashPattern must be numbers"); this._dash = v; }
    get dashPattern() { return this._dash || []; }
    appendChild(c) { this.insertChild(this.children ? this.children.length : 0, c); }
    insertChild(i, c) {
      if (!this.children) fail("Node type " + this.type + " cannot have children");
      if (insideInstance(this)) fail("Cannot move a node into an instance");
      if (c === this) fail("Cannot append a node to itself");
      if (this.type === "COMPONENT_SET" && c.type !== "COMPONENT") fail("A component set can only hold components");
      if (this.type === "DOCUMENT" && c.type !== "PAGE") fail("Only pages can be children of the document");
      if (c.parent) { if (insideInstance(c.parent) && c.parent.type !== "PAGE") fail("Cannot move a node out of an instance"); c.parent.children.splice(c.parent.children.indexOf(c), 1); }
      this.children.splice(i, 0, c);
      c.parent = this;
    }
    remove() {
      if (this.parent && insideInstance(this.parent)) fail("Cannot remove a layer inside an instance");
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
      this.removed = true;
      const drop = (n) => { nodes.delete(n.id); (n.children || []).forEach(drop); };
      drop(this);
    }
    resize(w, h) { if (!(w >= 0.01) || !(h >= 0.01)) fail("resize: width and height must be at least 0.01 (got " + w + ", " + h + ")"); this._geom("resize"); this.width = w; this.height = h; }
    resizeWithoutConstraints(w, h) { this.resize(w, h); }
    findOne(fn) { for (const c of this.children || []) { if (fn(c)) return c; const r = c.findOne && c.findOne(fn); if (r) return r; } return null; }
    findAll(fn) { const out = []; (function w(n) { for (const c of n.children || []) { if (!fn || fn(c)) out.push(c); w(c); } })(this); return out; }
    createInstance() {
      if (this.type !== "COMPONENT") fail("createInstance only works on a component (got " + this.type + ")");
      const inst = cloneTree(this);
      current.appendChild(inst);
      inst._x = 0; inst._y = 0;
      return inst;
    }
    setPluginData(k, v) { this.plugin[k] = String(v); }
    getPluginData(k) { return this.plugin[k] || ""; }
    async setReactionsAsync(list) {
      if (!Array.isArray(list)) fail("reactions must be an array");
      for (const r of list) {
        keysOnly(r, ["trigger", "actions", "action"], "reaction");
        if (r.action) notes.deprecations.push("reaction.action");
        const t = r.trigger;
        oneOf(t && t.type, ["ON_CLICK", "ON_HOVER", "ON_PRESS", "ON_DRAG", "AFTER_TIMEOUT", "MOUSE_ENTER", "MOUSE_LEAVE", "MOUSE_UP", "MOUSE_DOWN", "ON_KEY_DOWN"], "trigger type");
        if (t.type === "AFTER_TIMEOUT") {
          keysOnly(t, ["type", "timeout"], "AFTER_TIMEOUT trigger");
          if (!(t.timeout > 0)) fail("AFTER_TIMEOUT needs a timeout");
          if (!topLevel(this) || this.type !== "FRAME") fail("AFTER_TIMEOUT only works on top-level frames");
        } else keysOnly(t, ["type", "delay", "deprecatedVersion"], t.type + " trigger");
        for (const a of r.actions || []) {
          if (a.type === "BACK" || a.type === "CLOSE") { keysOnly(a, ["type"], a.type + " action"); continue; }
          if (a.type !== "NODE") fail("Unsupported action " + a.type);
          keysOnly(a, ["type", "destinationId", "navigation", "transition", "preserveScrollPosition", "overlayRelativePosition", "resetVideoPosition", "resetScrollPosition", "resetInteractiveComponents"], "NODE action");
          oneOf(a.navigation, ["NAVIGATE", "SWAP", "OVERLAY", "SCROLL_TO", "CHANGE_TO"], "navigation");
          const dest = nodes.get(a.destinationId);
          if (!dest) fail("destinationId " + a.destinationId + " does not exist");
          if (a.navigation === "NAVIGATE" && (!topLevel(dest) || ["FRAME", "COMPONENT", "INSTANCE"].indexOf(dest.type) < 0)) fail("Prototype destination must be a top-level frame");
          if (pageOf(dest) !== pageOf(this)) fail("Prototype destination must be on the same page");
          if (a.transition) {
            const tr = a.transition;
            oneOf(tr.type, ["DISSOLVE", "SMART_ANIMATE", "SCROLL_ANIMATE", "MOVE_IN", "MOVE_OUT", "PUSH", "SLIDE_IN", "SLIDE_OUT"], "transition type");
            keysOnly(tr, ["type", "easing", "duration", "direction", "matchLayers"], "transition");
            if (!tr.easing || typeof tr.easing.type !== "string") fail("transition.easing.type is required");
            if (!isNum(tr.duration)) fail("transition.duration is required");
          }
        }
      }
      this.reactions = JSON.parse(JSON.stringify(list));
    }
  }

  class TextNode extends Node {
    constructor() {
      super("TEXT");
      this._chars = "";
      this._base = { fontName: { family: "Inter", style: "Regular" }, fontSize: 12, lineHeight: { unit: "AUTO" }, letterSpacing: { unit: "PERCENT", value: 0 }, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }], textStyleId: "", textDecoration: "NONE" };
      this._per = [];
      this._autoResize = "WIDTH_AND_HEIGHT";
      this._align = "LEFT";
      this._trunc = "DISABLED";
      this._maxLines = null;
    }
    _needFonts(list) { for (const f of list) if (!loaded.has(fontKey(f))) fail("Font \"" + f.family + " " + f.style + "\" is not loaded. Call figma.loadFontAsync first."); }
    _fontsInUse() { const all = [this._base.fontName].concat(this._per.map((p) => p.fontName)); return all.filter((f, i) => all.findIndex((g) => fontKey(g) === fontKey(f)) === i); }
    get characters() { return this._chars; }
    set characters(v) {
      if (typeof v !== "string") fail("characters must be a string");
      this._needFonts(this._chars.length ? this._fontsInUse() : [this._base.fontName]);
      const first = this._per[0] || this._base;
      this._chars = v;
      this._per = Array.from({ length: v.length }, () => JSON.parse(JSON.stringify(first)));
    }
    _setAll(prop, v) { this._base[prop] = v; this._per.forEach((p) => { p[prop] = JSON.parse(JSON.stringify(v)); }); }
    get fontName() { return this._base.fontName; }
    set fontName(v) { keysOnly(v, ["family", "style"], "fontName"); this._needFonts([v]); this._setAll("fontName", v); }
    get fontSize() { return this._base.fontSize; }
    set fontSize(v) { this._needFonts(this._fontsInUse()); if (!(v >= 1)) fail("fontSize must be >= 1"); this._setAll("fontSize", v); }
    get lineHeight() { return this._base.lineHeight; }
    set lineHeight(v) { this._needFonts(this._fontsInUse()); this._checkLH(v); this._setAll("lineHeight", v); }
    get letterSpacing() { return this._base.letterSpacing; }
    set letterSpacing(v) { this._needFonts(this._fontsInUse()); keysOnly(v, ["unit", "value"], "letterSpacing"); this._setAll("letterSpacing", v); }
    get fills() { return this._base.fills; }
    set fills(v) { if (!Array.isArray(v)) fail("fills must be an array"); v.forEach(checkPaint); this._setAll("fills", JSON.parse(JSON.stringify(v))); }
    set textDecoration(v) { this._needFonts(this._fontsInUse()); oneOf(v, ["NONE", "UNDERLINE", "STRIKETHROUGH"], "textDecoration"); this._setAll("textDecoration", v); }
    set textStyleId(v) { fail("textStyleId cannot be set with documentAccess: dynamic-page. Use setTextStyleIdAsync."); }
    get textAutoResize() { return this._autoResize; }
    set textAutoResize(v) { this._needFonts(this._fontsInUse()); oneOf(v, ["NONE", "WIDTH_AND_HEIGHT", "HEIGHT", "TRUNCATE"], "textAutoResize"); this._autoResize = v; }
    get textAlignHorizontal() { return this._align; }
    set textAlignHorizontal(v) { this._needFonts(this._fontsInUse()); oneOf(v, ["LEFT", "CENTER", "RIGHT", "JUSTIFIED"], "textAlignHorizontal"); this._align = v; }
    get textTruncation() { return this._trunc; }
    set textTruncation(v) { this._needFonts(this._fontsInUse()); oneOf(v, ["DISABLED", "ENDING"], "textTruncation"); this._trunc = v; }
    get maxLines() { return this._maxLines; }
    set maxLines(v) { this._needFonts(this._fontsInUse()); if (v !== null && !(Number.isInteger(v) && v >= 1)) fail("maxLines must be null or an integer >= 1"); this._maxLines = v; }
    resize(w, h) { this._needFonts(this._fontsInUse()); super.resize(w, h); if (this._autoResize === "WIDTH_AND_HEIGHT") this._autoResize = "NONE"; }
    _checkLH(v) { keysOnly(v, ["unit", "value"], "lineHeight"); oneOf(v.unit, ["PIXELS", "PERCENT", "AUTO"], "lineHeight unit"); }
    _range(s, e) { if (!(Number.isInteger(s) && Number.isInteger(e) && s >= 0 && e <= this._chars.length && s < e)) fail("Invalid range " + s + "-" + e + " for text of length " + this._chars.length); }
    _setRange(s, e, prop, v) { this._range(s, e); for (let i = s; i < e; i++) this._per[i][prop] = JSON.parse(JSON.stringify(v)); }
    _rangeFonts(s, e) { this._needFonts(this._per.slice(s, e).map((p) => p.fontName)); }
    setRangeFontName(s, e, v) { keysOnly(v, ["family", "style"], "fontName"); this._needFonts([v]); this._setRange(s, e, "fontName", v); }
    setRangeFontSize(s, e, v) { this._rangeFonts(s, e); this._setRange(s, e, "fontSize", v); }
    setRangeLineHeight(s, e, v) { this._rangeFonts(s, e); this._checkLH(v); this._setRange(s, e, "lineHeight", v); }
    setRangeLetterSpacing(s, e, v) { this._rangeFonts(s, e); keysOnly(v, ["unit", "value"], "letterSpacing"); this._setRange(s, e, "letterSpacing", v); }
    setRangeFills(s, e, v) { if (!Array.isArray(v)) fail("fills must be an array"); v.forEach(checkPaint); this._setRange(s, e, "fills", v); }
    setRangeTextDecoration(s, e, v) { this._rangeFonts(s, e); oneOf(v, ["NONE", "UNDERLINE", "STRIKETHROUGH"], "textDecoration"); this._setRange(s, e, "textDecoration", v); }
    async setRangeTextStyleIdAsync(s, e, id) {
      const st = textStyles.get(id);
      if (!st) fail("Unknown text style " + id);
      this._needFonts([st.fontName]);
      this._range(s, e);
      for (let i = s; i < e; i++) Object.assign(this._per[i], JSON.parse(JSON.stringify({ fontName: st.fontName, fontSize: st.fontSize, lineHeight: st.lineHeight, letterSpacing: st.letterSpacing })), { textStyleId: id });
    }
    async setTextStyleIdAsync(id) { if (this._chars.length) await this.setRangeTextStyleIdAsync(0, this._chars.length, id); this._base.textStyleId = id; }
  }

  function cloneTree(src, inInstance) {
    const n = src.type === "TEXT" ? new TextNode() : new Node(src.type === "COMPONENT" ? "INSTANCE" : src.type);
    for (const k of Object.keys(src)) {
      if (["id", "parent", "children", "type", "plugin", "reactions", "mainComponent", "removed"].indexOf(k) > -1) continue;
      n[k] = JSON.parse(JSON.stringify(src[k] === undefined ? null : src[k]));
    }
    if (src.type === "COMPONENT") n.mainComponent = src;
    else if (src.type === "INSTANCE") n.mainComponent = src.mainComponent;
    if (src.children) for (const c of src.children) { const cc = cloneTree(c, true); n.children.push(cc); cc.parent = n; }
    return n;
  }

  const root = new Node("DOCUMENT");
  root.name = "Document";
  function newPage(name) {
    const p = new Node("PAGE");
    p.name = name || "Page " + (root.children.length + 1);
    p._flow = [];
    Object.defineProperty(p, "flowStartingPoints", {
      get() { return this._flow; },
      set(v) {
        if (!Array.isArray(v)) fail("flowStartingPoints must be an array");
        v.forEach((f) => { keysOnly(f, ["nodeId", "name"], "flow starting point"); const n = nodes.get(f.nodeId); if (!n || !topLevel(n) || pageOf(n) !== this) fail("Flow start must be a top-level frame on this page"); });
        this._flow = JSON.parse(JSON.stringify(v));
      }
    });
    p.loadAsync = async () => {};
    root.appendChild(p);
    return p;
  }
  let current = newPage("Page 1");
  const create = (type) => { const n = type === "TEXT" ? new TextNode() : new Node(type); current.appendChild(n); return n; };

  function imageSize(b) {
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: "png", w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { type: "gif", w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: "jpeg", h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
      return { type: "jpeg", w: 0, h: 0 };
    }
    return null;
  }

  let varSeq = 0, styleSeq = 0;
  const figma = {
    root,
    get currentPage() { return current; },
    set currentPage(p) { fail("Setting figma.currentPage is not supported with documentAccess: dynamic-page. Use setCurrentPageAsync."); },
    async setCurrentPageAsync(p) { if (!p || p.type !== "PAGE") fail("setCurrentPageAsync needs a page"); current = p; },
    createPage() { return newPage(); },
    createFrame() { return create("FRAME"); },
    createRectangle() { return create("RECTANGLE"); },
    createEllipse() { return create("ELLIPSE"); },
    createText() { return create("TEXT"); },
    createComponent() { return create("COMPONENT"); },
    createSection() { const s = create("SECTION"); s.clipsContent = false; s._fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }]; return s; },
    createNodeFromSvg(svg) {
      if (typeof svg !== "string" || svg.trim().indexOf("<svg") !== 0) fail("createNodeFromSvg needs an <svg> string");
      const w = parseFloat((svg.match(/<svg[^>]*\swidth="([\d.]+)"/) || [])[1]);
      const h = parseFloat((svg.match(/<svg[^>]*\sheight="([\d.]+)"/) || [])[1]);
      if (!(w > 0 && h > 0)) fail("SVG needs width and height");
      const n = create("FRAME");
      n.width = w; n.height = h; n._svg = svg; n._fills = [];
      return n;
    },
    combineAsVariants(list, parent) {
      if (!Array.isArray(list) || !list.length) fail("combineAsVariants needs components");
      list.forEach((c) => { if (c.type !== "COMPONENT") fail("combineAsVariants: every node must be a component"); if (c.parent && c.parent.type === "COMPONENT_SET") fail("combineAsVariants: component is already a variant"); });
      if (!parent || ["PAGE", "FRAME", "SECTION", "GROUP"].indexOf(parent.type) < 0) fail("combineAsVariants: parent must be a page, frame or section");
      const set = new Node("COMPONENT_SET");
      parent.appendChild(set);
      list.forEach((c) => set.appendChild(c));
      return set;
    },
    createImage(bytes) {
      const b = Buffer.from(bytes);
      const s = imageSize(b);
      if (!s) fail("createImage: image must be PNG, JPEG or GIF");
      if (s.w > 4096 || s.h > 4096) fail("createImage: image larger than 4096 px (" + s.w + "x" + s.h + ")");
      const hash = crypto.createHash("sha1").update(b).digest("hex");
      images.set(hash, { bytes: b, size: s });
      return { hash, getBytesAsync: async () => b };
    },
    base64Decode(str) { if (typeof str !== "string") fail("base64Decode needs a string"); return new Uint8Array(Buffer.from(str, "base64")); },
    async listAvailableFontsAsync() { return fonts.map((f) => ({ fontName: f })); },
    async loadFontAsync(f) { if (!fonts.some((g) => fontKey(g) === fontKey(f))) throw new Error("Font " + f.family + " " + f.style + " is not available"); loaded.add(fontKey(f)); },
    createTextStyle() {
      const id = "S:" + (++styleSeq);
      const st = { id, type: "TEXT", name: "Style", description: "", fontSize: 12, lineHeight: { unit: "AUTO" }, letterSpacing: { unit: "PIXELS", value: 0 }, _font: { family: "Inter", style: "Regular" } };
      Object.defineProperty(st, "fontName", { get() { return this._font; }, set(v) { if (!loaded.has(fontKey(v))) fail("Text style font not loaded: " + fontKey(v)); this._font = v; }, enumerable: true });
      textStyles.set(id, st);
      return st;
    },
    variables: {
      createVariableCollection(name) {
        const c = { id: "VC:" + collections.length, name, modes: [{ modeId: "1:0", name: "Mode 1" }], renameMode(id, n) { const m = this.modes.find((x) => x.modeId === id); if (!m) fail("No such mode"); m.name = n; } };
        collections.push(c);
        return c;
      },
      createVariable(name, coll, type) {
        if (typeof coll === "string") notes.deprecations.push("createVariable with a collection id");
        if (!coll) fail("createVariable needs a collection");
        oneOf(type, ["COLOR", "FLOAT", "STRING", "BOOLEAN"], "variable type");
        const v = { id: "VariableID:" + (++varSeq), name, resolvedType: type, description: "", valuesByMode: {}, codeSyntax: {},
          setValueForMode(mode, val) { if (type === "COLOR") rgbCheck(val, true, "variable value"); this.valuesByMode[mode] = val; },
          setVariableCodeSyntax(p, val) { oneOf(p, ["WEB", "ANDROID", "iOS"], "code syntax platform"); this.codeSyntax[p] = val; } };
        variables.set(v.id, v);
        return v;
      },
      setBoundVariableForPaint(p, field, v) {
        if (field !== "color") fail("Only color can be bound on a paint");
        if (!v || !variables.has(v.id) || v.resolvedType !== "COLOR") fail("setBoundVariableForPaint needs a COLOR variable");
        checkPaint(p);
        return Object.assign(JSON.parse(JSON.stringify(p)), { boundVariables: { color: { type: "VARIABLE_ALIAS", id: v.id } } });
      }
    },
    async setFileThumbnailNodeAsync(n) { if (n && ["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION"].indexOf(n.type) < 0) fail("Thumbnail must be a frame, component or section"); notes.thumbnail = n && n.name; },
    viewport: { scrollAndZoomIntoView() {} },
    notify(msg) { notes.notify.push(String(msg)); return { cancel() {} }; },
    closePlugin(msg) { notes.close = msg === undefined ? null : String(msg); resolveDone(); }
  };
  figma.root.insertChild = (i, c) => Node.prototype.insertChild.call(root, i, c);

  function counts() {
    const c = { pages: 0, sections: 0, frames: 0, svgFrames: 0, components: 0, componentSets: 0, variants: 0, instances: 0, texts: 0, imageLayers: 0, imageLayersAll: 0, rectangles: 0, links: 0, linksByTrigger: {} };
    (function w(n, inInst) {
      for (const k of n.children || []) {
        const ii = inInst || k.type === "INSTANCE";
        if (k.type === "PAGE") c.pages++;
        else if (k.type === "SECTION") c.sections++;
        else if (k.type === "FRAME") { if (k._svg) c.svgFrames++; else if (!inInst) c.frames++; }
        else if (k.type === "COMPONENT") { c.components++; if (n.type === "COMPONENT_SET") c.variants++; }
        else if (k.type === "COMPONENT_SET") c.componentSets++;
        else if (k.type === "INSTANCE" && !inInst) c.instances++;
        else if (k.type === "TEXT" && !inInst) c.texts++;
        else if (k.type === "RECTANGLE" && !inInst) c.rectangles++;
        if ((k.fills || []).some((f) => f.type === "IMAGE")) { c.imageLayersAll++; if (!inInst) c.imageLayers++; }
        for (const r of k.reactions || []) { c.links++; const t = r.trigger.type; c.linksByTrigger[t] = (c.linksByTrigger[t] || 0) + 1; }
        w(k, ii);
      }
    })(root, false);
    c.variables = variables.size;
    c.collections = collections.length;
    c.textStyles = textStyles.size;
    c.images = images.size;
    c.imageMB = +([...images.values()].reduce((n, i) => n + i.bytes.length, 0) / 1e6).toFixed(2);
    c.flowStarts = root.children.reduce((n, p) => n + (p._flow || []).length, 0);
    return c;
  }

  return { figma, root, done, notes, counts, images, variables, textStyles, collections };
}

module.exports = { createMock };
