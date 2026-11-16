/* Injected into each page by build.js. Turns a DOM subtree into a plain node tree
   that the Figma plugin can draw: frames (with fills, strokes, radii, shadows,
   clipping), text (with styled runs), SVG icons and maps, and images.

   window.__md.serialize(el, { screen: true }) -> { tree }
   window.__md.bakeStart(id) / bakeEnd()       -> isolate one filtered image so
                                                  build.js can screenshot it */
(function () {
  const px = (v) => parseFloat(v) || 0;
  /* iOS chrome drawn in the screens: its text is not part of the app's type scale */
  const SYSTEM = ".kb, .sb, .hi, .home-indicator";
  let bakeSeq = 0;
  const bakeEls = {};

  function color(str) {
    const m = str && str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    const a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: Math.round(a * 1000) / 1000 };
  }
  function lum(c) { return c ? 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b : 0; }

  /* ---------------------------------------------------------------- components */
  function stageFromDone(n) { return ["Received", "Received", "Preparing", "On the way", "Delivered"][Math.max(0, Math.min(4, n))]; }

  function compKey(el) {
    if (el.dataset && el.dataset.set) return { set: el.dataset.set, variant: el.dataset.variant || null };
    const c = el.classList;
    if (!c) return null;
    if (!c.length) {
      const p = el.parentElement;
      if (!(p && p.classList.contains("grid") && el.querySelector(":scope > .tile"))) return null;
      return { set: "Product card", variant: "Type=" + (el.querySelector(".tstep") ? "In cart" : "Grid") };
    }
    const has = (...names) => names.some((n) => c.contains(n));
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    const iconless = !el.querySelector("svg,img");
    const disabled = el.disabled || has("disabled") || el.getAttribute("aria-disabled") === "true";

    if (has("sb")) {
      const svg = el.querySelector("svg");
      const fill = svg ? color(getComputedStyle(svg).fill) || color(getComputedStyle(svg).color) : null;
      return { set: "Status bar", variant: "Appearance=" + (lum(fill) > 0.5 ? "Light" : "Dark") };
    }
    if (has("hi", "home-indicator")) {
      return { set: "Home indicator", variant: "Appearance=" + (lum(color(getComputedStyle(el).backgroundColor)) > 0.5 ? "Light" : "Dark") };
    }
    if (has("tabbar")) {
      const on = el.querySelector(".tab.on, .tab.active, .tab[aria-current]");
      return { set: "Tab bar", variant: "Active=" + (on ? on.textContent.trim() : "None") };
    }
    if (has("btn") && iconless && txt) {
      const style = has("btn-secondary", "secondary") ? "Secondary" : has("btn-plain", "btn-ghost", "ghost", "text") ? "Ghost" : "Primary";
      const state = disabled ? "Disabled" : has("pressed") ? "Pressed" : "Default";
      return { set: "Button", variant: "Style=" + style + ", State=" + state };
    }
    if (has("chip") && iconless && txt) {
      const on = has("selected", "on", "active") || el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-selected") === "true";
      return { set: "Chip", variant: "Selected=" + (on ? "True" : "False") };
    }
    if (has("kb")) {
      const go = el.querySelector(".key.go");
      const type = has("numpad") ? "Number pad" : go && /search/i.test(go.textContent) ? "Search" : "Letters";
      return { set: "iOS keyboard", variant: "Type=" + type + ", Bar=" + (has("has-bar") ? "On" : "Off") };
    }
    if (has("tstep")) return { set: "Stepper", variant: "Size=On photo" };
    if (has("fcard") || (has("product-card") && has("featured"))) return { set: "Product card", variant: "Type=Featured" };
    if (has("gcard") || has("product-card") || (el.parentElement && el.parentElement.classList.contains("grid") && el.querySelector(":scope > .tile"))) {
      return { set: "Product card", variant: "Type=" + (el.querySelector(".tstep") || has("in-cart") ? "In cart" : "Grid") };
    }
    if (has("li") && el.querySelector(".tile")) return { set: "Bag row", variant: "Type=" + (el.querySelector(".mini") ? "Bag" : "Receipt") };
    if (has("add", "add-btn")) return { set: "Add button", variant: "State=" + (disabled ? "Disabled" : "Default") };
    if (has("stepper")) return { set: "Stepper", variant: "Size=" + (has("pill") ? "Small" : "Large") };
    if (has("mini")) return { set: "Stepper", variant: "Size=Small" };
    if (has("progress-wrap")) return { set: "Progress", variant: "Stage=" + stageFromDone(el.querySelectorAll(".seg.done").length) };
    if (has("progress") && el.querySelector(".step")) {
      const cur = el.querySelector(".step.current .step-label");
      return { set: "Progress", variant: "Stage=" + (cur ? cur.textContent.trim() : "Received") };
    }
    if (has("status-card")) {
      const st = [...c].find((k) => k.indexOf("stage-") === 0);
      const name = st ? st.slice(6).replace(/-/g, " ") : "preparing";
      return { set: "Status card", variant: "Stage=" + name.charAt(0).toUpperCase() + name.slice(1) };
    }
    if (has("drv", "driver-card") && !el.querySelector(".stack")) {
      const f = has("fresh-live") ? "Live" : has("updated") || /updated/i.test(txt) ? "Updated" : has("last-seen") || /last seen/i.test(txt) ? "Last seen" : "Live";
      return { set: "Driver card", variant: "Freshness=" + f };
    }
    if (has("driver-badge")) return { set: "Driver badge", variant: "State=" + (has("faded") ? "Faded" : "Live") };
    if (has("pulse-dot")) return { set: "Pulse dot", variant: null };
    return null;
  }

  const NAMES = {
    screen: "Screen", sb: "Status bar", hi: "Home indicator", tabbar: "Tab bar", tab: "Tab", btn: "Button", card: "Card",
    tile: "Photo tile", add: "Add button", iconbtn: "Icon button", top: "Top bar", nav: "Nav bar", "nav-t": "Title", home: "Content",
    eta: "Open and ETA", search: "Search field", cats: "Categories", rail: "Featured rail", fcard: "Product card", again: "Order again",
    stack: "Photo stack", "again-btn": "Reorder", "m-head": "Header", tabs: "Category tabs", "m-tools": "Sort", grid: "Product grid",
    "pd-photo": "Photo", "pd-nav": "Nav buttons", "pd-body": "Details", facts: "Facts", buybar: "Buy bar", stepper: "Stepper",
    bag: "Content", dl: "Delivery address", "dl-ic": "Icon tile", items: "Items", li: "Bag item", mini: "Stepper", pay: "Payment",
    "pay-r": "Row", sum: "Summary", "sum-r": "Row", "trk-map": "Map", "trk-nav": "Nav buttons", sheet: "Sheet", grab: "Grabber",
    segs: "Progress", seg: "Segment", "progress-wrap": "Progress", drv: "Driver card", ring: "Call button", info: "Order info",
    "info-r": "Row", wel: "Content", step: "Age step", "step-ic": "Step badge", loc: "Location card", approx: "Approximate area",
    lbl: "Label", fine: "Fine print", "launch-mark": "Mark", wm: "Wordmark", chip: "Chip", "driver-badge": "Driver badge",
    "pulse-dot": "Pulse dot", poster: "Poster", annotation: "Annotation", "ann-line": "Rule"
  };
  function nameOf(el) {
    if (el.dataset && el.dataset.name) return el.dataset.name;
    for (const k of el.classList || []) if (NAMES[k]) return NAMES[k];
    const tag = el.tagName.toLowerCase();
    return { button: "Button", nav: "Nav", header: "Header", main: "Content", section: "Section", h1: "Title", h2: "Heading", p: "Text" }[tag] || "Frame";
  }

  /* ---------------------------------------------------------------- paints and boxes */
  function borders(cs) { return [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px); }
  function radii(cs) { return [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(px); }
  function clampRadii(rr, w, h) { const m = Math.min(w, h) / 2; return rr.map((r) => Math.min(r, m)); }
  function contentBox(el, cs, r) {
    const l = px(cs.paddingLeft) + px(cs.borderLeftWidth), t = px(cs.paddingTop) + px(cs.borderTopWidth);
    return { left: r.left + l, top: r.top + t, width: r.width - l - px(cs.paddingRight) - px(cs.borderRightWidth), height: r.height - t - px(cs.paddingBottom) - px(cs.borderBottomWidth) };
  }

  function splitTop(str) {
    const out = []; let depth = 0, cur = "";
    for (const ch of str) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function shadows(cs) {
    if (!cs.boxShadow || cs.boxShadow === "none") return [];
    return splitTop(cs.boxShadow).map((s) => {
      const c = s.match(/rgba?\([^)]+\)/);
      const nums = s.replace(/rgba?\([^)]+\)/, "").replace("inset", "").trim().split(/\s+/).map(px);
      const col = color(c && c[0]);
      if (!col) return null;
      return { inset: /inset/.test(s), color: col, x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0 };
    }).filter(Boolean);
  }

  function gradient(str) {
    const m = str.match(/^linear-gradient\((.*)\)$/);
    if (!m) return null;
    const parts = splitTop(m[1]);
    let angle = 180;
    if (/deg$/.test(parts[0])) angle = px(parts.shift());
    else if (/^to /.test(parts[0])) {
      const d = parts.shift();
      angle = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270, "to top right": 45, "to bottom right": 135, "to bottom left": 225, "to top left": 315 }[d] || 180;
    }
    const stops = parts.map((p, i) => {
      const c = color(p.match(/rgba?\([^)]+\)/) ? p.match(/rgba?\([^)]+\)/)[0] : "") || { r: 0, g: 0, b: 0, a: 0 };
      const pos = p.match(/(-?[\d.]+)%\s*$/);
      return { color: c, position: pos ? px(pos[1]) / 100 : i / Math.max(1, parts.length - 1) };
    });
    return { type: "gradient", angle, stops };
  }

  function backgroundLayers(el, cs, r) {
    const fills = [];
    const bg = color(cs.backgroundColor);
    if (bg) fills.push({ type: "solid", color: bg });
    if (cs.backgroundImage && cs.backgroundImage !== "none") {
      const layers = splitTop(cs.backgroundImage).reverse();
      for (const l of layers) {
        const u = l.match(/^url\("?([^")]+)"?\)$/);
        if (u) fills.push({ type: "image", src: u[1], fit: cs.backgroundSize === "contain" ? "contain" : "cover", pos: cs.backgroundPosition, boxW: r.width, boxH: r.height });
        else { const g = gradient(l); if (g) fills.push(g); }
      }
    }
    return fills;
  }

  function zOf(el, cs) {
    if (cs.position === "static") return 0;
    const z = parseInt(cs.zIndex, 10);
    return isNaN(z) || z === 0 ? 0.5 : z;
  }

  /* ---------------------------------------------------------------- text */
  function textStyle(el) {
    const cs = getComputedStyle(el);
    return {
      family: cs.fontFamily.indexOf("Mono") > -1 ? "mono" : "sans",
      weight: parseInt(cs.fontWeight, 10),
      size: px(cs.fontSize),
      lineHeight: cs.lineHeight === "normal" ? null : Math.round(px(cs.lineHeight) * 100) / 100,
      letterSpacing: cs.letterSpacing === "normal" ? 0 : Math.round(px(cs.letterSpacing) * 100) / 100,
      color: color(cs.color),
      decoration: cs.textDecorationLine.indexOf("underline") > -1 ? "UNDERLINE" : cs.textDecorationLine.indexOf("line-through") > -1 ? "STRIKETHROUGH" : null,
      upper: cs.textTransform === "uppercase"
    };
  }

  /* An element whose content is only text (and plain inline elements around text)
     becomes one text layer with styled runs. */
  function inlineOnly(el, top) {
    let hasText = false;
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { if (n.textContent.trim()) hasText = true; continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === "br") continue;
      if (tag === "svg" || tag === "img" || n.hasAttribute("data-go") || compKey(n)) return null;
      const cs = getComputedStyle(n);
      if (cs.display === "none") continue;
      if (cs.display !== "inline") return null;
      if (color(cs.backgroundColor) || borders(cs).some((v) => v > 0) || px(cs.opacity) < 1) return null;
      const sub = inlineOnly(n, false);
      if (sub === null) return null;
      if (sub) hasText = true;
    }
    return hasText;
  }

  function collectRuns(el) {
    const segs = [];
    (function walk(node) {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          const st = textStyle(n.parentElement);
          let t = n.textContent.replace(/\s+/g, " ");
          if (st.upper) t = t.toUpperCase();
          if (t) segs.push({ text: t, style: st });
        } else if (n.nodeType === 1) {
          if (n.tagName.toLowerCase() === "br") segs.push({ text: "\n", style: null });
          else if (getComputedStyle(n).display !== "none") walk(n);
        }
      }
    })(el);
    let chars = "";
    const runs = [];
    segs.forEach((s, i) => {
      let t = s.text;
      if (t === "\n") { chars = chars.replace(/ +$/, ""); chars += "\n"; if (runs.length) runs[runs.length - 1].e = Math.min(runs[runs.length - 1].e, chars.length - 1); return; }
      if (!chars.length || chars.endsWith(" ") || chars.endsWith("\n")) t = t.replace(/^ +/, "");
      if (!t) return;
      const start = chars.length;
      chars += t;
      runs.push({ s: start, e: chars.length, style: s.style });
    });
    const trimmed = chars.replace(/[ \n]+$/, "");
    runs.forEach((r) => { r.e = Math.min(r.e, trimmed.length); });
    const merged = [];
    for (const r of runs) {
      if (r.e <= r.s) continue;
      const last = merged[merged.length - 1];
      if (last && JSON.stringify(last.style) === JSON.stringify(r.style) && last.e >= r.s) last.e = r.e;
      else merged.push(r);
    }
    return { chars: trimmed, runs: merged };
  }

  function lineGroups(rects) {
    const lines = [];
    rects.forEach((r) => {
      const mid = r.top + r.height / 2;
      const hit = lines.find((l) => Math.abs(l.mid - mid) < Math.max(3, r.height / 3));
      if (hit) { hit.left = Math.min(hit.left, r.left); hit.right = Math.max(hit.right, r.right); hit.top = Math.min(hit.top, r.top); hit.h = Math.max(hit.h, r.height); }
      else lines.push({ mid, left: r.left, right: r.right, top: r.top, h: r.height });
    });
    return lines.sort((a, b) => a.top - b.top);
  }

  function richText(el, cs, base) {
    const { chars, runs } = collectRuns(el);
    if (!chars) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5);
    if (!rects.length) return null;
    const lines = lineGroups(rects);
    const main = runs.slice().sort((a, b) => (b.e - b.s) - (a.e - a.s))[0].style;
    const lh = main.lineHeight || lines[0].h;
    const r = el.getBoundingClientRect();
    const cb = contentBox(el, cs, r);
    const block = /^(block|list-item|table-cell|flow-root)$/.test(cs.display);
    const align = cs.textAlign === "center" ? "CENTER" : cs.textAlign === "right" || cs.textAlign === "end" ? "RIGHT" : "LEFT";
    const breaks = (chars.match(/\n/g) || []).length;
    const ellipsis = cs.textOverflow === "ellipsis" && cs.overflow !== "visible" && cs.whiteSpace.indexOf("nowrap") > -1;
    const clamp = parseInt(cs.webkitLineClamp, 10);
    const node = { type: "text", chars, runs, style: main, name: chars.slice(0, 40) };
    const left = Math.min(...lines.map((l) => l.left)), right = Math.max(...lines.map((l) => l.right));
    const firstTop = block ? cb.top : lines[0].top - (lh - lines[0].h) / 2;
    if (ellipsis) {
      Object.assign(node, { x: cb.left, y: firstTop, w: cb.width, h: lh, wrap: true, truncate: true, maxLines: 1, align });
    } else if (!isNaN(clamp) && clamp > 0) {
      Object.assign(node, { x: cb.left, y: firstTop, w: cb.width, h: Math.min(lines.length, clamp) * lh, wrap: true, truncate: true, maxLines: clamp, align });
    } else if (lines.length === 1 || lines.length === breaks + 1) {
      if (block && align !== "LEFT") {
        /* centred or right-aligned lines get some slack, so a slightly wider font in Figma can't wrap them */
        const slack = Math.max(8, Math.round((right - left) * 0.12));
        const x = align === "CENTER" ? cb.left - slack / 2 : cb.left - slack;
        Object.assign(node, { x, y: firstTop, w: cb.width + slack, h: lines.length * lh, wrap: true, align });
      } else Object.assign(node, { x: left, y: firstTop, w: right - left, h: lines.length * lh, wrap: false, align });
    } else {
      const x = block ? cb.left : left, w = block ? cb.width : right - left;
      Object.assign(node, { x, y: firstTop, w, h: lines.length * lh, wrap: true, align });
    }
    node.x -= base.left; node.y -= base.top;
    if (el.closest(SYSTEM)) node.sys = true;
    return node;
  }

  /* text node mixed with elements: one layer per text node (or per line when it wraps around other content) */
  function looseText(tn, base) {
    const raw = tn.textContent;
    if (!raw.trim()) return [];
    const parent = tn.parentElement;
    const st = textStyle(parent);
    const range = document.createRange();
    range.selectNodeContents(tn);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5);
    if (!rects.length) return [];
    const lh = st.lineHeight || rects[0].height;
    let text = raw.replace(/\s+/g, " ").trim();
    if (st.upper) text = text.toUpperCase();
    const lines = lineGroups(rects);
    const sys = !!parent.closest(SYSTEM);
    const mk = (chars, l) => ({ type: "text", name: chars.slice(0, 40), chars, runs: [{ s: 0, e: chars.length, style: st }], style: st, sys,
      x: l.left - base.left, y: l.top - (lh - l.h) / 2 - base.top, w: l.right - l.left, h: lh, wrap: false, align: "LEFT" });
    if (lines.length === 1) return [mk(text, lines[0])];
    const out = [];
    const words = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(raw))) {
      const wr = document.createRange();
      wr.setStart(tn, m.index);
      wr.setEnd(tn, m.index + m[0].length);
      const r = wr.getClientRects()[0];
      if (r) words.push({ w: st.upper ? m[0].toUpperCase() : m[0], r });
    }
    let line = null;
    words.forEach((wd) => {
      if (!line || Math.abs(wd.r.top - line.top) > 2) { line = { top: wd.r.top, left: wd.r.left, right: wd.r.right, h: wd.r.height, words: [wd.w] }; out.push(line); }
      else { line.right = wd.r.right; line.words.push(wd.w); }
    });
    return out.map((l) => mk(l.words.join(" "), l));
  }

  /* ---------------------------------------------------------------- images */
  function bakeId(el) { const id = "b" + (++bakeSeq); bakeEls[id] = el; return id; }

  function imgNode(el, cs, r, base) {
    if (!el.complete || !el.naturalWidth) return [];
    const cb = contentBox(el, cs, r);
    if (cb.width < 0.5 || cb.height < 0.5) return [];
    const src = el.currentSrc || el.src;
    /* an SVG image (the dragon mark) comes across as vectors, not pixels */
    const svgText = window.__svgText && window.__svgText[src];
    if (svgText && (!cs.filter || cs.filter === "none")) {
      const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
      const s = doc.documentElement;
      if (s && s.tagName.toLowerCase() === "svg" && !doc.querySelector("parsererror")) {
        s.querySelectorAll("title,desc,metadata").forEach((t) => t.remove());
        (function strip(n) { [...n.childNodes].forEach((c) => { if (c.nodeType === 8) c.remove(); else if (c.nodeType === 1) strip(c); }); })(s);
        if (!s.getAttribute("viewBox")) s.setAttribute("viewBox", "0 0 " + (parseFloat(s.getAttribute("width")) || cb.width) + " " + (parseFloat(s.getAttribute("height")) || cb.height));
        s.setAttribute("width", cb.width);
        s.setAttribute("height", cb.height);
        return [{ type: "svg", name: el.alt ? el.alt + " mark" : "Mark", x: cb.left - base.left, y: cb.top - base.top, w: cb.width, h: cb.height,
          svg: new XMLSerializer().serializeToString(s), opacity: px(cs.opacity) }];
      }
    }
    const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px);
    const padded = pad.some((v) => v > 0) && (cs.objectFit === "contain" || cs.objectFit === "scale-down") && (!cs.filter || cs.filter === "none");
    /* a padded cut-out keeps its full box; the padding is baked into the embedded image,
       so photo and cut-out tiles share one geometry and stay instances of one component */
    const box = padded ? { left: r.left, top: r.top, width: r.width, height: r.height } : cb;
    const node = {
      type: "image", name: nameOf(el) !== "Frame" ? nameOf(el) : (el.alt || decodeURIComponent(src.split("/").pop().replace(/\.[^.]+$/, ""))),
      x: box.left - base.left, y: box.top - base.top, w: box.width, h: box.height,
      fill: { type: "image", src, iw: el.naturalWidth, ih: el.naturalHeight, fit: cs.objectFit, pos: cs.objectPosition, boxW: cb.width, boxH: cb.height },
      radius: pad.some((v) => v > 0) && !padded ? [0, 0, 0, 0] : clampRadii(radii(cs), box.width, box.height),
      opacity: px(cs.opacity)
    };
    if (padded) Object.assign(node.fill, { pad, outerW: r.width, outerH: r.height });
    if (cs.filter && cs.filter !== "none") node.fill = { type: "image", bake: bakeId(el), boxW: cb.width, boxH: cb.height, fit: "fill" };
    return [node];
  }

  /* ---------------------------------------------------------------- svg */
  function setPaint(d, prop, value) {
    const c = color(value);
    if (!c) { d.setAttribute(prop, "none"); return; }
    const h = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
    d.setAttribute(prop, "#" + h(c.r) + h(c.g) + h(c.b));
    if (c.a < 1) d.setAttribute(prop + "-opacity", c.a);
  }

  const LEAF = "path,rect,circle,ellipse,line,polyline,polygon,use";
  const HIDDEN_PARENTS = "defs,clipPath,mask,pattern,marker,symbol,filter";

  function svgNodes(svg, base) {
    const r = svg.getBoundingClientRect();
    if (r.width < 0.5 || r.height < 0.5) return [];
    const x = r.left - base.left, y = r.top - base.top;
    const clone = svg.cloneNode(true);
    const src = [svg, ...svg.querySelectorAll("*")];
    const dst = [clone, ...clone.querySelectorAll("*")];
    src.forEach((s, i) => {
      const cs = getComputedStyle(s);
      const d = dst[i];
      ["fill", "stroke"].forEach((prop) => {
        const attr = s.getAttribute(prop);
        if (attr && attr !== "none") setPaint(d, prop, cs[prop]);
        else if (!attr && s !== svg && prop === "fill" && s.tagName !== "g" && !s.closest(HIDDEN_PARENTS)) {
          const f = cs.fill;
          if (f && f !== "none") setPaint(d, "fill", f);
        }
      });
      d.removeAttribute("class");
    });
    clone.removeAttribute("style");
    clone.setAttribute("width", r.width);
    clone.setAttribute("height", r.height);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", "0 0 " + (svg.width.baseVal.value || r.width) + " " + (svg.height.baseVal.value || r.height));

    /* text inside the SVG becomes real text layers */
    const texts = [];
    Array.from(svg.querySelectorAll("text")).forEach((t, i) => {
      const tr = t.getBoundingClientRect();
      const cs = getComputedStyle(t);
      const st = textStyle(t);
      st.color = color(cs.fill) || st.color;
      const chars = t.textContent.trim();
      if (chars && tr.width) texts.push({ type: "text", name: chars, chars, runs: [{ s: 0, e: chars.length, style: st }], style: st, sys: !!t.closest(SYSTEM), x: tr.left - base.left, y: tr.top - base.top, w: tr.width, h: tr.height, wrap: false, align: "LEFT" });
    });
    clone.querySelectorAll("text").forEach((t) => t.remove());

    const name = svg.getAttribute("aria-label") || (svg.classList.contains("map") ? "Map" : (svg.getAttribute("class") || "").split(" ").filter((c) => c.indexOf("ic-") === 0).map((c) => "Icon/" + c.slice(3))[0] || "Icon");
    const images = Array.from(svg.querySelectorAll("image")).filter((im) => !im.closest(HIDDEN_PARENTS));
    if (!images.length) {
      return [{ type: "svg", name, x, y, w: r.width, h: r.height, svg: clone.outerHTML }, ...texts];
    }

    /* split around embedded images so the stacking order survives */
    const leavesSrc = Array.from(svg.querySelectorAll(LEAF)).filter((l) => !l.closest(HIDDEN_PARENTS));
    const order = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const children = [];
    const bounds = [...images, null];
    let prev = null;
    bounds.forEach((im, k) => {
      const keep = new Set(leavesSrc.filter((l) => (!prev || order(prev, l) < 0) && (!im || order(l, im) < 0)));
      if (keep.size) {
        const seg = clone.cloneNode(true);
        const segLeaves = Array.from(seg.querySelectorAll(LEAF)).filter((l) => !l.closest(HIDDEN_PARENTS));
        const allSrc = Array.from(svg.querySelectorAll(LEAF)).filter((l) => !l.closest(HIDDEN_PARENTS));
        segLeaves.forEach((l, i) => { if (!keep.has(allSrc[i])) l.remove(); });
        seg.querySelectorAll("image").forEach((n) => n.remove());
        children.push({ type: "svg", name: k === 0 ? name : name + " " + (k + 1), x: 0, y: 0, w: r.width, h: r.height, svg: seg.outerHTML });
      }
      if (im) {
        const ir = im.getBoundingClientRect();
        const href = im.getAttribute("href") || im.getAttribute("xlink:href");
        const cp = im.getAttribute("clip-path");
        let round = false;
        if (cp) { const ref = svg.querySelector(cp.replace(/^url\(["']?|["']?\)$/g, "")); round = !!(ref && ref.querySelector("circle,ellipse")); }
        const par = im.getAttribute("preserveAspectRatio") || "";
        children.push({ type: "image", name: "Image", x: ir.left - r.left, y: ir.top - r.top, w: ir.width, h: ir.height,
          fill: { type: "image", src: new URL(href, document.baseURI).href, fit: /slice/.test(par) ? "cover" : "contain", pos: "50% 50%", boxW: ir.width, boxH: ir.height },
          radius: round ? [ir.width / 2, ir.width / 2, ir.width / 2, ir.width / 2] : [0, 0, 0, 0], opacity: px(im.getAttribute("opacity") || 1) || 1 });
        prev = im;
      }
    });
    return [{ type: "frame", name, x, y, w: r.width, h: r.height, fills: [], radius: [0, 0, 0, 0], clip: true, opacity: 1, effects: [], stroke: null, children }, ...texts];
  }

  /* ---------------------------------------------------------------- pseudo elements */
  function pseudo(el, which, base) {
    const ps = getComputedStyle(el, which);
    if (!ps || ps.content === "none" || ps.content === "normal" || ps.display === "none") return [];
    const bg = color(ps.backgroundColor);
    if (!bg || ps.position !== "absolute") return [];
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const W = r.width - px(cs.borderLeftWidth) - px(cs.borderRightWidth), Hh = r.height - px(cs.borderTopWidth) - px(cs.borderBottomWidth);
    const auto = (v) => v === "auto";
    let w = auto(ps.width) ? W - px(ps.left) - px(ps.right) : px(ps.width);
    let h = auto(ps.height) ? Hh - px(ps.top) - px(ps.bottom) : px(ps.height);
    const left = !auto(ps.left) ? px(ps.left) : W - px(ps.right) - w;
    const top = !auto(ps.top) ? px(ps.top) : Hh - px(ps.bottom) - h;
    if (w <= 0 || h <= 0) return [];
    return [{ type: "frame", name: "Indicator", x: r.left + px(cs.borderLeftWidth) + left - base.left, y: r.top + px(cs.borderTopWidth) + top - base.top, w, h,
      fills: [{ type: "solid", color: bg }], radius: clampRadii(radii(ps), w, h), clip: false, opacity: 1, effects: [], stroke: null, children: [], z: 0.5 }];
  }

  /* ---------------------------------------------------------------- tree */
  function build(el, base, rootEl) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || (px(cs.opacity) === 0 && el !== rootEl)) return [];
    const tag = el.tagName.toLowerCase();
    if (/^(script|style|template|br|iframe|link|meta)$/.test(tag)) return [];
    const r = el.getBoundingClientRect();
    const z = zOf(el, cs);
    if (tag === "svg") return svgNodes(el, base).map((n) => Object.assign(n, { z: n.z || z }));
    if (tag === "img") return imgNode(el, cs, r, base).map((n) => Object.assign(n, { z }));

    const ck = el === rootEl && rootEl.__noComp ? null : compKey(el);
    const go = el.getAttribute("data-go");
    const bw = borders(cs);
    const fills = backgroundLayers(el, cs, r);
    const effects = shadows(cs);
    const clipped = cs.overflow !== "visible";
    const textOnly = inlineOnly(el, true);
    const isFrame = el === rootEl || !!ck || !!go || fills.length > 0 || bw.some((v) => v > 0) || effects.length > 0 ||
      px(cs.opacity) < 1 || (clipped && !textOnly && el.children.length > 0) || (el.dataset && el.dataset.name && el.dataset.frame !== undefined);
    if (r.width < 0.5 && r.height < 0.5 && !isFrame) {
      const kids = [];
      el.childNodes.forEach((n) => { if (n.nodeType === 1) kids.push(...build(n, base, rootEl)); });
      return kids;
    }
    const myBase = isFrame ? r : base;
    let kids = pseudo(el, "::before", myBase);
    if (textOnly) {
      const t = richText(el, cs, myBase);
      if (t) kids.push(t);
    } else {
      el.childNodes.forEach((n) => {
        if (n.nodeType === 3) kids.push(...looseText(n, myBase));
        else if (n.nodeType === 1) kids.push(...build(n, myBase, rootEl));
      });
    }
    kids.push(...pseudo(el, "::after", myBase));
    if (!isFrame) {
      if (z === 0.5) kids.forEach((k) => { k.z = Math.max(k.z || 0, 0.5); });
      else if (z !== 0) kids.forEach((k) => { k.z = z; });
      return kids;
    }
    kids.forEach((k) => { if (k.z === undefined) k.z = 0; });
    kids.sort((a, b) => a.z - b.z);
    const sideColors = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
    const side = bw.findIndex((v) => v > 0);
    const bc = side > -1 ? color(sideColors[side]) : null;
    const node = {
      type: "frame", name: nameOf(el), x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height,
      fills, effects, opacity: Math.round(px(cs.opacity) * 1000) / 1000,
      stroke: bw.some((v) => v > 0) && bc ? { color: bc, top: bw[0], right: bw[1], bottom: bw[2], left: bw[3], dashed: cs.borderTopStyle === "dashed" } : null,
      radius: clampRadii(radii(cs), r.width, r.height),
      clip: clipped, children: kids, z
    };
    if (ck) node.comp = ck;
    if (go) node.go = go;
    return [node];
  }

  /* Wrap Gallery's progress bar and its labels so they read as one component */
  function prepare(root) {
    root.querySelectorAll(".segs").forEach((s) => {
      const lab = s.nextElementSibling;
      if (!lab || !lab.classList.contains("segs-l") || s.parentElement.classList.contains("progress-wrap")) return;
      const w = document.createElement("div");
      w.className = "progress-wrap";
      s.parentElement.insertBefore(w, s);
      w.appendChild(s);
      w.appendChild(lab);
    });
  }

  function serialize(el, opt) {
    opt = opt || {};
    prepare(el);
    if (opt.noComp) el.__noComp = true;
    const r = el.getBoundingClientRect();
    const tree = build(el, r, el)[0];
    tree.x = 0; tree.y = 0;
    if (opt.screen) tree.clip = true;
    if (opt.go) tree.go = opt.go;
    return { tree };
  }

  /* isolate one filtered image on a transparent page for a screenshot */
  let saved = null;
  function bakeStart(id) {
    const el = bakeEls[id];
    const cs = getComputedStyle(el);
    const cb = contentBox(el, cs, el.getBoundingClientRect());
    const holder = document.createElement("div");
    holder.id = "__bake";
    holder.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;background:transparent;width:" + cb.width + "px;height:" + cb.height + "px";
    const img = document.createElement("img");
    img.src = el.currentSrc || el.src;
    img.style.cssText = "display:block;margin:0;padding:0;border:0;width:" + cb.width + "px;height:" + cb.height + "px;object-fit:" + cs.objectFit + ";object-position:" + cs.objectPosition + ";filter:" + cs.filter;
    holder.appendChild(img);
    saved = { html: document.documentElement.style.background, body: document.body.style.background, kids: [] };
    for (const k of document.body.children) { if (k.tagName.toLowerCase() === "svg") continue; saved.kids.push([k, k.style.visibility]); k.style.visibility = "hidden"; }
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.appendChild(holder);
    return new Promise((res) => { if (img.complete) res(); else img.onload = () => res(); });
  }
  function bakeEnd() {
    const h = document.getElementById("__bake");
    if (h) h.remove();
    if (!saved) return;
    document.documentElement.style.background = saved.html;
    document.body.style.background = saved.body;
    saved.kids.forEach(([k, v]) => { k.style.visibility = v; });
    saved = null;
  }

  function checkSvg(str) {
    const doc = new DOMParser().parseFromString(str, "image/svg+xml");
    return !doc.querySelector("parsererror");
  }

  window.__md = { serialize, bakeStart, bakeEnd, checkSvg, compKey };
})();
