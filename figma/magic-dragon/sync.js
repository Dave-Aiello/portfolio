/* Copies the Magic Dragon Gallery screens, the clickable prototype (when there is
   one) and their assets into prototype/magic-dragon/, so the Figma build runs from
   the repo alone. Photos are resized to about 2x the largest size any screen shows
   them at: opaque photos become JPEG, cut-outs with transparency become WebP.

     node figma/magic-dragon/sync.js [path/to/directions]

   Re-run it whenever the Gallery screens change, then run build.js. */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { pathToFileURL, fileURLToPath } = require("url");
const env = require("./lib/env");
const { serve } = require("./lib/server");

const REPO = path.resolve(__dirname, "../..");
const SRC = path.resolve(process.argv[2] || process.env.MD_SOURCE || path.join(os.homedir(), "claude-scratch/consumer-app/directions"));
const DEST = path.join(REPO, "prototype/magic-dragon");
const TEXT = new Set([".html", ".css", ".js", ".json", ".svg", ".txt"]);
const IMG = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const DEFAULT_PX = { products: 800, cutouts: 600 };
const MIN_PX = { products: 480, cutouts: 320, brand: 256 };

function copyTree(from, to, filter, rewrite) {
  if (!fs.existsSync(from)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(from)) {
    const a = path.join(from, name), b = path.join(to, name);
    const st = fs.statSync(a);
    if (st.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      n += copyTree(a, b, filter, rewrite);
    } else if (!filter || filter(name)) {
      fs.mkdirSync(to, { recursive: true });
      if (rewrite && TEXT.has(path.extname(name).toLowerCase())) fs.writeFileSync(b, rewrite(fs.readFileSync(a, "utf8")));
      else fs.copyFileSync(a, b);
      n++;
    }
  }
  return n;
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/* Runs in the page: every image with the size it is drawn at. */
function measure() {
  const out = [];
  const px = (v) => parseFloat(v) || 0;
  for (const img of document.images) {
    const cs = getComputedStyle(img), r = img.getBoundingClientRect();
    if (!r.width) continue;
    const bw = r.width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth);
    const bh = r.height - px(cs.paddingTop) - px(cs.paddingBottom) - px(cs.borderTopWidth) - px(cs.borderBottomWidth);
    out.push({ src: img.currentSrc || img.src, bw, bh, fit: cs.objectFit });
  }
  for (const im of document.querySelectorAll("svg image")) {
    const r = im.getBoundingClientRect();
    const href = im.getAttribute("href") || im.getAttribute("xlink:href");
    if (!href || !r.width) continue;
    const par = im.getAttribute("preserveAspectRatio") || "";
    out.push({ src: new URL(href, document.baseURI).href, bw: r.width, bh: r.height, fit: /slice/.test(par) ? "cover" : "contain" });
  }
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    const m = cs.backgroundImage && cs.backgroundImage.match(/url\("?([^")]+)"?\)/);
    if (!m) continue;
    const r = el.getBoundingClientRect();
    out.push({ src: m[1], bw: r.width, bh: r.height, fit: cs.backgroundSize === "contain" ? "contain" : "cover" });
  }
  return out;
}

