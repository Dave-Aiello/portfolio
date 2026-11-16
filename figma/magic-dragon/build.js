/* Builds the Magic Dragon Figma plugin (figma/magic-dragon/plugin/code.js) from the
   Gallery screens in prototype/magic-dragon/. Run from the repo root:

     node figma/magic-dragon/build.js

   It starts its own local server, reads every screen from the real DOM (so the
   Figma file matches the HTML), reads the component sheet and the Cover and Motion
   boards in figma/magic-dragon/boards/, embeds the images, and writes code.js.
   Screens are discovered from the files, so new screens are picked up on the next
   run. Needs Node, Playwright and sharp. */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const env = require("./lib/env");
const { serve } = require("./lib/server");
const config = require("./screens.config");

const REPO = path.resolve(__dirname, "../..");
const PROTO = path.join(REPO, "prototype/magic-dragon");
const SCREENS = path.join(PROTO, "src/gallery");
const SERIALIZER = path.join(__dirname, "lib/serialize.js");
const TEMPLATE = path.join(__dirname, "plugin/code.template.js");
const OUT = path.join(__dirname, "plugin/code.js");
const BUDGET = 14.5e6;
const WEIGHT_NAMES = { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold" };
const warnings = [];
const warn = (m) => { warnings.push(m); };

function walk(n, fn, parent) { if (!n) return; fn(n, parent); (n.children || []).forEach((c) => walk(c, fn, n)); }
function imageFills(n) {
  const out = [];
  if (n.type === "image" && n.fill) out.push(n.fill);
  (n.fills || []).forEach((f) => { if (f.type === "image") out.push(f); });
  return out;
}
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex");
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function ready(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 20000 });
  await page.waitForTimeout(80);
}

let pageSeq = 0;
const bakes = {};
async function grab(page, selector, index, opt) {
  const tree = await page.evaluate(([sel, i, o]) => window.__md.serialize(document.querySelectorAll(sel)[i], o).tree, [selector, index, opt || {}]);
  const prefix = "p" + (++pageSeq) + "-";
  const fills = [];
  walk(tree, (n) => imageFills(n).forEach((f) => { if (f.bake) fills.push(f); }));
  for (const f of fills) {
    const gid = prefix + f.bake;
    if (!bakes[gid]) {
      await page.evaluate((id) => window.__md.bakeStart(id), f.bake);
      bakes[gid] = await page.locator("#__bake").screenshot({ omitBackground: true });
      await page.evaluate(() => window.__md.bakeEnd());
    }
    f.bake = gid;
  }
  const svgs = [];
  walk(tree, (n) => { if (n.type === "svg") svgs.push(n); });
  const ok = await page.evaluate((list) => list.map((s) => window.__md.checkSvg(s)), svgs.map((s) => s.svg));
  ok.forEach((good, i) => { if (!good) warn("SVG did not parse: " + svgs[i].name); });
  return tree;
}

/* The clickable prototype keeps a FRAMES list in app.js (title, design note, and
   "after" for screens that move on by themselves). Read it when it is there. */
function readFrames() {
  const file = path.join(PROTO, "app.js");
  if (!fs.existsSync(file)) return {};
  const src = fs.readFileSync(file, "utf8");
  const at = src.search(/FRAMES\s*=\s*\[/);
  if (at < 0) return {};
  let i = src.indexOf("[", at), depth = 0, str = null;
  const start = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (str) { if (ch === "\\") i++; else if (ch === str) str = null; continue; }
    if (ch === '"' || ch === "'") str = ch;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) break;
  }
  try {
    const list = JSON.parse(src.slice(start, i + 1));
    const out = {};
    list.forEach((f) => { if (f && f.id) out[f.id] = f; });
    return out;
  } catch (e) { warn("could not read FRAMES from app.js: " + e.message); return {}; }
}

