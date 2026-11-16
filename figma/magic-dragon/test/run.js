/* Runs plugin/code.js against the mock Figma API twice (Geist installed, and Geist
   missing so text falls back to Inter) and prints what it created.

     node figma/magic-dragon/test/run.js            # check only
     node figma/magic-dragon/test/run.js --preview  # also render every Figma page
                                                    # to figma/magic-dragon/preview/

   The previews are drawn from the nodes the plugin created in the mock (frames,
   text, instances, images, auto layout), not from the HTML, so they show what the
   plugin builds. */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { createMock } = require("./mock-figma");

const CODE = path.join(__dirname, "../plugin/code.js");
const PREVIEW = path.join(__dirname, "../preview");
const FONT_DIR = path.resolve(__dirname, "../../../prototype/magic-dragon/assets/fonts");
const STYLES = { Geist: ["Regular", "Medium", "SemiBold", "Bold"], Inter: ["Regular", "Medium", "Semi Bold", "Bold"] };
const fontList = (fams) => fams.flatMap((f) => STYLES[f].map((s) => ({ family: f, style: s })));

async function runOnce(fonts) {
  const mock = createMock({ fonts });
  const logs = [];
  const con = { log: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push("ERROR " + a.map((x) => (x && x.stack) || x).join(" ")) };
  const t0 = Date.now();
  new Function("figma", "console", fs.readFileSync(CODE, "utf8"))(mock.figma, con);
  let timer;
  await Promise.race([mock.done, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("plugin did not finish in 180 s")), 180000); })]);
  clearTimeout(timer);
  return { mock, logs, ms: Date.now() - t0 };
}

/* ---------------------------------------------------------------- preview */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const css = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => k + ":" + v).join(";");
const rgba = (c, a) => "rgba(" + Math.round(c.r * 255) + "," + Math.round(c.g * 255) + "," + Math.round(c.b * 255) + "," + (a === undefined ? 1 : a) + ")";
const weightOf = (style) => (/semi|demi/i.test(style) ? 600 : /bold/i.test(style) ? 700 : /medium/i.test(style) ? 500 : 400);

function background(fills, n, imgs) {
  const layers = [], sizes = [], posns = [];
  for (const f of (fills || []).filter((f) => f.visible !== false).slice().reverse()) {
    if (f.type === "SOLID") { const c = rgba(f.color, f.opacity === undefined ? 1 : f.opacity); layers.push("linear-gradient(" + c + "," + c + ")"); sizes.push("100% 100%"); posns.push("0 0"); }
    else if (f.type === "IMAGE") {
      layers.push("url(" + imgs[f.imageHash] + ")");
      if (f.scaleMode === "FIT") { sizes.push("contain"); posns.push("center"); }
      else if (f.scaleMode === "CROP" && f.imageTransform) {
        const [[sw, , x0], [, sh, y0]] = f.imageTransform;
        const dw = n.width / sw, dh = n.height / sh;
        sizes.push(dw + "px " + dh + "px"); posns.push(-x0 * dw + "px " + -y0 * dh + "px");
      } else { sizes.push("cover"); posns.push("center"); }
    } else if (/GRADIENT/.test(f.type)) {
      const [[a, b]] = f.gradientTransform;
      const ang = (Math.atan2(a, -b) * 180) / Math.PI;
      layers.push("linear-gradient(" + ang.toFixed(1) + "deg," + f.gradientStops.map((s) => rgba(s.color, s.color.a) + " " + s.position * 100 + "%").join(",") + ")");
      sizes.push("100% 100%"); posns.push("0 0");
    }
  }
  if (!layers.length) return {};
  return { "background-image": layers.join(","), "background-size": sizes.join(","), "background-position": posns.join(","), "background-repeat": "no-repeat" };
}

function radius(n) {
  if (n.topLeftRadius !== undefined || n.topRightRadius !== undefined) return [n.topLeftRadius || 0, n.topRightRadius || 0, n.bottomRightRadius || 0, n.bottomLeftRadius || 0].map((v) => v + "px").join(" ");
  return n.cornerRadius ? n.cornerRadius + "px" : undefined;
}

