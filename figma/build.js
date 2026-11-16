/* Builds the Figma plugin (figma/plugin/code.js) and the case-study screenshots
   from the live prototype. Run from the repo root with a local server on :8765:

     python3 -m http.server 8765 &
     node figma/build.js

   Every screen is read from the real DOM, so the Figma file and the prototype
   stay identical. */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const URL = "http://localhost:8765/prototype/steady/?bare";
const SHOTS = path.join(ROOT, "work/steady/img");

/* Runs inside the page. Turns the current screen into a plain node tree. */
function serialize() {
  const root = document.querySelector(".screen");
  const rootRect = root.getBoundingClientRect();
  const CLICK = "[data-go],[data-action],[data-coin],[data-chip],[data-key],[data-range],[data-toast]";
  const clickables = Array.from(root.querySelectorAll(CLICK));

  function color(str) {
    const m = str && str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    const a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a };
  }
  function px(v) { return parseFloat(v) || 0; }

  function compKey(el) {
    const c = el.classList;
    const textOnly = el.children.length === 0 && el.textContent.trim().length > 0;
    if (c.contains("status")) return { set: "iOS status bar", variant: null };
    if (c.contains("home-indicator")) return { set: "Home indicator", variant: null };
    if (c.contains("tabbar")) return { set: "Tab bar", variant: null };
    if (c.contains("btn") && textOnly) {
      const style = c.contains("secondary") ? "Secondary" : c.contains("ghost") ? "Ghost" : "Primary";
      const st = el.disabled ? "Disabled" : "Default";
      return { set: "Button", variant: "Style=" + style + ", State=" + st };
    }
    if (c.contains("chip") && textOnly) {
      return { set: "Chip", variant: "Selected=" + (el.getAttribute("aria-pressed") === "true" ? "True" : "False") };
    }
    if (c.contains("key") && textOnly) return { set: "Keypad key", variant: null };
    return null;
  }

  const NAMES = { btn: "Button", card: "Card", list: "List", row: "Row", tile: "Tile", notice: "Notice", coin: "Coin",
    chip: "Chip", key: "Key", nav: "Nav bar", body: "Content", footer: "Footer", tabbar: "Tab bar", status: "Status bar",
    "home-indicator": "Home indicator", "balance-card": "Balance card", switch: "Switch", knob: "Knob", sheet: "Sheet",
    "sheet-backdrop": "Scrim", field: "Field", compare: "Compare", "done-mark": "Done mark", ico: "Icon tile",
    "icon-btn": "Icon button", avatar: "Avatar", "lock-bar": "Countdown", ranges: "Ranges", toast: "Toast", num: "Step number",
    keypad: "Keypad", chips: "Chips", quick: "Quick actions", grab: "Grabber", faceid: "Face ID" };
  function nameOf(el) {
    for (const c of el.classList) if (NAMES[c]) return NAMES[c];
    return el.tagName.toLowerCase();
  }

  /* SVG import is happiest with hex colors plus a separate opacity */
  function setPaint(d, prop, value) {
    const c = color(value);
    if (!c) { d.setAttribute(prop, "none"); return; }
    const h = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
    d.setAttribute(prop, "#" + h(c.r) + h(c.g) + h(c.b));
    if (c.a < 1) d.setAttribute(prop + "-opacity", c.a);
  }

  function svgNode(svg, base) {
    const r = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true);
    const src = [svg, ...svg.querySelectorAll("*")];
    const dst = [clone, ...clone.querySelectorAll("*")];
    src.forEach((s, i) => {
      const cs = getComputedStyle(s);
      const d = dst[i];
      ["fill", "stroke"].forEach((prop) => {
        const attr = s.getAttribute(prop);
        if (attr && attr !== "none") setPaint(d, prop, cs[prop]);
        else if (!attr && s !== svg && prop === "fill" && s.tagName !== "g") {
          /* inherited fill (none on the root svg) */
          const f = cs.fill;
          if (f && f !== "none") setPaint(d, "fill", f);
        }
      });
      if (s.tagName === "text") {
        d.setAttribute("font-family", "Inter");
        d.setAttribute("font-size", cs.fontSize);
        setPaint(d, "fill", cs.fill);
      }
    });
    clone.setAttribute("width", r.width);
    clone.setAttribute("height", r.height);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return { type: "svg", name: svg.getAttribute("aria-label") || "Icon", x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, svg: clone.outerHTML };
  }

  function textStyle(el) {
    const cs = getComputedStyle(el);
    const lh = cs.lineHeight === "normal" ? null : px(cs.lineHeight);
    return {
      family: cs.fontFamily.indexOf("Mono") > -1 ? "mono" : "sans",
      weight: parseInt(cs.fontWeight, 10),
      size: px(cs.fontSize),
      lineHeight: lh,
      letterSpacing: cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing),
      color: color(cs.color),
      align: cs.textAlign,
      decoration: cs.textDecorationLine === "underline" ? "UNDERLINE" : null
    };
  }

  function blockOf(node) {
    let el = node.parentElement;
    while (el && getComputedStyle(el).display === "inline") el = el.parentElement;
    return el;
  }

  function textNodes(tn, base) {
    const raw = tn.textContent;
    if (!raw.trim()) return [];
    const parent = tn.parentElement;
    const st = textStyle(parent);
    const range = document.createRange();
    range.selectNodeContents(tn);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
    if (!rects.length) return [];
    const lh = st.lineHeight || rects[0].height;
    const top = (r) => r.top - (lh - r.height) / 2;
    const text = raw.replace(/\s+/g, " ");
    if (rects.length === 1) {
      const r = rects[0];
      return [{ type: "text", x: r.left - base.left, y: top(r) - base.top, w: r.width, h: lh, chars: text.trim(), style: st, wrap: false }];
    }
    const block = blockOf(tn);
    if (block && block.textContent.replace(/\s+/g, " ").trim() === text.trim()) {
      const b = block.getBoundingClientRect();
      const cs = getComputedStyle(block);
      const x = b.left + px(cs.paddingLeft) + px(cs.borderLeftWidth);
      const w = b.width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth);
      const y = top(rects[0]);
      return [{ type: "text", x: x - base.left, y: y - base.top, w, h: rects.length * lh, chars: text.trim(), style: st, wrap: true }];
    }
    /* mixed inline content: one layer per line, split by word positions */
    const out = [];
    const words = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(raw))) {
      const wr = document.createRange();
      wr.setStart(tn, m.index);
      wr.setEnd(tn, m.index + m[0].length);
      const r = wr.getClientRects()[0];
      if (r) words.push({ w: m[0], r });
    }
    let line = null;
    words.forEach((wd) => {
      if (!line || Math.abs(wd.r.top - line.top) > 2) {
        line = { top: wd.r.top, left: wd.r.left, right: wd.r.right, h: wd.r.height, words: [wd.w] };
        out.push(line);
      } else {
        line.right = wd.r.right;
        line.words.push(wd.w);
      }
    });
    return out.map((l) => ({ type: "text", x: l.left - base.left, y: l.top - (lh - l.h) / 2 - base.top, w: l.right - l.left, h: lh,
      chars: l.words.join(" "), style: st, wrap: false }));
  }

  function shadow(cs) {
    if (!cs.boxShadow || cs.boxShadow === "none") return null;
    const m = cs.boxShadow.match(/(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/);
    if (!m) return null;
    return { color: color(m[1]), x: +m[2], y: +m[3], blur: +m[4] };
  }

  function visual(el, cs) {
    const bg = color(cs.backgroundColor);
    const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px);
    const clip = cs.overflow !== "visible" && el !== root;
    return !!(bg || bw.some((v) => v > 0) || clip || px(cs.opacity) < 1 || clickables.includes(el) || shadow(cs) || compKey(el));
  }

  function build(el, base) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || px(cs.opacity) === 0) return [];
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return [];
    if (el.tagName === "svg") return [svgNode(el, base)];

    const isFrame = el === root || visual(el, cs);
    const myBase = isFrame ? r : base;
    const kids = [];
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) kids.push(...textNodes(n, myBase));
      else if (n.nodeType === 1) kids.push(...build(n, myBase));
    });
    if (!isFrame) return kids;

    const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px);
    const bc = color(cs.borderTopColor) || color(cs.borderLeftColor) || color(cs.borderBottomColor);
    const node = {
      type: "frame",
      name: nameOf(el),
      x: r.left - base.left,
      y: r.top - base.top,
      w: r.width,
      h: r.height,
      fill: color(cs.backgroundColor),
      stroke: bw.some((v) => v > 0) ? { color: bc, top: bw[0], right: bw[1], bottom: bw[2], left: bw[3] } : null,
      radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(px),
      clip: cs.overflow !== "visible",
      opacity: px(cs.opacity),
      shadow: shadow(cs),
      children: kids
    };
    const ci = clickables.indexOf(el);
    if (ci > -1) node.click = ci;
    const ck = compKey(el);
    if (ck) node.comp = ck;
    return [node];
  }

  const tree = build(root, rootRect)[0];
  tree.x = 0; tree.y = 0;
  return { tree, clickCount: clickables.length };
}