/* ---------------------------------------------------------------- read everything */
async function readAll() {
  const srv = await serve(REPO);
  const browser = await env.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => errors.push("failed " + r.url()));

  let direction = {};
  try { direction = JSON.parse(fs.readFileSync(path.join(SCREENS, "direction.json"), "utf8")); } catch (e) { /* optional */ }
  const meta = {};
  (direction.screens || []).forEach((s) => { if (s.file) meta[s.file] = s; if (s.id) meta["id:" + s.id] = s; });
  const frames = readFrames();

  const files = fs.readdirSync(SCREENS).filter((f) => /^\d+.*\.html$/.test(f)).sort();
  const screens = [];
  let cssVars = null;
  for (const f of files) {
    const file = f.replace(/\.html$/, "");
    const id = file.replace(/^\d+[-_]?/, "");
    await page.goto(srv.url + "/prototype/magic-dragon/src/gallery/" + f, { waitUntil: "networkidle" });
    await ready(page);
    await page.addScriptTag({ path: SERIALIZER });
    if (!cssVars) {
      cssVars = await page.evaluate(() => {
        const out = {};
        for (const sh of document.styleSheets) {
          let rules; try { rules = sh.cssRules; } catch (e) { continue; }
          for (const r of rules) if (r.selectorText === ":root") for (const p of r.style) if (p.indexOf("--") === 0) out[p.slice(2)] = r.style.getPropertyValue(p).trim();
        }
        return out;
      });
    }
    const rootGo = await page.evaluate(() => { const s = document.querySelector(".screen"); return s ? s.getAttribute("data-go") : null; });
    const tree = await grab(page, ".screen", 0, { screen: true });
    delete tree.go;
    /* direction.json wins, then the prototype's FRAMES */
    const m = Object.assign({}, frames[id] || {}, meta[file] || meta["id:" + id] || {});
    screens.push({ id, file, num: (file.match(/^\d+/) || [""])[0], title: m.label || m.title || id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()), note: m.note || null, after: m.after || null, rootGo, tree });
  }

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(srv.url + "/figma/magic-dragon/boards/components.html", { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await ready(page);
  await page.addScriptTag({ path: SERIALIZER });
  const count = await page.evaluate(() => document.querySelectorAll("[data-comp]").length);
  const components = [];
  for (let i = 0; i < count; i++) {
    const tree = await grab(page, "[data-comp]", i, {});
    if (!tree.comp) { warn("Component sheet item " + i + " is not a known component"); continue; }
    components.push(tree);
  }

  const boards = {};
  for (const [name, file, vw, vh] of [["cover", "cover.html", 1920, 960], ["motion", "motion.html", 3300, 2200]]) {
    await page.setViewportSize({ width: vw, height: vh });
    await page.goto(srv.url + "/figma/magic-dragon/boards/" + file, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    await ready(page);
    await page.addScriptTag({ path: SERIALIZER });
    const secs = await page.evaluate(() => [...document.querySelectorAll("section.board-section")].map((s) => {
      const r = s.getBoundingClientRect();
      return { name: s.dataset.name, bare: s.hasAttribute("data-bare"), x: r.left, y: r.top, w: r.width, h: r.height };
    }));
    for (let i = 0; i < secs.length; i++) secs[i].children = (await grab(page, "section.board-section", i, { noComp: true })).children;
    boards[name] = { sections: secs };
  }
  await browser.close();
  await srv.close();
  [...new Set(errors)].forEach((e) => warn("page: " + e));
  return { screens, components, boards, cssVars: cssVars || {} };
}

/* ---------------------------------------------------------------- tokens and type */
function hexOf(v) {
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return ("#" + v.slice(1).split("").map((c) => c + c).join("")).toUpperCase();
  const m = v.match(/^rgb\((\d+)[ ,]+(\d+)[ ,]+(\d+)\)$/);
  if (m) return "#" + m.slice(1, 4).map((n) => (+n).toString(16).padStart(2, "0")).join("").toUpperCase();
  return null;
}
function buildTokens(cssVars) {
  const out = [], names = new Set();
  for (const [k, v] of Object.entries(cssVars)) {
    const hex = hexOf(v);
    if (!hex) continue;
    const [name, description] = config.tokens[k] || ["Gallery/" + k, "From the Gallery stylesheet (--" + k + ")"];
    if (names.has(name)) continue;
    names.add(name);
    out.push({ name, hex, description, cssVar: "--" + k });
  }
  for (const [name, hex, description] of config.extraTokens) if (!names.has(name)) { names.add(name); out.push({ name, hex, description }); }
  const order = config.tokenGroups;
  return out.sort((a, b) => (order.indexOf(a.name.split("/")[0]) + 99) % 99 - (order.indexOf(b.name.split("/")[0]) + 99) % 99);
}

function buildType(trees, boards) {
  const usage = {};
  trees.forEach((t) => walk(t, (n) => {
    if (n.type !== "text" || n.sys) return;
    n.runs.forEach((r) => {
      const st = r.style;
      if (!st || st.family !== "sans") return;
      const k = Math.round(st.size) + "/" + st.weight;
      const u = usage[k] = usage[k] || { size: Math.round(st.size), weight: st.weight, lh: {}, ls: {}, samples: [] };
      const len = r.e - r.s;
      const lh = st.lineHeight || "auto";
      u.lh[lh] = (u.lh[lh] || 0) + len;
      u.ls[st.letterSpacing] = (u.ls[st.letterSpacing] || 0) + len;
      const text = n.chars.slice(r.s, r.e).trim();
      if (text.length && text.indexOf("\n") < 0) u.samples.push(text);
    });
  }));
  /* one style per size and weight; its line height and tracking are the most used ones,
     and text that differs keeps a local override (as a designer would) */
  const styles = [];
  for (const [k, u] of Object.entries(usage)) {
    const name = config.typeNames[k] || "Other/" + u.size + " " + (WEIGHT_NAMES[u.weight] || u.weight);
    const lh = Object.entries(u.lh).filter((e) => e[0] !== "auto").sort((a, b) => b[1] - a[1]).map((e) => e[0])[0];
    const ls = +Object.entries(u.ls).sort((a, b) => b[1] - a[1])[0][0];
    const fits = u.samples.filter((s) => s.length <= 34);
    const sample = fits.filter((s) => s.length > 3).sort((a, b) => b.length - a.length)[0] || fits.sort((a, b) => b.length - a.length)[0] || "Magic Dragon";
    styles.push({ key: k, name, size: u.size, weight: u.weight, lineHeight: lh ? +lh : null, letterSpacing: ls, sample });
  }
  styles.sort((a, b) => b.size - a.size || b.weight - a.weight);
  const keys = new Set(styles.map((s) => s.key));
  const assign = (t) => walk(t, (n) => {
    if (n.type !== "text" || n.sys) return;
    n.runs.forEach((r) => {
      const st = r.style;
      if (!st || st.family !== "sans") return;
      const key = Math.round(st.size) + "/" + st.weight;
      if (keys.has(key)) r.ts = key;
    });
  });
  trees.forEach(assign);
  Object.values(boards).forEach((b) => b.sections.forEach((s) => s.children.forEach(assign)));
  return styles;
}

/* ---------------------------------------------------------------- images */
function parsePos(pos, bw, bh, dw, dh) {
  const parts = String(pos || "50% 50%").trim().split(/\s+/);
  const one = (v, box, d) => (/%$/.test(v) ? (box - d) * parseFloat(v) / 100 : parseFloat(v) || 0);
  return [one(parts[0] || "50%", bw, dw), one(parts[1] || parts[0] || "50%", bh, dh)];
}

async function encodeImages(allTrees, factor) {
  const sharp = env.sharp();
  const files = new Map();
  const bakeUse = [];
  for (const t of allTrees) walk(t, (n) => imageFills(n).forEach((f) => {
    if (f.bake) { bakeUse.push(f); return; }
    if (!f.src) return;
    let file;
    try { file = path.join(REPO, decodeURIComponent(new URL(f.src).pathname)); } catch (e) { file = null; }
    if (!file || !fs.existsSync(file)) { warn("missing image " + f.src); f.missing = true; return; }
    if (!files.has(file)) files.set(file, []);
    files.get(file).push(f);
  }));
  const store = {}, byHash = {};
  let seq = 0;
  const put = (buf) => {
    const h = sha(buf);
    if (!byHash[h]) { byHash[h] = "i" + (++seq); store[byHash[h]] = buf.toString("base64"); }
    return byHash[h];
  };
  const composed = {};
  for (const [file, all] of files) {
    /* padded cut-outs: the image sits inside its padding on a transparent canvas the size of the tile */
    for (const f of all.filter((x) => x.pad)) {
      const W = Math.max(1, Math.round(f.outerW * factor)), Hh = Math.max(1, Math.round(f.outerH * factor));
      const key = [file, W, Hh, f.pad.join(",")].join("|");
      if (!composed[key]) {
        const inner = await sharp(file).resize({ width: Math.max(1, Math.round(f.boxW * factor)), height: Math.max(1, Math.round(f.boxH * factor)), fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
        const canvas = await sharp({ create: { width: W, height: Hh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([{ input: inner, left: Math.round(f.pad[3] * factor), top: Math.round(f.pad[0] * factor) }]).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
        composed[key] = put(canvas);
      }
      f.img = composed[key];
      f.scaleMode = "FILL";
    }
    const fills = all.filter((x) => !x.pad);
    if (!fills.length) continue;
    const meta = await sharp(file).metadata();
    const stats = await sharp(file).stats();
    const iw = meta.width, ih = meta.height;
    let scale = 0;
    for (const f of fills) {
      const sx = f.boxW / iw, sy = f.boxH / ih;
      const s = f.fit === "contain" || f.fit === "scale-down" ? Math.min(sx, sy) : f.fit === "none" ? 1 : Math.max(sx, sy);
      scale = Math.max(scale, s);
    }
    const longest = Math.max(iw, ih);
    const target = Math.max(16, Math.min(longest, Math.ceil(longest * scale * factor)));
    const opaque = stats.isOpaque || !meta.hasAlpha;
    let p = sharp(file).resize({ width: iw >= ih ? target : null, height: ih > iw ? target : null, withoutEnlargement: true });
    p = opaque ? p.flatten({ background: "#ffffff" }).jpeg({ quality: 80, mozjpeg: true }) : p.png({ compressionLevel: 9, adaptiveFiltering: true });
    const id = put(await p.toBuffer());
    for (const f of fills) {
      f.img = id;
      if (f.fit === "contain" || f.fit === "scale-down") f.scaleMode = "FIT";
      else {
        const s = f.fit === "none" ? 1 : Math.max(f.boxW / iw, f.boxH / ih);
        const dw = iw * s, dh = ih * s;
        const [ox, oy] = parsePos(f.pos, f.boxW, f.boxH, dw, dh);
        const centred = Math.abs(ox - (f.boxW - dw) / 2) < 0.5 && Math.abs(oy - (f.boxH - dh) / 2) < 0.5;
        if (centred && f.fit !== "none") f.scaleMode = "FILL";
        else { f.scaleMode = "CROP"; f.transform = [[f.boxW / dw, 0, -ox / dw], [0, f.boxH / dh, -oy / dh]]; }
      }
    }
  }
  for (const f of bakeUse) {
    const img = sharp(bakes[f.bake]);
    const meta = await img.metadata();
    const w = Math.max(1, Math.round(Math.min(meta.width, f.boxW * factor)));
    const st = await sharp(bakes[f.bake]).stats();
    let p = sharp(bakes[f.bake]).resize({ width: w, withoutEnlargement: true });
    p = st.isOpaque ? p.jpeg({ quality: 82, mozjpeg: true }) : p.png({ compressionLevel: 9, adaptiveFiltering: true });
    f.img = put(await p.toBuffer());
    f.scaleMode = "FILL";
  }
  return store;
}

function tidyFill(f) {
  if (f.type !== "image") return f;
  const o = { type: "image", img: f.img, scaleMode: f.scaleMode || "FILL" };
  if (f.transform) o.transform = f.transform;
  return o;
}

/* ---------------------------------------------------------------- structure */
function sigOf(n) {
  const kids = (n.children || []).map(sigOf).join(",");
  return n.type + (n.type === "svg" ? ":" + sha(n.svg).slice(0, 10) : "") + (n.comp ? "#" + n.comp.set + "|" + n.comp.variant : "") + "(" + kids + ")";
}
function markSigs(t) { walk(t, (n) => { if (n.comp) n.sig = sha(sigOf(n)).slice(0, 12); }); }

/* Lay an occurrence over its main component: same layers, in the same order and the same
   places, where the occurrence may leave layers out (they become hidden layers). Figma
   doesn't let an instance move or resize its layers, so geometry has to match; text may
   change, and auto-width text may grow to the right. Children of auto-layout components
   (Button, Chip) are placed by Figma, so their positions don't count. */
const AUTO_SETS = new Set(["Button", "Chip"]);
const TOL = 1.5;
function geomOk(o, m) {
  if (Math.abs(o.y - m.y) > TOL || Math.abs(o.h - m.h) > TOL) return false;
  if (o.type === "text" && !o.wrap && !m.wrap) {
    /* auto-width text grows away from its alignment edge */
    if ((o.align || "LEFT") !== (m.align || "LEFT")) return false;
    return o.align === "RIGHT" ? Math.abs(o.x + o.w - m.x - m.w) <= TOL : Math.abs(o.x - m.x) <= TOL;
  }
  if (Math.abs(o.x - m.x) > TOL) return false;
  /* a truncating line may be a little wider or narrower without looking different */
  if (o.type === "text" && o.truncate && m.truncate) return Math.abs(o.w - m.w) <= 16;
  return Math.abs(o.w - m.w) <= TOL;
}

/* Single-line text that sits against its frame's right edge (prices, totals, links)
   is marked right-aligned, so in Figma it grows to the left like it does in the app. */
function anchorRight(t) {
  walk(t, (n) => {
    if (n.type === "text" || !n.children) return;
    n.children.forEach((c) => {
      if (c.type === "text" && !c.wrap && (c.align || "LEFT") === "LEFT" && c.chars.indexOf("\n") < 0 && c.x > n.w * 0.5 && n.w - (c.x + c.w) <= 24) c.align = "RIGHT";
    });
  });
}

/* The main component for a variant is taken from the screens when they have it (so it is
   measured in its real context), picking the occurrence most of the others line up with.
   Variants that only exist in the sheet (pressed, disabled, stages, freshness) stay. */
function chooseMains(components, screens) {
  const key = (n) => n.comp.set + "|" + n.comp.variant;
  const occ = {};
  for (const s of screens) {
    (function f(n, inComp) {
      (n.children || []).forEach((c) => {
        if (c.comp && !inComp) { (occ[key(c)] = occ[key(c)] || []).push(c); f(c, true); }
        else f(c, inComp);
      });
    })(s.tree, false);
  }
  for (const [k, list] of Object.entries(occ)) {
    let best = null, score = -1;
    for (const cand of list) {
      let sc = 0;
      for (const o of list) { const a = alignTo(o, cand, true, false); if (a) sc += hasHidden(a) ? 0.5 : 1; }
      if (sc >= score) { score = sc; best = cand; }
    }
    const main = JSON.parse(JSON.stringify(best));
    main.x = 0; main.y = 0;
    delete main.go; delete main.detach;
    const i = components.findIndex((c) => key(c) === k);
    if (i >= 0) components[i] = main; else components.push(main);
  }
}
function alignTo(o, m, isRoot, inAuto) {
  if (o.type !== m.type) return null;
  if (!isRoot && !inAuto && !geomOk(o, m)) return null;
  if (o.type === "svg") return sha(o.svg) === sha(m.svg) ? o : null;
  const ko = o.comp ? o.comp.set + "|" + o.comp.variant : "", km = m.comp ? m.comp.set + "|" + m.comp.variant : "";
  if (ko !== km) return null;
  const childAuto = !!(m.comp && AUTO_SETS.has(m.comp.set));
  const oc = o.children || [], mc = m.children || [];
  const out = [];
  let i = 0;
  for (let j = 0; j < mc.length; j++) {
    const a = i < oc.length ? alignTo(oc[i], mc[j], false, childAuto) : null;
    if (a) { out.push(a); i++; }
    else out.push({ type: mc[j].type, hidden: true, name: mc[j].name, x: mc[j].x, y: mc[j].y, w: mc[j].w, h: mc[j].h });
  }
  if (i < oc.length) return null;
  return Object.assign({}, o, { children: out });
}
const hasHidden = (n) => { let h = false; walk(n, (x) => { if (x.hidden) h = true; }); return h; };

/* For the build report: the first layer that stops an occurrence matching its component. */
function whyNot(o, m, path, inAuto) {
  const here = path + "/" + (o.name || o.type);
  if (o.type !== m.type) return here + " is a " + o.type + ", component has a " + m.type;
  if (path && !inAuto && !geomOk(o, m)) {
    const d = ["x", "y", "w", "h"].filter((k) => Math.abs((o[k] || 0) - (m[k] || 0)) > TOL).map((k) => k + " " + Math.round(m[k]) + "->" + Math.round(o[k]));
    return here + " moved or resized (" + (d.join(", ") || "alignment") + ")";
  }
  if (o.type === "svg" && sha(o.svg) !== sha(m.svg)) return here + " is a different icon";
  const oc = o.children || [], mc = m.children || [];
  if (oc.length !== mc.length) return here + " has " + oc.length + " layers, component has " + mc.length;
  const childAuto = !!(m.comp && AUTO_SETS.has(m.comp.set));
  for (let i = 0; i < oc.length; i++) { const r = whyNot(oc[i], mc[i], here, childAuto); if (r) return r; }
  return null;
}

function nameImages(t) {
  walk(t, (n) => {
    if (n.type !== "image" || !n.fill || !n.fill.src) return;
    const file = decodeURIComponent(n.fill.src.split("/").pop()).replace(/\.[^.]+$/, "");
    if (n.name !== file && n.name !== "Frame") return;
    n.name = /\/products\//.test(n.fill.src) ? "Photo" : /\/cutouts\//.test(n.fill.src) ? "Product photo" : /driver/.test(file) ? "Driver photo" : /dragon/.test(file) ? "Dragon" : file;
  });
}

function round(key, v) {
  if (key === "z" || key === "src" || key === "bake" || key === "boxW" || key === "boxH" || key === "iw" || key === "ih" || key === "pos" || key === "fit") return undefined;
  if (typeof v === "number") return Math.round(v * 1000) / 1000;
  return v;
}

/* ---------------------------------------------------------------- main */
(async () => {
  const t0 = Date.now();
  const { screens, components, boards, cssVars } = await readAll();

  /* sections, notes, prototype targets */
  const ids = screens.map((s) => s.id);
  const resolve = (v) => {
    const k = slug(v);
    if (k === "back") return "back";
    let hit = screens.find((s) => s.id === k || slug(s.file) === k || slug(s.title) === k);
    if (!hit) hit = screens.find((s) => s.id.indexOf(k) === 0 || k.indexOf(s.id) === 0);
    return hit ? hit.id : null;
  };
  for (const s of screens) {
    const sec = config.sections.find((c) => c.match.test(s.id));
    s.section = sec ? sec.name : config.fallbackSection;
    const forced = (config.overrideNotes || []).some((re) => re.test(s.id));
    if (forced) { const hit = config.notes.find(([re]) => re.test(s.id)); if (hit) s.note = hit[1]; }
    if (!s.note) {
      const hit = config.notes.find(([re]) => re.test(s.id));
      s.note = hit ? hit[1] : "";
      if (!hit) warn("no design note for screen " + s.id + " (add one in screens.config.js)");
    }
    walk(s.tree, (n) => {
      if (!n.go) return;
      const target = resolve(n.go);
      if (!target) { warn(s.id + ": data-go=\"" + n.go + "\" matches no screen"); delete n.go; }
      else n.go = target;
    });
  }
  const startRe = config.flow.start, fbRe = config.flow.fallbackStart;
  const start = (screens.find((s) => startRe.test(s.id)) || screens.find((s) => fbRe.test(s.id)) || screens[0]).id;
  const startScreen = screens.find((s) => s.id === start);
  let hasLink = false;
  walk(startScreen.tree, (n) => { if (n.go) hasLink = true; });
  /* screens that move on by themselves: the prototype's "after", a data-go on the screen itself,
     or a launch screen with nothing to tap */
  const autos = [];
  for (const s of screens) {
    const to = s.after && resolve(s.after.to);
    if (to) autos.push({ from: s.id, to, seconds: Math.round((s.after.ms || 1800) / 100) / 10 });
    else if (s.rootGo && resolve(s.rootGo)) autos.push({ from: s.id, to: resolve(s.rootGo), seconds: config.flow.autoAdvanceSeconds });
  }
  if (!autos.some((a) => a.from === start) && !hasLink && screens.length > 1) autos.push({ from: start, to: screens[screens.indexOf(startScreen) + 1].id, seconds: config.flow.autoAdvanceSeconds });
  const auto = autos.find((a) => a.from === start) || null;

  /* tokens, type, images, structure */
  const tokens = buildTokens(cssVars);
  const boardTrees = [];
  Object.values(boards).forEach((b) => b.sections.forEach((s) => boardTrees.push(...s.children)));
  [...components, ...screens.map((s) => s.tree), ...boardTrees].forEach((t) => { nameImages(t); anchorRight(t); markSigs(t); });
  chooseMains(components, screens);
  const appTrees = [...components, ...screens.map((s) => s.tree)];
  const typeStyles = buildType(appTrees, boards);

  /* Each occurrence must match its main component layer for layer. When it only lacks
     some layers (a closed store's card without the add button), it becomes an instance
     with those layers hidden; otherwise it is drawn as a plain frame. The order here
     follows the plugin: the sheet first, then screens section by section, then boards. */
  const mains = {};
  components.forEach((c) => { mains[c.comp.set + "|" + c.comp.variant] = c; });
  const sectionOrder = config.show.concat([config.fallbackSection]);
  const ordered = screens.slice().sort((a, b) => sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section) || screens.indexOf(a) - screens.indexOf(b));
  const detached = [], hiddenUse = [];
  const align = (where) => function fix(n, inComp) {
    (n.children || []).forEach((c, i) => {
      if (c.comp && !inComp) {
        const k = c.comp.set + "|" + c.comp.variant;
        const m = mains[k];
        if (!m) { mains[k] = c; fix(c, true); return; }
        const a = alignTo(c, m, true, false);
        if (a) { a.sig = m.sig; n.children[i] = a; if (hasHidden(a)) hiddenUse.push(where + ": " + k); }
        else { c.detach = true; detached.push(where + ": " + k + " (" + (whyNot(c, m, "", false) || "layers differ") + ")"); fix(c, false); return; }
        fix(n.children[i], true);
      } else fix(c, inComp);
    });
  };
  ordered.forEach((s) => align(s.id)(s.tree, false));
  Object.entries(boards).forEach(([name, b]) => b.sections.forEach((sec) => align(name)({ children: sec.children }, false)));
  hiddenUse.forEach((d) => warn("instance with some layers hidden: " + d));
  detached.forEach((d) => warn("structure differs from its component, drawn as a plain frame: " + d));

  let code = "", factor = 2, images = {};
  const template = fs.readFileSync(TEMPLATE, "utf8");
  for (factor of [2, 1.6, 1.3, 1]) {
    images = await encodeImages([...appTrees, ...boardTrees], factor);
    const strip = (t) => walk(t, (n) => { if (n.fill) n.fill = tidyFill(n.fill); if (n.fills) n.fills = n.fills.map(tidyFill); });
    const clone = (x) => JSON.parse(JSON.stringify(x));
    const data = {
      generated: new Date().toISOString().slice(0, 10),
      title: config.title, subtitle: config.subtitle,
      tokens, tokenGroups: config.tokenGroups, typeStyles,
      setOrder: config.setOrder, componentDocs: config.componentDocs,
      components: clone(components),
      screens: clone(screens.map((s) => ({ id: s.id, num: s.num, title: s.title, section: s.section, note: s.note, tree: s.tree }))),
      sections: config.show.concat([config.fallbackSection]).filter((n) => screens.some((s) => s.section === n)),
      boards: clone(boards),
      flow: { name: config.flow.name, start, autos },
      images
    };
    data.components.forEach(strip);
    data.screens.forEach((s) => strip(s.tree));
    Object.values(data.boards).forEach((b) => b.sections.forEach((s) => s.children.forEach(strip)));
    code = template.replace("/*__DATA__*/null", JSON.stringify(data, round));
    if (code.length <= BUDGET) break;
  }
  fs.writeFileSync(OUT, code);

  const imgBytes = Object.values(images).reduce((n, b) => n + b.length, 0);
  let links = 0;
  screens.forEach((s) => walk(s.tree, (n) => { if (n.go) links++; }));
  console.log("screens:", screens.length, "(" + ids.join(", ") + ")");
  console.log("component variants from the sheet:", components.length, "| text styles:", typeStyles.length, "| colour tokens:", tokens.length);
  console.log("images:", Object.keys(images).length, "embedded,", (imgBytes / 1e6).toFixed(2), "MB base64 at", factor + "x");
  console.log("prototype taps:", links, "| flow starts at", start, "| moves on by itself:", autos.map((a) => a.from + " -> " + a.to + " (" + a.seconds + " s)").join(", ") || "none");
  console.log("plugin code.js:", (code.length / 1e6).toFixed(2), "MB | built in", ((Date.now() - t0) / 1000).toFixed(1), "s");
  if (warnings.length) console.log("notes:\n  " + [...new Set(warnings)].join("\n  "));
})().catch((e) => { console.error(e); process.exit(1); });