function textHtml(n, s) {
  if (!n._chars) return "";
  const auto = n._autoResize;
  s["white-space"] = auto === "WIDTH_AND_HEIGHT" ? "pre" : "pre-wrap";
  if (auto !== "WIDTH_AND_HEIGHT") s.width = n.width + "px";
  if (auto === "NONE") s.height = n.height + "px";
  s["text-align"] = n._align.toLowerCase();
  if (n._trunc === "ENDING") {
    if ((n._maxLines || 1) === 1) Object.assign(s, { "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" });
    else Object.assign(s, { display: "-webkit-box", "-webkit-line-clamp": n._maxLines, "-webkit-box-orient": "vertical", overflow: "hidden" });
  }
  const lh = (st) => (st.lineHeight.unit === "PIXELS" ? st.lineHeight.value + "px" : st.lineHeight.unit === "PERCENT" ? st.lineHeight.value + "%" : "normal");
  s["line-height"] = lh(n._per[0] || n._base);
  s["font-family"] = "Geist";
  const spans = [];
  let cur = null;
  for (let i = 0; i < n._chars.length; i++) {
    const p = n._per[i] || n._base;
    const k = JSON.stringify([p.fontName, p.fontSize, p.lineHeight, p.letterSpacing, p.fills, p.textDecoration]);
    if (!cur || cur.k !== k) { cur = { k, p, text: "" }; spans.push(cur); }
    cur.text += n._chars[i];
  }
  const inner = spans.map(({ p, text }) => {
    const f = (p.fills || []).find((x) => x.type === "SOLID");
    return '<span style="' + css({
      "font-family": p.fontName.family === "Geist" ? "Geist" : "Inter,Geist,sans-serif", "font-weight": weightOf(p.fontName.style), "font-size": p.fontSize + "px", "line-height": lh(p),
      "letter-spacing": p.letterSpacing.unit === "PIXELS" ? p.letterSpacing.value + "px" : p.letterSpacing.value / 100 + "em",
      color: f ? rgba(f.color, f.opacity === undefined ? 1 : f.opacity) : "transparent", "text-decoration": p.textDecoration === "UNDERLINE" ? "underline" : p.textDecoration === "STRIKETHROUGH" ? "line-through" : undefined
    }) + '">' + esc(text) + "</span>";
  }).join("");
  return '<div style="' + css(s) + '">' + inner + "</div>";
}

const ALIGN = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between", BASELINE: "baseline" };
function nodeHtml(n, imgs, parentAuto) {
  if (n.visible === false) return "";
  const s = parentAuto ? { position: "relative", flex: "none" } : { position: "absolute", left: n.x + "px", top: n.y + "px" };
  if (n.opacity !== undefined && n.opacity < 1) s.opacity = n.opacity;
  if (n.type === "TEXT") return textHtml(n, s);
  const auto = n._layoutMode && n._layoutMode !== "NONE";
  const horiz = n._layoutMode === "HORIZONTAL";
  const hugW = auto && ((horiz && n.primaryAxisSizingMode === "AUTO") || (!horiz && n.counterAxisSizingMode === "AUTO"));
  const hugH = auto && ((!horiz && n.primaryAxisSizingMode === "AUTO") || (horiz && n.counterAxisSizingMode === "AUTO"));
  if (!hugW) s.width = n.width + "px";
  if (!hugH) s.height = n.height + "px";
  s["box-sizing"] = "border-box";
  s["border-radius"] = radius(n);
  if (n.clipsContent && n.type !== "SECTION" && n.type !== "COMPONENT_SET") s.overflow = "hidden";
  Object.assign(s, background(n._fills, n, imgs));
  const sh = (n._effects || []).filter((e) => /SHADOW/.test(e.type)).map((e) => (e.type === "INNER_SHADOW" ? "inset " : "") + e.offset.x + "px " + e.offset.y + "px " + e.radius + "px " + (e.spread || 0) + "px " + rgba(e.color, e.color.a));
  if (sh.length) s["box-shadow"] = sh.join(",");
  if (auto) Object.assign(s, { display: "flex", "flex-direction": horiz ? "row" : "column", "justify-content": ALIGN[n.primaryAxisAlignItems], "align-items": ALIGN[n.counterAxisAlignItems], gap: (n.itemSpacing || 0) + "px", padding: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map((v) => (v || 0) + "px").join(" ") });
  let inner = n._svg ? n._svg.replace(/<svg/, '<svg style="display:block;position:absolute;left:0;top:0"') : "";
  inner += (n.children || []).map((c) => nodeHtml(c, imgs, auto)).join("");
  if ((n._strokes || []).length) {
    const st = n._strokes[0];
    const w = n.strokeTopWeight !== undefined ? [n.strokeTopWeight, n.strokeRightWeight, n.strokeBottomWeight, n.strokeLeftWeight] : [n.strokeWeight, n.strokeWeight, n.strokeWeight, n.strokeWeight];
    inner += '<div style="' + css({ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, "box-sizing": "border-box", "border-style": n._dash && n._dash.length ? "dashed" : "solid", "border-color": st.type === "SOLID" ? rgba(st.color, st.opacity === undefined ? 1 : st.opacity) : "#999", "border-width": w.map((v) => (v || 0) + "px").join(" "), "border-radius": radius(n), "pointer-events": "none" }) + '"></div>';
  }
  if (n.type === "SECTION") inner = '<div style="position:absolute;left:24px;top:22px;font:600 22px/28px Geist;color:#16131B;white-space:nowrap">' + esc(n.name) + "</div>" + inner;
  return '<div style="' + css(s) + '">' + inner + "</div>";
}

