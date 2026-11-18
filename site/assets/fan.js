/* The Main Vine: the cut-paper fan family tree.
   One pumpkin sits at the center. Its mother (seed parent) takes the left half of each ring and its
   father (pollen parent) the right half, one ring per generation. Each ring is its own paper layer.
   Motion follows the "How the family tree moves" board:
     1. it opens like a fan, 1 second per ring, 0.4 seconds apart
     2. pointing at a pumpkin lights up its line (0.18 second fade)
     3. a pumpkin that fills more than one place lifts in all of them and a line joins them along the rim
     4. a generation folds away in 0.7 seconds
   With reduced motion on, the fan appears fully open and nothing loops. */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  // Ring radii in the board's own units. A fan of G generations uses the first G+1 and scales them to the rim.
  const M_WIDE = [125, 228, 338, 458, 650, 840];
  // On a small screen the inner rings need more of the room, or nothing in them can be read.
  const M_SMALL = [150, 290, 420, 535, 650, 760];
  const R_CAP = [0, 250, 350, 520, 650, 650];
  const NAME_PT = [0, 21, 16, 13.5, 12.5, 11.5];
  const SUB_PT = [0, 15.5, 11.8, 11, 11, 10];
  const MOTHER = [[251, 226, 198], [244, 123, 18]];
  const FATHER = [[232, 239, 195], [141, 181, 43]];
  const EASE_OPEN = 'cubic-bezier(.16,.8,.24,1)';
  const EASE_FOLD = 'cubic-bezier(.5,0,.3,1)';
  const PSEUDO = {
    none: { text: 'Not on record', short: '' },
    self: { text: 'Self-pollinated', short: 'Self' },
    sib: { text: 'Sibling plant', short: 'Sibling' },
    open: { text: 'Open-pollinated', short: 'Open' },
  };

  const still = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const n1 = (v) => (Math.round(v * 10) / 10).toString();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => v == null ? '' : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const wTxt = (f) => f.u === 'in' ? num(f.w) + ' in' : num(f.w) + ' lb';

  // Short place for a label: the state, province or home nation where there is one worth naming, else the country.
  function placeShort(f) {
    const loc = f.loc || [];
    const region = loc[1] && loc[1] !== 'Other' ? loc[1] : '';
    const country = loc[2] && loc[2] !== 'Other' ? loc[2] : '';
    if (/^(United States|Canada|United Kingdom)$/.test(country)) return region || country;
    return country || region;
  }

  // "2624.6 Willemijns 2016" → weight "2624.6", surname "Willemijns", year "2016".
  function nameParts(n) {
    const t = String(n || '').trim().split(/\s+/);
    let yi = -1;
    for (let i = t.length - 1; i > 0; i--) if (/^(19|20)\d{2}$/.test(t[i])) { yi = i; break; }
    if (t.length < 3 || yi < 2) return { weight: t[0] || '', rest: t.slice(1).join(' '), surname: '', year: '' };
    return { weight: t[0], surname: t.slice(1, yi).join(' '), year: t[yi], rest: t.slice(1).join(' ') };
  }

  // ---------- The ancestry as slots ----------
  function sideOf(N, f, s) {
    const id = s === 'm' ? f.sid : f.pid;
    const m = s === 'm' ? f.sm : f.pm;
    const raw = (s === 'm' ? f.sr : f.pr) || '';
    const alt = (s === 'm' ? f.sa : f.pa) || [];
    if (m === 'self') return { kind: 'self', raw: raw };
    if (id != null && N[id]) return { kind: 'fruit', id: id, f: N[id], raw: raw, match: m };
    if (id != null) return { kind: 'stub', id: id, raw: raw };
    if (m === 'ambiguous') return { kind: 'amb', raw: raw, altIds: alt, alt: alt.map((i) => N[i]).filter(Boolean) };
    if (m === 'sib') return { kind: 'sib', raw: raw };
    if (m === 'open') return { kind: 'open', raw: raw };
    if (!raw || m === 'none' || m === 'unknown') return { kind: 'none', raw: '' };
    return { kind: 'ext', raw: raw };
  }

  function buildModel(N, rootId, maxGens) {
    const slots = [];
    const byPath = {};
    const add = (s) => { slots.push(s); byPath[s.path] = s; return s; };
    const root = add({ path: 'r', gen: 0, idx: 0, role: 'root', kind: 'fruit', id: rootId, f: N[rootId] });
    const grow = (p) => {
      if (p.gen >= maxGens || p.kind !== 'fruit' || !p.f) return;
      ['m', 'f'].forEach((s, k) => {
        const c = sideOf(N, p.f, s);
        c.path = p.path + s; c.gen = p.gen + 1; c.idx = p.idx * 2 + k; c.role = s; c.parent = p;
        add(c);
        grow(c);
      });
    };
    grow(root);
    slots.sort((a, b) => a.gen - b.gen || a.idx - b.idx);
    let depth = 0, lo = Infinity, hi = -Infinity;
    slots.forEach((s) => {
      if (s.gen > depth) depth = s.gen;
      if (s.gen > 0 && s.kind === 'fruit' && s.f && s.f.w != null) { lo = Math.min(lo, s.f.w); hi = Math.max(hi, s.f.w); }
    });
    const scale = niceScale(lo, hi);
    return { N: N, rootId: rootId, root: root, slots: slots, byPath: byPath, depth: depth, scale: scale, unit: (N[rootId] && N[rootId].u) || 'lb' };
  }

  function niceScale(lo, hi) {
    if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1, flat: true };
    if (hi - lo <= 0) return { lo: lo, hi: hi, flat: true };
    const raw = (hi - lo) / 5;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, flat: false };
  }

  function shade(role, w, scale) {
    const ramp = role === 'm' ? MOTHER : FATHER;
    const t = scale.flat || w == null ? 0.6 : clamp((w - scale.lo) / (scale.hi - scale.lo), 0, 1);
    const c = ramp[0].map((v, i) => Math.round(v + (ramp[1][i] - v) * t));
    return 'rgb(' + c.join(',') + ')';
  }
  const rampStops = (role) => [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const ramp = role === 'm' ? MOTHER : FATHER;
    return 'rgb(' + ramp[0].map((v, i) => Math.round(v + (ramp[1][i] - v) * t)).join(',') + ')';
  });

  // How many places each pumpkin fills among the first `gens` rings.
  function repeats(model, gens) {
    const count = {};
    model.slots.forEach((s) => { if (s.gen > 0 && s.gen <= gens && (s.kind === 'fruit' || s.kind === 'stub')) count[s.id] = (count[s.id] || 0) + 1; });
    return count;
  }

  // "rfm" → "Father’s mother"
  function relLabel(path) {
    const steps = path.slice(1).split('');
    if (!steps.length) return 'The pumpkin at the center';
    const words = steps.map((s) => s === 'm' ? 'mother' : 'father');
    const out = words.map((w, i) => i < words.length - 1 ? w + '’s' : w).join(' ');
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  function slotName(s) {
    if (s.kind === 'fruit') return s.f.n;
    if (s.kind === 'stub' || s.kind === 'ext' || s.kind === 'amb') return s.raw;
    return PSEUDO[s.kind].text;
  }

  // ---------- Measuring text ----------
  let ctx = null;
  function textWidth(text, size, weight) {
    if (!ctx) ctx = document.createElement('canvas').getContext('2d');
    ctx.font = (weight || 700) + ' ' + size + 'px Figtree, system-ui, sans-serif';
    return ctx.measureText(text).width;
  }
  // The largest size from cap down to min at which the text fits, or 0.
  function fitSize(text, avail, cap, min, weight) {
    if (avail <= 0 || !text) return 0;
    const w = textWidth(text, cap, weight);
    if (w <= avail) return cap;
    const s = Math.floor((cap * avail / w) * 10) / 10;
    return s >= min ? s : 0;
  }
  function truncate(text, avail, size, weight) {
    let t = text;
    while (t.length > 3 && textWidth(t + '…', size, weight) > avail) t = t.slice(0, -1);
    return t.length > 3 && t !== text ? t.trim() + '…' : (t === text ? text : '');
  }

  let uid = 0;

  // ---------- The fan ----------
  function create(host, opts) {
    opts = Object.assign({ gens: 4, maxGens: 5, interactive: true, animate: 'open', href: null, rootHref: null, label: null, onSelect: null, onActivate: null }, opts);
    const self = { host: host, model: null, gens: opts.gens, sel: null, sticky: false };
    const id = 'fan' + (++uid);
    let geo = null;
    let lastW = 0;
    let lastPointer = 'mouse';
    let leaveTimer = null;
    let running = [];
    let token = 0;
    host.classList.add('fan-host');

    function effGens() { return Math.max(1, Math.min(self.gens, self.model.depth)); }

    function layout(G) {
      const W = Math.max(260, Math.floor(host.clientWidth || 0));
      const margin = clamp(W * 0.022, 10, 30);
      const R = Math.min((W - 2 * margin) / 2, R_CAP[G]);
      const master = R < 260 ? M_SMALL : M_WIDE;
      const k = R / master[G];
      const r = master.slice(0, G + 1).map((v) => v * k);
      const top = margin;
      return { W: W, H: Math.ceil(R + top + 8), cx: W / 2, cy: top + R, R: R, k: k, r: r, G: G, margin: margin };
    }
    const pt = (r, a) => n1(geo.cx - r * Math.cos(a)) + ' ' + n1(geo.cy - r * Math.sin(a));
    const xy = (r, a) => [geo.cx - r * Math.cos(a), geo.cy - r * Math.sin(a)];
    function segPath(ri, ro, a0, a1) {
      return 'M' + pt(ro, a0) + ' A' + n1(ro) + ' ' + n1(ro) + ' 0 0 1 ' + pt(ro, a1) + ' L' + pt(ri, a1) + ' A' + n1(ri) + ' ' + n1(ri) + ' 0 0 0 ' + pt(ri, a0) + ' Z';
    }
    const arc = (r, a0, a1) => 'M' + pt(r, a0) + ' A' + n1(r) + ' ' + n1(r) + ' 0 0 1 ' + pt(r, a1);
    function slotGeo(s) {
      if (s.gen === 0) return { ri: 0, ro: geo.r[0], a0: 0, a1: Math.PI };
      const span = Math.PI / Math.pow(2, s.gen);
      return { ri: geo.r[s.gen - 1], ro: geo.r[s.gen], a0: s.idx * span, a1: (s.idx + 1) * span };
    }
    function slotD(s) {
      const g = slotGeo(s);
      if (s.gen === 0) return 'M' + pt(g.ro, 0) + ' A' + n1(g.ro) + ' ' + n1(g.ro) + ' 0 0 1 ' + pt(g.ro, Math.PI) + ' Z';
      return segPath(g.ri, g.ro, g.a0, g.a1);
    }

    // Words for one segment, sized to the room it has.
    function labelFor(s, reps, defs) {
      const g = slotGeo(s);
      const t = g.ro - g.ri;
      const span = g.a1 - g.a0;
      const mid = (g.a0 + g.a1) / 2;
      const u = geo.k;
      const isFruit = s.kind === 'fruit';
      const ink = isFruit || s.kind === 'stub' ? '#1D140C' : '#D9CBB6';
      const rep = (isFruit || s.kind === 'stub') && reps[s.id] > 1;
      const mark = rep || s.kind === 'amb';
      const dotR = s.kind === 'amb' ? clamp(7.5 * u * 1.2, 5, 7.5) : clamp(4.5 * u * 1.4, 2.6, 4.5);
      const dotOff = clamp(11 * u * 1.3, dotR + 3.5, 11 + (s.kind === 'amb' ? 3 : 0));
      const nameCap = clamp(NAME_PT[s.gen] * u, 9, NAME_PT[s.gen] * 1.12);
      let subCap = SUB_PT[s.gen] * u;
      subCap = subCap < 6.2 ? 0 : clamp(subCap, 8.5, SUB_PT[s.gen] * 1.1);
      const pad = clamp(8 * u, 3, 9);
      let out = '';

      let variants, subText, subAlt;
      if (isFruit) {
        const np = nameParts(s.f.n);
        variants = [s.f.n];
        if (np.surname) variants.push(np.weight + ' ' + np.surname);
        variants.push(np.weight);
        subText = wTxt(s.f) + ' · ' + placeShort(s.f);
        subAlt = np.year ? np.year + ' · ' + placeShort(s.f) : placeShort(s.f);
      } else if (s.kind === 'stub' || s.kind === 'ext' || s.kind === 'amb') {
        variants = [s.raw];
        subText = s.kind === 'ext' ? 'Not on record' : s.kind === 'amb' ? 'Not sure which' : '';
      } else {
        variants = [PSEUDO[s.kind].text, PSEUDO[s.kind].short];
        subText = '';
      }

      const arcMode = span * (g.ri + g.ro) / 2 >= t * 1.1;
      if (arcMode) {
        let fN = 0.56, fS = 0.27;
        let name = '', size = 0, vi = 0;
        const availAt = (f) => span * (g.ri + f * t) - 2 * pad;
        for (vi = 0; vi < variants.length; vi++) {
          if (!variants[vi]) continue;
          size = fitSize(variants[vi], availAt(fN), nameCap, vi === variants.length - 1 && isFruit ? 8 : 9, 700);
          if (size) { name = variants[vi]; break; }
        }
        if (!name && !isFruit && variants[0] && s.kind !== 'none') {
          name = truncate(variants[0], availAt(fN), 9, 700); size = name ? 9 : 0;
        }
        let sub = '';
        let subSize = 0;
        if (name && subCap) {
          const st = isFruit && vi === 1 ? subAlt : isFruit && vi === 2 ? '' : subText;
          if (st && t >= size * 1.2 + subCap * 1.2 + 6 + (mark ? dotR + 2 : 0)) {
            subSize = fitSize(st, span * (g.ri + fS * t) - 2 * pad, subCap, 8, 500);
            if (!subSize && isFruit && vi === 0) { // the weight is already in the name, so the place alone will do
              subSize = fitSize(placeShort(s.f), span * (g.ri + fS * t) - 2 * pad, subCap, 8, 500);
              if (subSize) sub = placeShort(s.f);
            } else if (subSize) sub = st;
          }
        }
        if (name) {
          if (!sub) fN = 0.5 - (size * 0.36) / t;
          if (mark) { // keep clear of the dot at the outer edge
            const maxF = (t - dotOff - dotR - 2 - size * 0.78) / t;
            if (fN > maxF) fN = Math.max(maxF, (size * 0.3 + 3) / t);
          }
          const idA = id + '-' + s.path + 'a';
          defs.push('<path id="' + idA + '" d="' + arc(g.ri + fN * t, g.a0, g.a1) + '"/>');
          out += '<text class="fn" font-size="' + n1(size) + '" fill="' + ink + '"><textPath href="#' + idA + '" startOffset="50%" text-anchor="middle">' + esc(name) + '</textPath></text>';
          if (sub) {
            const idB = id + '-' + s.path + 'b';
            defs.push('<path id="' + idB + '" d="' + arc(g.ri + fS * t, g.a0, g.a1) + '"/>');
            out += '<text class="fs" font-size="' + n1(subSize) + '" fill="' + ink + '"><textPath href="#' + idB + '" startOffset="50%" text-anchor="middle">' + esc(sub) + '</textPath></text>';
          }
        }
      } else {
        const room = mark ? dotOff + dotR + 2 : 0;
        const availLen = t - 2 * pad - room;
        const widthAt = span * (g.ri + pad) - 4;
        let name = '', size = 0, vi = 0;
        for (vi = 0; vi < variants.length; vi++) {
          if (!variants[vi]) continue;
          size = fitSize(variants[vi], availLen, Math.min(nameCap, widthAt), vi === variants.length - 1 && isFruit ? 8 : 9, 700);
          if (size) { name = variants[vi]; break; }
        }
        if (!name && !isFruit && variants[0] && s.kind !== 'none' && widthAt >= 9) {
          name = truncate(variants[0], availLen, 9, 700); size = name ? 9 : 0;
        }
        if (name) {
          let sub = '', subSize = 0;
          const st = isFruit ? (vi === 0 ? placeShort(s.f) : vi === 1 ? subAlt : '') : subText;
          if (st && subCap && size + subCap + 3 <= widthAt) {
            subSize = fitSize(st, availLen, subCap, 8, 500);
            if (subSize) sub = st;
          }
          const deg = mid * 180 / Math.PI;
          const rot = deg <= 90 ? deg : deg - 180;
          const c = xy(g.ri + pad + availLen / 2, mid);
          const block = sub ? size + subSize + 3 : size;
          const y1 = sub ? -block / 2 + size * 0.8 : size * 0.35;
          out += '<g transform="translate(' + n1(c[0]) + ' ' + n1(c[1]) + ') rotate(' + n1(rot) + ')">' +
            '<text class="fn" font-size="' + n1(size) + '" fill="' + ink + '" text-anchor="middle" y="' + n1(y1) + '">' + esc(name) + '</text>' +
            (sub ? '<text class="fs" font-size="' + n1(subSize) + '" fill="' + ink + '" text-anchor="middle" y="' + n1(-block / 2 + size + 3 + subSize * 0.8) + '">' + esc(sub) + '</text>' : '') + '</g>';
        }
      }
      if (mark) {
        const c = xy(g.ro - dotOff, mid);
        if (s.kind === 'amb') {
          out += '<circle class="qdot" cx="' + n1(c[0]) + '" cy="' + n1(c[1]) + '" r="' + n1(dotR) + '"/>' +
            '<text class="qtxt" x="' + n1(c[0]) + '" y="' + n1(c[1] + dotR * 0.5) + '" font-size="' + n1(dotR * 1.5) + '" text-anchor="middle">?</text>';
        } else {
          out += '<circle class="repdot" cx="' + n1(c[0]) + '" cy="' + n1(c[1]) + '" r="' + n1(dotR) + '"/>';
        }
      }
      return out;
    }

    function rootLabel(s) {
      const r0 = geo.r[0];
      const np = nameParts(s.f ? s.f.n : '');
      const big = np.weight;
      let size = Math.min(r0 * 0.33, 46);
      const w = textWidth(big, size, 800) * 1.06;
      if (w > r0 * 1.5) size = size * r0 * 1.5 / w;
      let small = r0 * 0.17;
      let line2 = np.rest;
      const maxW2 = r0 * 1.78;
      if (line2 && small >= 7.5) {
        const w2 = textWidth(line2, small, 600) * 1.08;
        if (w2 > maxW2) small = small * maxW2 / w2;
      }
      if (!line2 || small < 7.5) {
        size = Math.min(r0 * 0.4, size * 1.25);
        return '<text class="froot1" x="' + n1(geo.cx) + '" y="' + n1(geo.cy - r0 * 0.26) + '" text-anchor="middle" font-size="' + n1(size) + '">' + esc(big) + '</text>';
      }
      return '<text class="froot1" x="' + n1(geo.cx) + '" y="' + n1(geo.cy - r0 * 0.42) + '" text-anchor="middle" font-size="' + n1(size) + '">' + esc(big) + '</text>' +
        '<text class="froot2" x="' + n1(geo.cx) + '" y="' + n1(geo.cy - r0 * 0.14) + '" text-anchor="middle" font-size="' + n1(small) + '">' + esc(line2) + '</text>';
    }

    function ariaFor(s, reps) {
      const rel = relLabel(s.path);
      if (s.gen === 0) return 'At the center: ' + s.f.n + ', ' + wTxt(s.f) + ', grown by ' + s.f.g + '.';
      if (s.kind === 'fruit') {
        return rel + ': ' + s.f.n + ', ' + wTxt(s.f) + ', grown by ' + s.f.g + (placeShort(s.f) ? ' in ' + placeShort(s.f) : '') + '.' +
          (reps[s.id] > 1 ? ' Fills ' + reps[s.id] + ' places in this tree.' : '') + (opts.href ? ' Press Enter to put it at the center.' : '');
      }
      if (s.kind === 'stub') return rel + ': ' + s.raw + '.';
      if (s.kind === 'amb') return rel + ': listed as ' + s.raw + '. That name fits more than one pumpkin, so it is shown as typed.';
      if (s.kind === 'ext') return rel + ': listed as ' + s.raw + '. Not on record.';
      if (s.kind === 'none') return rel + ': not on record.';
      return rel + ': ' + PSEUDO[s.kind].text.toLowerCase() + '.';
    }

    function render() {
      const m = self.model;
      const G = effGens();
      geo = layout(G);
      lastW = geo.W;
      const reps = repeats(m, G);
      self.reps = reps;
      const defs = [];
      const rings = [];
      for (let g = 0; g <= G; g++) rings.push('');
      const hits = [];
      const visible = m.slots.filter((s) => s.gen <= G);
      visible.forEach((s) => {
        const d = slotD(s);
        const sg = slotGeo(s);
        const isFruit = s.kind === 'fruit' || s.kind === 'stub';
        const aria = esc(ariaFor(s, reps));
        if (s.gen === 0) {
          rings[0] += '<g class="seg root" data-p="r"><g class="lift"><path class="shape" d="' + d + '" fill="#FFF7EA"/><g class="rlabel">' + rootLabel(s) + '</g></g></g>';
          if (opts.interactive) {
            hits.push(opts.rootHref
              ? '<a class="hit" data-p="r" href="' + esc(opts.rootHref(s.id)) + '" aria-label="' + aria + '"><path d="' + d + '"/></a>'
              : '<g class="hit" data-p="r" tabindex="0" role="img" aria-label="' + aria + '"><path d="' + d + '"/></g>');
          }
          return;
        }
        const fill = s.kind === 'fruit' ? shade(s.role, s.f.w, m.scale) : s.kind === 'stub' ? shade(s.role, null, m.scale) : '';
        s.fill = fill || '#241C16';
        const cls = 'seg ' + s.role + (isFruit ? '' : ' none') + (s.kind === 'amb' ? ' amb' : '') + (isFruit && reps[s.id] > 1 ? ' rep' : '');
        rings[s.gen] += '<g class="' + cls + '" data-p="' + s.path + '"' + (isFruit ? ' data-id="' + s.id + '"' : '') + ' style="--r:' + n1(-sg.a0 * 180 / Math.PI) + 'deg"><g class="lift">' +
          '<path class="shape' + (isFruit ? '' : ' none') + '" d="' + d + '"' + (fill ? ' fill="' + fill + '"' : '') + '/>' + labelFor(s, reps, defs) + '</g></g>';
        if (opts.interactive) {
          hits.push(isFruit && opts.href
            ? '<a class="hit" data-p="' + s.path + '" href="' + esc(opts.href(s.id)) + '" aria-label="' + aria + '"><path d="' + d + '"/></a>'
            : '<g class="hit" data-p="' + s.path + '" tabindex="0" role="img" aria-label="' + aria + '"><path d="' + d + '"/></g>');
        }
      });
      let body = '';
      for (let g = G; g >= 0; g--) body += '<g class="fring fg' + g + '" data-g="' + g + '">' + rings[g] + '</g>';
      const label = opts.label ? opts.label(m, G) : 'Family tree of ' + m.root.f.n;
      host.innerHTML = '<svg xmlns="' + NS + '" class="fan' + (opts.interactive ? '' : ' mini') + (geo.R < 260 ? ' small' : '') + '" viewBox="0 0 ' + geo.W + ' ' + geo.H + '" width="' + geo.W + '" height="' + geo.H + '" role="group" aria-label="' + esc(label) + '" style="--cx:' + n1(geo.cx) + 'px;--cy:' + n1(geo.cy) + 'px">' +
        '<defs>' + defs.join('') + '</defs><g class="fan-body" aria-hidden="true">' + body + '</g><g class="fan-over" aria-hidden="true"></g><g class="fan-hits">' + hits.join('') + '</g></svg>';
      self.svg = host.firstChild;
      self.G = G;
      if (self.sel && m.byPath[self.sel] && m.byPath[self.sel].gen <= G) paintSel(); else { self.sel = null; self.sticky = false; }
    }

    // ---------- Selection: the line back to the center, and every place a repeated pumpkin fills ----------
    function paintSel() {
      const svg = self.svg;
      const over = svg.querySelector('.fan-over');
      svg.querySelectorAll('.seg.line, .seg.sel, .seg.pulse').forEach((el) => el.classList.remove('line', 'sel', 'pulse'));
      over.innerHTML = '';
      if (!self.sel) { svg.classList.remove('has-sel'); return; }
      const s = self.model.byPath[self.sel];
      if (s.gen === 0) { svg.classList.remove('has-sel'); return; } // the center is on every line, so nothing dims
      svg.classList.add('has-sel');
      for (let i = 1; i <= s.path.length; i++) {
        const el = svg.querySelector('.seg[data-p="' + s.path.slice(0, i) + '"]');
        if (el) el.classList.add('line');
      }
      const target = svg.querySelector('.seg[data-p="' + s.path + '"]');
      let html = '';
      const isRep = (s.kind === 'fruit' || s.kind === 'stub') && s.gen > 0 && self.reps[s.id] > 1;
      if (isRep) {
        const places = self.model.slots.filter((o) => o.gen > 0 && o.gen <= self.G && o.id === s.id && (o.kind === 'fruit' || o.kind === 'stub'));
        const rim = geo.R + clamp(14 * geo.k * 1.4, 6, 14);
        const mids = [];
        places.forEach((o) => {
          const el = svg.querySelector('.seg[data-p="' + o.path + '"]');
          if (el) el.classList.add('line', 'pulse');
          html += '<path class="selring pulse" d="' + slotD(o) + '"/>';
          const g = slotGeo(o);
          const mid = (g.a0 + g.a1) / 2;
          mids.push(mid);
          if (o.gen < self.G) html += '<path class="repstem" d="M' + pt(g.ro + 2, mid) + ' L' + pt(rim, mid) + '"/>';
          const c = xy(rim, mid);
          html += '<circle class="repend" cx="' + n1(c[0]) + '" cy="' + n1(c[1]) + '" r="' + n1(clamp(3.5 * geo.k * 1.5, 2.2, 3.5)) + '"/>';
        });
        mids.sort((a, b) => a - b);
        if (mids.length > 1) html = '<path class="replink" pathLength="1" d="' + arc(rim, mids[0], mids[mids.length - 1]) + '"/>' + html;
      } else if (target) {
        target.classList.add('sel');
        html += '<path class="selring" d="' + slotD(s) + '"/>';
      }
      over.innerHTML = html;
    }

    function setSel(path, sticky) {
      if (path && !(self.model.byPath[path] && self.model.byPath[path].gen <= self.G)) path = null;
      if (self.sel === path && self.sticky === !!sticky) return;
      self.sel = path; self.sticky = !!path && !!sticky;
      paintSel();
      if (opts.onSelect) {
        const s = path ? self.model.byPath[path] : null;
        opts.onSelect(s, s ? { sticky: self.sticky, leftHalf: s.gen > 0 && s.path.charAt(1) === 'm', reps: self.reps[s.id] || 1 } : null);
      }
    }

    // ---------- Pointer, touch and keyboard ----------
    function hitOf(e) { return e.target && e.target.closest ? e.target.closest('.hit') : null; }
    // A new fan can appear under a pointer that hasn't moved. It shouldn't light anything up until the pointer does.
    let lastXY = null, frozenAt = null;
    function onOver(e) {
      const h = hitOf(e);
      if (!h || e.pointerType === 'touch' || frozenAt) return;
      clearTimeout(leaveTimer);
      if (!self.sticky || self.sel !== h.dataset.p) setSel(h.dataset.p, false);
    }
    function onMove(e) {
      if (e.pointerType === 'touch') return;
      lastXY = [e.clientX, e.clientY];
      if (frozenAt && (Math.abs(e.clientX - frozenAt[0]) > 3 || Math.abs(e.clientY - frozenAt[1]) > 3)) { frozenAt = null; onOver(e); }
    }
    // With the pointer gone, fall back to whichever segment has keyboard focus, or to nothing.
    function settle() {
      if (self.sticky) return;
      const a = document.activeElement;
      const h = a && host.contains(a) && a.closest ? a.closest('.hit') : null;
      setSel(h ? h.dataset.p : null, false);
    }
    function onOut(e) {
      if (e.pointerType === 'touch' || self.sticky) return;
      const to = e.relatedTarget;
      if (to && to.closest && to.closest('.hit') && host.contains(to)) return;
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(settle, opts.leaveDelay || 120);
    }
    function onFocusIn(e) { const h = hitOf(e); if (h) { clearTimeout(leaveTimer); setSel(h.dataset.p, self.sticky && self.sel === h.dataset.p); } }
    function onFocusOut() { clearTimeout(leaveTimer); leaveTimer = setTimeout(settle, 120); }
    function onDown(e) { lastPointer = e.pointerType || 'mouse'; }
    function onClick(e) {
      const h = hitOf(e);
      if (!h) { if (self.sticky) setSel(null); return; }
      const p = h.dataset.p;
      const s = self.model.byPath[p];
      const touch = e.detail !== 0 && (lastPointer === 'touch' || lastPointer === 'pen');
      const link = h.tagName.toLowerCase() === 'a';
      // On a touch screen the first tap shows who the pumpkin is. A second tap on it follows the link.
      if (touch && !(self.sticky && self.sel === p)) { e.preventDefault(); setSel(p, true); return; }
      if (!link) { if (touch) setSel(self.sel === p && self.sticky ? null : p, true); return; }
      if (opts.onActivate) opts.onActivate(s, originOf(s), e.detail === 0);
    }
    function onKey(e) {
      const h = hitOf(e);
      if (!h) return;
      const p = h.dataset.p;
      const s = self.model.byPath[p];
      let to = null;
      if (e.key === 'ArrowUp') to = p + 'm';
      else if (e.key === 'ArrowDown') to = p.length > 1 ? p.slice(0, -1) : null;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const ring = self.model.slots.filter((o) => o.gen === s.gen);
        const i = ring.indexOf(s) + (e.key === 'ArrowLeft' ? -1 : 1);
        to = ring[i] ? ring[i].path : null;
      } else if (e.key === 'Escape') { setSel(null); return; }
      else return;
      e.preventDefault();
      const el = to && self.svg.querySelector('.hit[data-p="' + to + '"]');
      if (el) el.focus();
    }
    if (opts.interactive) {
      host.addEventListener('pointerover', onOver);
      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerout', onOut);
      host.addEventListener('focusin', onFocusIn);
      host.addEventListener('focusout', onFocusOut);
      host.addEventListener('pointerdown', onDown);
      host.addEventListener('click', onClick);
      host.addEventListener('keydown', onKey);
    }

    // Where a segment sits, measured from the center of the fan's base, so the next fan can start its center there.
    function originOf(s) {
      if (!s || s.gen === 0) return null;
      const g = slotGeo(s);
      const c = xy((g.ri + g.ro) / 2, (g.a0 + g.a1) / 2);
      return { dx: c[0] - geo.cx, dy: c[1] - geo.cy, fill: s.fill || '#FFF7EA', path: s.path };
    }

    // ---------- Motion ----------
    function stopAll() { running.forEach((a) => { try { a.cancel(); } catch (e) { /* already done */ } }); running = []; }
    function anim(el, frames, o) {
      if (!el || !el.animate) return null;
      const a = el.animate(frames, o);
      running.push(a);
      return a;
    }
    const segRot = (seg) => 'rotate(' + (seg.style.getPropertyValue('--r') || '0deg') + ')';

    // 1. It opens like a fan.
    function playOpen(o) {
      o = o || {};
      if (still()) return;
      const first = o.from || 1;
      const base = o.delay || 0;
      const dur = o.duration || 1000;
      const gap = o.gap == null ? 400 : o.gap;
      if (first === 1 && !o.origin) anim(self.svg.querySelector('.fg0'), [{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'linear' });
      for (let g = first; g <= self.G; g++) {
        const ring = self.svg.querySelector('.fg' + g);
        if (!ring) continue;
        const start = base + (first === 1 ? 150 : 0) + (g - first) * gap;
        anim(ring, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, delay: start, easing: 'linear', fill: 'backwards' });
        ring.querySelectorAll('.seg').forEach((seg) => {
          anim(seg, [{ transform: segRot(seg) }, { transform: 'rotate(0deg)' }], { duration: dur, delay: start, easing: EASE_OPEN, fill: 'backwards' });
        });
      }
      if (o.origin) { // the pumpkin that was picked travels in to become the center
        const r0 = geo.r[0];
        const rootSeg = self.svg.querySelector('.seg.root');
        anim(rootSeg, [{ transform: 'translate(' + n1(o.origin.dx) + 'px,' + n1(o.origin.dy + r0 * 0.42) + 'px) scale(0.5)' }, { transform: 'translate(0px,0px) scale(1)' }], { duration: 560, easing: 'cubic-bezier(.2,.7,.2,1)' });
        anim(rootSeg.querySelector('.shape'), [{ fill: o.origin.fill }, { fill: o.origin.fill, offset: 0.45 }, { fill: '#FFF7EA' }], { duration: 620, easing: 'linear' });
        anim(rootSeg.querySelector('.rlabel'), [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], { duration: 620, easing: 'linear' });
      }
    }

    // 4. Rings fold shut to the left. `keep` names a segment that stays put (the one that was picked).
    function playFold(fromGen, duration, keep) {
      if (still()) return Promise.resolve();
      const all = [];
      for (let g = fromGen; g <= self.G; g++) {
        const ring = self.svg.querySelector('.fg' + g);
        if (!ring) continue;
        const keepHere = keep && ring.querySelector('.seg[data-p="' + keep + '"]');
        if (!keepHere) all.push(anim(ring, [{ opacity: 1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: duration, easing: 'linear', fill: 'forwards' }));
        ring.querySelectorAll('.seg').forEach((seg) => {
          if (seg === keepHere) return;
          all.push(anim(seg, [{ transform: 'rotate(0deg)' }, { transform: segRot(seg) }], { duration: duration, easing: EASE_FOLD, fill: 'forwards' }));
          if (keepHere) anim(seg, [{ opacity: 1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: duration, easing: 'linear', fill: 'forwards' });
        });
      }
      return Promise.all(all.filter(Boolean).map((a) => a.finished.catch(() => {})));
    }

    function zoomFrom(kOld) {
      const s0 = kOld / geo.k;
      if (!isFinite(s0) || Math.abs(s0 - 1) < 0.01) return;
      anim(self.svg.querySelector('.fan-body'), [{ transform: 'scale(' + s0.toFixed(4) + ')' }, { transform: 'scale(1)' }], { duration: 450, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }

    // ---------- Public ----------
    self.setData = function (N, rootId, o) {
      o = o || {};
      stopAll();
      token++;
      self.model = buildModel(N, rootId, opts.maxGens);
      self.sel = null; self.sticky = false;
      frozenAt = lastXY;
      render();
      if (opts.onSelect) opts.onSelect(null, null);
      if (o.animate !== 'none') playOpen({ origin: o.origin || null, delay: o.origin ? 220 : 0 });
    };
    self.setGens = function (g) {
      g = clamp(g, 1, opts.maxGens);
      if (!self.model) { self.gens = g; return; }
      const oldG = self.G, kOld = geo.k;
      self.gens = g;
      const newG = effGens();
      if (newG === oldG) { render(); return; }
      stopAll();
      const my = ++token;
      if (still()) { render(); return; }
      if (newG < oldG) {
        setSel(null);
        playFold(newG + 1, 700).then(() => { if (my !== token) return; stopAll(); render(); zoomFrom(kOld); });
      } else {
        render();
        zoomFrom(kOld);
        for (let k = oldG + 1; k <= newG; k++) { const ring = self.svg.querySelector('.fg' + k); if (ring) ring.style.opacity = '0'; }
        setTimeout(() => {
          if (my !== token) return;
          for (let k = oldG + 1; k <= newG; k++) { const ring = self.svg.querySelector('.fg' + k); if (ring) ring.style.opacity = ''; }
          playOpen({ from: oldG + 1, duration: 700, gap: 180 });
        }, 430);
      }
    };
    // Fold the whole fan shut, leaving the picked segment in place. Used while the next center loads.
    self.foldAway = function (keepPath) {
      stopAll();
      setSel(null);
      if (keepPath) { const el = self.svg.querySelector('.seg[data-p="' + keepPath + '"]'); if (el) { el.classList.add('picked'); } }
      return playFold(1, 420, keepPath);
    };
    self.select = setSel;
    // Centers of the lit segments, in page coordinates, so a card can keep off them.
    self.litPoints = function () {
      if (!self.svg) return [];
      const box = self.svg.getBoundingClientRect();
      const sx = box.width / geo.W, sy = box.height / geo.H;
      const out = [];
      self.svg.querySelectorAll('.seg.line, .seg.sel').forEach((el) => {
        const s = self.model.byPath[el.dataset.p];
        if (!s || s.gen === 0) return;
        const g = slotGeo(s);
        const mid = (g.a0 + g.a1) / 2;
        [g.ri + 6, (g.ri + g.ro) / 2, g.ro - 6].forEach((r) => { const c = xy(r, mid); out.push({ x: box.left + c[0] * sx, y: box.top + c[1] * sy, sel: s.path === self.sel }); });
      });
      return out;
    };
    self.hold = function () { clearTimeout(leaveTimer); };
    self.release = function () { clearTimeout(leaveTimer); settle(); };
    self.originOf = originOf;
    self.replay = function () { stopAll(); playOpen(); };
    self.refit = function () { if (self.model) { stopAll(); render(); } };
    self.destroy = function () {
      stopAll(); token++;
      if (ro) ro.disconnect();
      clearTimeout(leaveTimer);
      host.removeEventListener('pointerover', onOver); host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerout', onOut);
      host.removeEventListener('focusin', onFocusIn); host.removeEventListener('focusout', onFocusOut);
      host.removeEventListener('pointerdown', onDown); host.removeEventListener('click', onClick); host.removeEventListener('keydown', onKey);
    };

    let ro = null;
    let resizeTimer = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => {
        if (!self.model) return;
        const w = Math.floor(host.clientWidth || 0);
        if (!w || Math.abs(w - lastW) < 2) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (self.model && document.body.contains(host)) { stopAll(); render(); } }, 120);
      });
      ro.observe(host);
    }
    return self;
  }

  window.MVFan = { create: create, buildModel: buildModel, repeats: repeats, relLabel: relLabel, slotName: slotName, placeShort: placeShort, rampStops: rampStops, nameParts: nameParts, PSEUDO: PSEUDO };
})();