/* Runs inside the page: click the n-th clickable in a frame, report where it lands. */
function clickTarget(args) {
  const [frame, n] = args;
  window.STEADY.applyFrame(frame, true);
  const CLICK = "[data-go],[data-action],[data-coin],[data-chip],[data-key],[data-range],[data-toast]";
  const el = document.querySelectorAll(".screen " + CLICK)[n];
  if (!el || el.disabled) return null;
  el.click();
  return window.STEADY.current();
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const frames = await page.evaluate(() => window.STEADY.FRAMES.map((f) => ({ id: f.id, title: f.title, note: f.note })));
  const out = [];
  for (const f of frames) {
    await page.evaluate((id) => window.STEADY.applyFrame(id, true), f.id);
    await page.waitForTimeout(60);
    await page.screenshot({ path: path.join(SHOTS, f.id + ".png") });
    const { tree, clickCount } = await page.evaluate(serialize);
    const links = {};
    for (let i = 0; i < clickCount; i++) {
      const target = await page.evaluate(clickTarget, [f.id, i]);
      if (target && target !== f.id) links[i] = target;
    }
    out.push({ id: f.id, title: f.title, note: f.note, tree, links });
  }
  await browser.close();

  const data = JSON.stringify({ frames: out });
  const template = fs.readFileSync(path.join(__dirname, "plugin/code.template.js"), "utf8");
  fs.writeFileSync(path.join(__dirname, "plugin/code.js"), template.replace("/*__DATA__*/null", data));
  console.log("frames:", out.length, "links:", out.reduce((n, f) => n + Object.keys(f.links).length, 0), "bytes:", data.length);
  if (errors.length) console.log("page errors:", errors);
})();