function bounds(page) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of page.children) {
    const w = n.type === "TEXT" && n._autoResize === "WIDTH_AND_HEIGHT" ? n._chars.length * (n._base.fontSize || 14) * 0.56 : n.width;
    const h = n.type === "TEXT" ? Math.max(n.height, (n._base.fontSize || 14) * 1.5) : n.height;
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + h);
  }
  return { x0, y0, x1, y1 };
}

function absBox(n) {
  let x = 0, y = 0;
  for (let p = n; p && p.type !== "PAGE"; p = p.parent) { x += p.x; y += p.y; }
  return { x, y, w: n.width, h: n.height };
}

function pageHtml(page, imgs, opts) {
  const pad = 120;
  const b = bounds(page);
  const W = b.x1 - b.x0 + pad * 2, Hh = b.y1 - b.y0 + pad * 2;
  const scale = Math.min(1, (opts.maxWidth || 2400) / W);
  let overlay = "";
  if (opts.links) {
    const nodes = [];
    (function w(n) { for (const c of n.children || []) { if ((c.reactions || []).length) nodes.push(c); w(c); } })(page);
    const paths = [];
    for (const n of nodes) {
      for (const r of n.reactions) {
        const a = (r.actions || [])[0];
        if (!a || a.type !== "NODE") continue;
        const dest = opts.byId.get(a.destinationId);
        if (!dest) continue;
        const s = absBox(n), d = absBox(dest);
        const sx = s.x + s.w / 2, sy = s.y + s.h / 2;
        const right = d.x > sx;
        const dx = right ? d.x : d.x + d.w, dy = d.y + Math.min(d.h / 2, 120);
        const c = Math.max(80, Math.abs(dx - sx) / 2);
        paths.push('<circle cx="' + sx + '" cy="' + sy + '" r="7" fill="#0D99FF"/><path d="M' + sx + " " + sy + "C" + (sx + (right ? c : -c)) + " " + sy + "," + (dx + (right ? -c : c)) + " " + dy + "," + dx + " " + dy + '" stroke="#0D99FF" stroke-width="4" fill="none"/>');
      }
    }
    overlay = '<svg style="position:absolute;left:0;top:0;overflow:visible" width="1" height="1">' + paths.join("") + "</svg>";
  }
  const body = page.children.map((c) => nodeHtml(c, imgs, false)).join("");
  const fonts = [400, 500, 600, 700].map((w) => "@font-face{font-family:Geist;src:url(file://" + FONT_DIR + "/Geist_" + w + { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold" }[w] + ".ttf);font-weight:" + w + "}").join("");
  const html = "<!doctype html><html><head><meta charset=utf-8><style>" + fonts + "*{margin:0;padding:0}html,body{background:#F5F5F5;-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}</style></head><body>" +
    '<div style="position:relative;width:' + W * scale + "px;height:" + Hh * scale + 'px;overflow:hidden">' +
    '<div style="position:absolute;left:0;top:0;width:' + W + "px;height:" + Hh + "px;transform:scale(" + scale + ');transform-origin:0 0">' +
    '<div style="position:absolute;left:' + (pad - b.x0) + "px;top:" + (pad - b.y0) + 'px">' + body + overlay + "</div></div></div></body></html>";
  return { html, width: Math.ceil(W * scale), height: Math.ceil(Hh * scale) };
}