(async () => {
  if (!fs.existsSync(path.join(SRC, "src/gallery"))) throw new Error("No Gallery screens at " + path.join(SRC, "src/gallery"));
  const sharp = env.sharp();
  fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });

  /* 1. screens, shared CSS, and the prototype (paths rebased from directions/prototype/ to prototype/magic-dragon/) */
  const keep = (n) => TEXT.has(path.extname(n).toLowerCase()) || IMG.has(path.extname(n).toLowerCase());
  let files = copyTree(path.join(SRC, "src/gallery"), path.join(DEST, "src/gallery"), keep);
  files += copyTree(path.join(SRC, "src/shared"), path.join(DEST, "src/shared"), keep);
  const rebase = (s) => s.replace(/\.\.\/(src|assets)\//g, "$1/");
  const hasPrototype = fs.existsSync(path.join(SRC, "prototype/index.html"));
  if (hasPrototype) {
    /* the prototype's own assets/ folder holds full-size copies; those go through the optimiser below instead */
    for (const name of fs.readdirSync(path.join(SRC, "prototype"))) {
      const from = path.join(SRC, "prototype", name);
      if (name === "assets" || name.startsWith(".") || name === "node_modules") continue;
      if (fs.statSync(from).isDirectory()) files += copyTree(from, path.join(DEST, name), null, rebase);
      else { fs.writeFileSync(path.join(DEST, name), TEXT.has(path.extname(name).toLowerCase()) ? rebase(fs.readFileSync(from, "utf8")) : fs.readFileSync(from)); files++; }
    }
  }
  console.log("copied", files, "files", hasPrototype ? "(with the clickable prototype)" : "(no prototype yet, writing a simple viewer)");

  /* 2. how big each image is drawn, across every screen */
  const browser = await env.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const screens = fs.readdirSync(path.join(SRC, "src/gallery")).filter((f) => /^\d+.*\.html$/.test(f)).sort();
  const shown = {};
  for (const f of screens) {
    await page.goto(pathToFileURL(path.join(SRC, "src/gallery", f)).href);
    await page.evaluate(() => document.fonts.ready);
    for (const m of await page.evaluate(measure)) {
      if (!m.src.startsWith("file:")) continue;
      const file = fileURLToPath(m.src);
      (shown[file] = shown[file] || []).push(m);
    }
  }
  await browser.close();

  /* 3. optimised assets */
  const manifest = {};
  let before = 0, after = 0;
  const pool = new Map();
  for (const base of [path.join(SRC, "assets"), path.join(SRC, "prototype/assets")]) {
    for (const file of walk(base)) {
      const rel = path.relative(base, file).split(path.sep).join("/");
      if (!pool.has(rel)) pool.set(rel, file);
    }
  }
  for (const [rel, file] of pool) {
    const folder = rel.split("/")[0];
    const ext = path.extname(file).toLowerCase();
    if (!IMG.has(ext)) {
      fs.mkdirSync(path.dirname(path.join(DEST, "assets", rel)), { recursive: true });
      fs.copyFileSync(file, path.join(DEST, "assets", rel));
      continue;
    }
    const img = sharp(file);
    const meta = await img.metadata();
    const stats = await img.stats();
    const natural = Math.max(meta.width, meta.height);
    let scale = 0;
    for (const m of shown[path.join(SRC, "assets", rel)] || shown[file] || []) {
      const sx = m.bw / meta.width, sy = m.bh / meta.height;
      const s = m.fit === "contain" || m.fit === "scale-down" ? Math.min(sx, sy) : m.fit === "none" ? 1 : Math.max(sx, sy);
      scale = Math.max(scale, s);
    }
    let target = scale ? Math.ceil(natural * scale * 2) : (DEFAULT_PX[folder] || 1200);
    if (folder === "brand") target = Math.max(target, 1200);
    target = Math.min(natural, Math.max(target, MIN_PX[folder] || 0));
    const opaque = stats.isOpaque || !meta.hasAlpha;
    let outExt, pipeline = sharp(file).resize({ width: meta.width >= meta.height ? target : null, height: meta.height > meta.width ? target : null, withoutEnlargement: true });
    if (opaque) { outExt = ".jpg"; pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true }); }
    else if (folder === "brand") { outExt = ".png"; pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }); }
    else { outExt = ".webp"; pipeline = pipeline.webp({ quality: 86, alphaQuality: 95, effort: 5 }); }
    const outRel = rel.replace(/\.[^.]+$/, outExt);
    const out = path.join(DEST, "assets", outRel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await pipeline.toFile(out);
    manifest[rel] = outRel;
    before += fs.statSync(file).size;
    after += fs.statSync(out).size;
  }
  /* the finished splash line art: 14 strokes in drawing order with their timing (Motion page) */
  const splashDir = path.resolve(process.env.MD_SPLASH || path.join(SRC, "../splash-draw"));
  for (const name of ["dragon-line.json", "dragon-line.svg"]) {
    const from = path.join(splashDir, name);
    if (fs.existsSync(from)) { fs.mkdirSync(path.join(DEST, "assets/brand"), { recursive: true }); fs.copyFileSync(from, path.join(DEST, "assets/brand", name)); }
    else console.log("no splash line art at", from, "(the Motion page will trace the logo instead)");
  }
  fs.writeFileSync(path.join(DEST, "assets/manifest.json"), JSON.stringify(manifest, null, 1));
  console.log("images:", Object.keys(manifest).length, "from", (before / 1e6).toFixed(1), "MB to", (after / 1e6).toFixed(1), "MB");

  /* 4. point every reference at the renamed files */
  const renames = Object.entries(manifest).filter(([a, b]) => a !== b);
  for (const file of walk(DEST)) {
    if (!TEXT.has(path.extname(file).toLowerCase()) || file.endsWith("manifest.json")) continue;
    let s = fs.readFileSync(file, "utf8"), t = s;
    for (const [a, b] of renames) t = t.split("assets/" + a).join("assets/" + b);
    if (t !== s) fs.writeFileSync(file, t);
  }

  /* 5. screen list, and a simple clickable viewer when there is no prototype yet */
  let labels = {};
  try {
    const dj = JSON.parse(fs.readFileSync(path.join(DEST, "src/gallery/direction.json"), "utf8"));
    for (const s of dj.screens || []) labels[s.file] = s.label;
  } catch (e) { /* optional */ }
  const list = screens.map((f) => {
    const file = f.replace(/\.html$/, "");
    return { id: file.replace(/^\d+[-_]?/, ""), file: "src/gallery/" + f, title: labels[file] || file.replace(/^\d+[-_]?/, "").replace(/-/g, " ") };
  });
  fs.writeFileSync(path.join(DEST, "screens.json"), JSON.stringify(list, null, 1));
  if (!fs.existsSync(path.join(DEST, "index.html"))) fs.copyFileSync(path.join(__dirname, "viewer.html"), path.join(DEST, "index.html"));

  /* 6. check that everything still loads from the repo copy */
  const srv = await serve(REPO);
  const b2 = await env.launch();
  const p2 = await b2.newPage({ viewport: { width: 390, height: 844 } });
  const failed = [];
  p2.on("requestfailed", (r) => failed.push(r.url()));
  p2.on("response", (r) => { if (r.status() >= 400) failed.push(r.status() + " " + r.url()); });
  for (const s of list) {
    await p2.goto(srv.url + "/prototype/magic-dragon/" + s.file, { waitUntil: "networkidle" });
    const broken = await p2.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src")));
    broken.forEach((b) => failed.push(s.file + ": broken " + b));
  }
  await p2.goto(srv.url + "/prototype/magic-dragon/index.html", { waitUntil: "networkidle" });
  await b2.close();
  await srv.close();
  console.log("screens:", list.length, failed.length ? "problems:\n  " + [...new Set(failed)].join("\n  ") : "all load");
})().catch((e) => { console.error(e); process.exit(1); });