async function renderPreviews(mock) {
  const env = require("../lib/env");
  fs.mkdirSync(PREVIEW, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "md-figma-preview-"));
  const imgs = {};
  for (const [hash, img] of mock.images) {
    const file = path.join(tmp, hash + "." + (img.size.type === "jpeg" ? "jpg" : img.size.type));
    fs.writeFileSync(file, img.bytes);
    imgs[hash] = "file://" + file;
  }
  const byId = new Map();
  (function w(n) { byId.set(n.id, n); (n.children || []).forEach(w); })(mock.root);
  const jobs = mock.root.children.map((p) => ({ page: p, name: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") }));
  const screens = mock.root.children.find((p) => p.name === "Screens");
  if (screens) jobs.push({ page: screens, name: "prototype", links: true });
  const browser = await env.launch();
  const written = [];
  for (const j of jobs) {
    const { html, width, height } = pageHtml(j.page, imgs, { links: j.links, byId, maxWidth: j.name === "cover" ? 1920 : 2400 });
    const file = path.join(tmp, j.name + ".html");
    fs.writeFileSync(file, html);
    const page = await browser.newPage({ viewport: { width: Math.max(320, width), height: Math.min(Math.max(240, height), 16000) } });
    await page.goto("file://" + file);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const out = path.join(PREVIEW, j.name + ".jpg");
    await page.screenshot({ path: out, type: "jpeg", quality: 84, fullPage: true });
    await page.close();
    written.push(path.relative(process.cwd(), out) + " (" + width + "x" + height + ", " + Math.round(fs.statSync(out).size / 1024) + " KB)");
  }
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  return written;
}

(async () => {
  const size = fs.statSync(CODE).size;
  console.log("plugin/code.js:", (size / 1e6).toFixed(2), "MB");
  let geist = null, failed = false;
  for (const [label, fams] of [["Geist installed", ["Geist", "Inter"]], ["Geist missing (Inter fallback)", ["Inter"]]]) {
    let r;
    try { r = await runOnce(fontList(fams)); }
    catch (e) { console.log("\n" + label + ": FAILED -", e.message); failed = true; continue; }
    const c = r.mock.counts();
    const ok = r.mock.notes.close === null;
    console.log("\n" + label + ": " + (ok ? "ran cleanly" : "FAILED") + " in " + (r.ms / 1000).toFixed(1) + " s");
    if (!ok) { failed = true; console.log("  " + r.mock.notes.close); r.logs.forEach((l) => console.log("  " + l)); continue; }
    console.log("  notify:", r.mock.notes.notify.join(" | "));
    r.logs.forEach((l) => console.log("  log:", l));
    console.log("  pages", c.pages, "| sections", c.sections, "| frames", c.frames, "(+" + c.svgFrames + " vector icons/maps) | text layers", c.texts);
    console.log("  components", c.components, "| component sets", c.componentSets, "| variants", c.variants, "| instances", c.instances);
    console.log("  variables", c.variables, "in", c.collections, "collection | text styles", c.textStyles);
    console.log("  images", c.images, "unique (" + c.imageMB + " MB) | image layers", c.imageLayersAll, "(" + c.imageLayers + " outside instances)");
    console.log("  prototype links", c.links, JSON.stringify(c.linksByTrigger), "| flow starting points", c.flowStarts, "| thumbnail:", r.mock.notes.thumbnail || "none");
    if (r.mock.notes.deprecations.length) console.log("  deprecated calls:", [...new Set(r.mock.notes.deprecations)].join(", "));
    if (fams[0] === "Geist") geist = r;
  }
  if (failed) process.exit(1);
  if (process.argv.includes("--preview") && geist) {
    const files = await renderPreviews(geist.mock);
    console.log("\npreviews:\n  " + files.join("\n  "));
  }
})().catch((e) => { console.error(e); process.exit(1); });
