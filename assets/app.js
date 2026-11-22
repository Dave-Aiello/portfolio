/* The Main Vine: single-page app. Hash routes (old links keep working):
   #/                    home
   #/trees               family trees: look one up, or start from the parents behind the heaviest
   #/tree/123            a pumpkin's page, scrolled to its family tree
   #/fruit/123           a pumpkin's page
   #/results/P/2026      one class, one year (#/results/P/all is the 100 heaviest of all time)
   #/grower/<key>        everything a grower weighed
   #/search/<q>          search
   #/about               how the data is put together */
(function () {
  'use strict';

  const Fan = window.MVFan;
  const CLASS = {
    P: { tab: 'Pumpkins', one: 'pumpkin', many: 'pumpkins', title: 'Pumpkin' },
    S: { tab: 'Squash', one: 'squash', many: 'squash', title: 'Squash' },
    W: { tab: 'Watermelons', one: 'watermelon', many: 'watermelons', title: 'Watermelon' },
    T: { tab: 'Tomatoes', one: 'tomato', many: 'tomatoes', title: 'Tomato' },
    F: { tab: 'Field pumpkins', one: 'field pumpkin', many: 'field pumpkins', title: 'Field pumpkin' },
    L: { tab: 'Long gourds', one: 'long gourd', many: 'long gourds', title: 'Long gourd' },
    B: { tab: 'Bushel gourds', one: 'bushel gourd', many: 'bushel gourds', title: 'Bushel gourd' },
    M: { tab: 'Marrows', one: 'marrow', many: 'marrows', title: 'Marrow' },
  };
  const ORDER = ['P', 'S', 'W', 'T', 'F', 'L', 'B', 'M'];
  const app = document.getElementById('app');
  const cache = new Map();
  const ui = { gens: null, trail: [], trees: { c: 'P' }, shown: 200 };
  let fp = null;            // the pumpkin page that is showing, if any
  let pendingPick = null;   // the tree segment that was just picked, so the next tree can grow out of it
  let routeSeq = 0;
  let disposers = [];

  function api(fn, params) {
    const qs = new URLSearchParams(Object.assign({ fn: fn }, params || {})).toString();
    if (!cache.has(qs)) {
      cache.set(qs, fetch('/api/v1?' + qs).then((r) => {
        if (!r.ok) throw new Error('The results didn’t load (' + r.status + ').');
        return r.json();
      }).catch((e) => { cache.delete(qs); throw e; }));
    }
    return cache.get(qs);
  }

  // ---------- Words and numbers ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => v == null ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const wTxt = (f) => num(f.w) + (f.u === 'in' ? ' in' : ' lb');
  const wLong = (f) => f.u === 'in' ? num(f.w) + ' inches long' : num(f.w) + ' lb';
  const grower = (f) => String((f && f.g) || '').replace(/\s*&\s*/g, ' and ');
  const placeShort = Fan.placeShort;
  const isPhone = () => window.matchMedia('(max-width: 599px)').matches;
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function placeLong(f) {
    const loc = (f && f.loc) || [];
    const town = loc[0] && loc[0] !== 'Other' ? loc[0] : '';
    const rest = placeShort(f);
    return [town, rest].filter(Boolean).join(', ');
  }
  function ordinal(n) {
    const v = n % 100;
    const s = v >= 11 && v <= 13 ? 'th' : ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'][n % 10];
    return num(n) + s;
  }
  const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
  const countWord = (n) => COUNT[n] || num(n);
  const tag = (f) => f.st === 'DMG' ? ' <span class="tag" title="Damaged, so the weight is unofficial">Damaged</span>' : f.st === 'EXH' ? ' <span class="tag" title="Entered for exhibition only, so it didn’t place">Exhibition</span>' : '';
  const fl = (f, cls) => '<a class="' + (cls || 'nm') + '" href="#/fruit/' + f.i + '">' + esc(f.n) + '</a>';
  const gl = (f) => '<a class="quiet" href="#/grower/' + encodeURIComponent(f.gk) + '">' + esc(grower(f)) + '</a>';
  const growerPlace = (f) => gl(f) + (placeShort(f) ? ' · ' + esc(placeShort(f)) : '');
  const QM = '<span class="qm" title="This name fits more than one pumpkin on record, so it’s shown as typed." aria-hidden="true">?</span><span class="sr"> (fits more than one pumpkin, shown as typed)</span>';

  // A parent as the results list it. Matched names link. Unmatched names stay as typed. Missing ones say so.
  function refHtml(f, side) {
    const raw = side === 'm' ? f.sr : f.pr, id = side === 'm' ? f.sid : f.pid, m = side === 'm' ? f.sm : f.pm;
    if (m === 'self') return '<span class="mut">Self-pollinated</span>';
    if (m === 'sib') return '<span class="mut">Sibling plant</span>';
    if (m === 'open') return '<span class="mut">Open-pollinated</span>';
    if (id != null) return '<a class="quiet" href="#/fruit/' + id + '">' + esc(raw) + '</a>';
    if (m === 'ambiguous') return '<span class="typed">' + esc(raw) + '</span>' + QM;
    if (!raw || m === 'none' || m === 'unknown') return '<span class="mut">Not on record</span>';
    return '<span class="typed" title="Shown as typed. No pumpkin on record matches this name.">' + esc(raw) + '</span>';
  }
  const TABLE_NOTE = 'A parent with a link is matched to one pumpkin on record. A name without a link is shown the way the grower typed it, because I couldn’t match it. ' +
    '<span class="qm" aria-hidden="true" style="margin:0 4px 0 0">?</span>marks a name that fits more than one pumpkin, so I haven’t picked one.';

  // Why a typed name has no pumpkin behind it, read from the name itself.
  function unlinkedNote(raw, firstYear) {
    const s = String(raw || '');
    if (/\bdmg\b|damaged/i.test(s)) return 'The name says it was damaged. A damaged pumpkin’s weight is unofficial, so it may not be in the results.';
    if (/\buow\b|unofficial/i.test(s)) return 'The name says its weight was unofficial, so it isn’t in the results.';
    if (/\best\b|estimated?/i.test(s)) return 'The name says its weight was estimated, so it was never on an official scale.';
    const rest = s.replace(/^\s*[\d.,]+\s*/, '');
    const years = (rest.match(/\b(19|20)\d{2}\b/g) || []).map(Number);
    let y = years.length ? years[years.length - 1] : null;
    const short = !y && rest.match(/[A-Za-z]\s+'?(\d{2})\s*$/);
    if (short) y = Number(short[1]) <= 30 ? 2000 + Number(short[1]) : 1900 + Number(short[1]);
    if (y && y < (firstYear || 2005)) return 'It was grown in ' + y + ', and these records start in ' + (firstYear || 2005) + '.';
    return 'It may have been weighed somewhere outside the official weigh-offs, or the name may be spelled in a way I can’t match.';
  }

  // ---------- Photos ----------
  const credit = (ph) => 'Photo: ' + esc(ph.credit || 'unknown') + (ph.license ? ', ' + esc(ph.license) : '') + (ph.page ? ' · <a href="' + esc(ph.page) + '" target="_blank" rel="noopener">source</a>' : '');
  function openPhoto(f) {
    if (!f || !f.ph) return;
    const prev = document.activeElement;
    const m = document.createElement('div');
    m.className = 'modal';
    const large = f.ph.thumb && f.ph.thumb.indexOf('/960px-') > -1 ? f.ph.thumb.replace('/960px-', '/1280px-') : (f.ph.full || f.ph.thumb);
    m.innerHTML = '<div class="dlg" role="dialog" aria-modal="true" aria-label="Photo of ' + esc(f.n) + '"><img src="' + esc(large) + '" alt="' + esc(f.n) + '"><div class="bar"><span><b>' + esc(f.n) + '</b> · ' + esc(wTxt(f)) + ' · ' + esc(grower(f)) + '<br><span class="mut">' + credit(f.ph) + '</span></span><button class="btn ghost sm" type="button" data-close>Close</button></div></div>';
    const close = () => { m.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); if (e.key === 'Tab') { e.preventDefault(); m.querySelector('[data-close]').focus(); } };
    m.addEventListener('click', (e) => { if (e.target === m || e.target.hasAttribute('data-close')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(m);
    const img = m.querySelector('img');
    img.addEventListener('error', () => { if (f.ph.full && img.src !== f.ph.full) img.src = f.ph.full; }, { once: true });
    m.querySelector('[data-close]').focus();
  }

  // ---------- Page plumbing ----------
  function setNav(key) { document.querySelectorAll('[data-nav]').forEach((a) => { a.classList.toggle('on', a.dataset.nav === key); if (a.dataset.nav === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); }
  function setTitle(t) { document.title = t ? t + ' · The Main Vine' : 'The Main Vine'; }
  function dispose() { disposers.forEach((d) => { try { d(); } catch (e) { /* gone already */ } }); disposers = []; fp = null; }
  function loading() { dispose(); app.innerHTML = '<p class="loading">Loading…</p>'; }
  function fail(e) { dispose(); app.innerHTML = '<div class="wrap page-head"><h1>That didn’t load</h1><p class="lead">' + esc(e && e.message ? e.message : 'Something went wrong.') + ' Check your connection and <a href="' + esc(location.hash || '#/') + '" onclick="location.reload();return false">try again</a>.</p></div>'; }
  function notFound(what) { dispose(); app.innerHTML = '<div class="wrap page-head"><h1>' + esc(what) + ' isn’t on record</h1><p class="lead">The link may be old. Try <a href="#/trees">looking it up by name</a>.</p></div>'; }
  function onBreakpoint(cb) {
    const mq = window.matchMedia('(max-width: 599px)');
    const h = () => cb(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', h); else mq.addListener(h);
    disposers.push(() => { if (mq.removeEventListener) mq.removeEventListener('change', h); else mq.removeListener(h); });
  }
  const fontsReady = (document.fonts && document.fonts.load)
    ? Promise.race([Promise.all([document.fonts.load('700 14px Figtree'), document.fonts.load('500 12px Figtree'), document.fonts.load('800 30px Fraunces')]), new Promise((r) => setTimeout(r, 1200))]).catch(() => {})
    : Promise.resolve();

  function keyRowHtml(model, G, wide) {
    const reps = Fan.repeats(model, G);
    const vis = model.slots.filter((s) => s.gen > 0 && s.gen <= G);
    const anyRep = Object.keys(reps).some((k) => reps[k] > 1);
    const anyNone = vis.some((s) => s.kind !== 'fruit' && s.kind !== 'stub' && s.kind !== 'amb');
    const anyAmb = vis.some((s) => s.kind === 'amb');
    const sc = model.scale;
    const unit = model.unit === 'in' ? ' in' : ' lb';
    return '<span><span class="sw" style="background:var(--mother)"></span>' + (wide ? 'Mother, the pumpkin whose seed was planted' : 'Mother, whose seed was planted') + '</span>' +
      '<span><span class="sw" style="background:var(--father)"></span>' + (wide ? 'Father, the pumpkin whose pollen was used' : 'Father, whose pollen was used') + '</span>' +
      (sc.flat ? '' : '<span>' + num(sc.lo) + unit + '<span class="ramp" aria-hidden="true">' + Fan.rampStops('m').map((c) => '<i style="background:' + c + '"></i>').join('') + '</span>' + num(sc.hi) + unit + ', deeper means heavier</span>') +
      (anyRep ? '<span><span class="dotk"></span>Appears more than once in this tree</span>' : '') +
      (anyNone ? '<span><span class="nonek"></span>Not on record</span>' : '') +
      (anyAmb ? '<span><span class="qk">?</span>The name fits more than one pumpkin, so it’s shown as typed</span>' : '');
  }

  // ---------- Home ----------
  async function home() {
    setNav('');
    setTitle('');
    loading();
    const seq = routeSeq;
    const [meta, rec] = await Promise.all([api('meta'), api('top', { c: 'P', y: 'all', limit: 1 })]);
    const top1 = rec.rows[0];
    const years = Object.keys(meta.counts.P.years).map(Number).sort((a, b) => b - a);
    const year = years[0];
    const heroId = top1.sid != null ? top1.sid : top1.i;
    const [data, top] = await Promise.all([api('fruit', { id: heroId, depth: 20 }), api('top', { c: 'P', y: year, limit: 100, all: '1' }), fontsReady]);
    if (seq !== routeSeq) return;
    const N = data.nodes;
    const hero = N[data.root];
    const isMother = top1.sid != null && hero.i !== top1.i;
    const now = new Date();
    const thisYear = now.getFullYear() === year;
    const when = top1.y === now.getFullYear() && now.getMonth() >= 8 ? 'This fall' : 'In ' + top1.y;
    const rows = top.rows;
    const fromSeed = rows.filter((r) => r.sid === hero.i).length;
    const yearsWord = thisYear ? 'this year’s' : year + '’s';

    // Mothers of the year's 100 heaviest
    const tally = new Map();
    rows.forEach((r) => {
      if (r.sid == null) return;
      const t = tally.get(r.sid) || { id: r.sid, n: 0, raw: r.sr };
      t.n += 1;
      if ((r.sr || '').length > (t.raw || '').length) t.raw = r.sr;
      tally.set(r.sid, t);
    });
    const mothers = Array.from(tally.values()).sort((a, b) => b.n - a.n).slice(0, 5);
    const placed = rows.filter((r) => r.st === 'placed').slice(0, 10);

    // The top 5 seeds of the year's 100 heaviest, by matched mother, each with its own color.
    const topSeed = mothers[0] || null;
    const SEED_COLORS = ['#F58A1F', '#E9C46A', '#E5869A', '#7FB8DC', '#B4A3E8'];
    const seedOf = new Map(mothers.map((t, k) => [t.id, k]));
    const seedName = (t) => (t.id === hero.i ? hero.n : (t.raw || '')).replace(/\s+\d{4}$/, '');
    const recThisYear = top1.y === year && thisYear;
    // "3156 Wallace 2026" -> weight, grower, year
    const parts = /^([\d.,]+)\s+(.+?)\s+(\d{4})$/.exec(top1.n || '');

    app.innerHTML =
      '<section class="wrap hero">' +
        '<h1>Giant pumpkin family trees</h1>' +
        '<p class="lead">Look up any pumpkin in the official weigh-off results back to ' + meta.years[0] + ' and see its parents, grandparents and further back.</p>' +
        '<form class="lookup" role="search" id="lookup"><label for="lq">Find a pumpkin or a grower</label><div class="row"><input id="lq" type="search" placeholder="Try 2365 Wolf 2021 or Stelts" autocomplete="off"><button class="btn" type="submit">Search</button></div></form>' +
      '</section>' +
      '<section class="wrap home-tree"><div id="homeFan"></div>' +
        '<div class="tree-cap"><p>' + (isMother
          ? (recThisYear ? 'Behind this year’s world record: ' : 'Behind the world record: ') + '<a href="#/fruit/' + top1.i + '">' + esc(top1.n) + '</a> grew from a seed of <a href="#/fruit/' + hero.i + '">' + esc(hero.n) + '</a>, the pumpkin at the center.'
          : 'At the center: <a href="#/fruit/' + hero.i + '">' + esc(hero.n) + '</a>, the heaviest pumpkin ever weighed.') + '</p>' +
          '<a class="btn" href="#/tree/' + hero.i + '">Open the full tree</a></div>' +
      '</section>' +
      '<section class="wrap home-cards">' +
        (parts ? '<div class="card anat"><div class="nm">' +
          '<div class="pt w"><b>' + esc(parts[1]) + '</b><span>Weight in pounds</span></div>' +
          '<div class="pt"><b>' + esc(parts[2]) + '</b><span>Grower</span></div>' +
          '<div class="pt"><b>' + esc(parts[3]) + '</b><span>Year weighed</span></div></div>' +
          '<p>Pumpkins are named this way. ' + esc(top1.n) + ' is the heaviest pumpkin ever weighed' + (isMother ? ', and its mother, ' + esc(hero.n) + ', is at the center of the tree above.' : ', and it’s at the center of the tree above.') + '</p></div>' : '') +
        '<div class="card read"><h3>Reading the tree</h3>' +
          '<p class="tree-rings">The pumpkin sits at the center. Its two parents are in the first ring, its four grandparents in the second<span class="rings3"> and its eight great-grandparents in the third</span>.</p>' +
          '<p><span class="sw" style="background:var(--mother)"></span>Orange is a mother, the pumpkin whose seed was planted.</p>' +
          '<p><span class="sw" style="background:var(--father)"></span>Green is a father, the pumpkin whose pollen was used.</p>' +
          '<p>A deeper color means a heavier pumpkin.</p>' +
          '<p class="rings3"><span class="dotk"></span>A dot marks a pumpkin that appears more than once.</p></div>' +
      '</section>' +
      '<section class="wrap sec seeds">' +
        (topSeed
          ? '<h2>Top seed for ' + year + '</h2>' +
            '<p class="lead seed-line">' + topSeed.n + ' of the 100 heaviest pumpkins in ' + year + ' were grown from the ' + esc(seedName(topSeed)) + ' seed.</p>' +
            '<div class="sq-key">' + mothers.map((t, k) => '<button type="button" class="seed-chip" aria-pressed="false" data-s="' + k + '" style="--c:' + SEED_COLORS[k] + '"><i class="sq-sw"></i><span>' + esc(seedName(t)) + '</span><b>' + t.n + '</b></button>').join('') + '</div>' +
            '<p class="mut sq-note">Each square is one of the 100 heaviest, numbered from the heaviest down.</p>'
          : '<h2>The 100 heaviest pumpkins of ' + year + '</h2><p class="soft measure" style="margin-top:10px">Each square is one of the 100 heaviest pumpkins weighed in ' + year + ', numbered from the heaviest down.</p>') +
        '<div class="squares" role="img" aria-label="The 100 heaviest pumpkins of ' + year + '.' + (mothers.length ? ' ' + mothers.map((t) => t.n + ' grew from the ' + esc(seedName(t)) + ' seed').join(', ') + '.' : '') + '">' +
          rows.map((r, i) => { const k = seedOf.get(r.sid); return k == null
            ? '<div class="sq" title="' + esc(r.n) + '">' + (i + 1) + '</div>'
            : '<div class="sq s" data-s="' + k + '" style="--c:' + SEED_COLORS[k] + '" title="' + esc(r.n + ', grown from the ' + seedName(mothers[k]) + ' seed') + '">' + (i + 1) + '</div>'; }).join('') + '</div>' +
        '<div class="two">' +
          '<div><h3>Mothers of ' + yearsWord + ' 100 heaviest</h3><table style="margin-top:8px"><thead><tr><th>Mother</th><th>Grown by</th><th class="r">Of the 100 heaviest</th></tr></thead><tbody>' +
            mothers.map((t, k) => '<tr data-s="' + k + '" style="--c:' + SEED_COLORS[k] + '"><td><i class="sq-sw"></i><a href="#/fruit/' + t.id + '" data-mname="' + t.id + '">' + esc(t.id === hero.i ? hero.n : t.raw) + '</a></td><td class="mut" data-mgrower="' + t.id + '">' + (t.id === hero.i ? esc(grower(hero)) : '') + '</td><td class="r w">' + t.n + '</td></tr>').join('') +
          '</tbody></table></div>' +
          '<div class="card"><h3>New to giant pumpkins?</h3>' +
            '<p>Every fall, growers bring their biggest pumpkins to contests called weigh-offs, where each one is weighed on a certified scale. The results go into one public list that runs back to ' + meta.years[0] + '. Everything on this site comes from that list.</p>' +
            '<p>Growers save the seeds from a big pumpkin and plant them the next spring, so every pumpkin has a mother. They also choose which plant’s pollen to use, so it has a father too.</p>' +
            '<a href="#/about">How weigh-offs work</a></div>' +
        '</div>' +
      '</section>' +
      '<section class="wrap sec">' +
        '<div class="sec-head"><h2>Heaviest pumpkins of ' + year + '</h2><a href="#/results/P/' + year + '">All ' + num(meta.counts.P.years[year]) + ' weighed ' + (thisYear ? 'this year' : 'in ' + year) + '</a></div>' +
        '<table style="margin-top:12px"><thead><tr><th><span class="sr">Place</span></th><th>Pumpkin</th><th class="col-m">Grower</th><th class="col-m">Mother</th><th class="r">Weight</th></tr></thead><tbody>' +
          placed.map((f, i) => '<tr><td class="w rank">' + (i + 1) + '</td><td>' + fl(f) + '<span class="only-s">' + growerPlace(f) + '</span></td><td class="mut col-m">' + growerPlace(f) + '</td><td class="mut col-m">' + refHtml(f, 'm') + '</td><td class="r w">' + wTxt(f) + '</td></tr>').join('') +
        '</tbody></table>' +
        '<p class="tbl-note col-m">' + TABLE_NOTE + ' Pumpkins that were damaged or shown for exhibition only don’t place, so they’re left out of this list.</p>' +
      '</section>' +
      '<section class="wrap sec"><h2>Other giant crops</h2>' +
        '<p class="soft" style="margin-top:8px">Weigh-offs have classes for more than pumpkins. These were the biggest of each in ' + year + '.</p>' +
        '<div class="crops">' + ORDER.filter((c) => c !== 'P' && meta.counts[c]).map((c) => {
          const ys = Object.keys(meta.counts[c].years).map(Number).sort((a, b) => b - a);
          return '<a class="crop" href="#/results/' + c + '/' + ys[0] + '" data-crop="' + c + '" data-y="' + ys[0] + '"><p class="cn">' + esc(CLASS[c].title) + '</p><p class="cl">&nbsp;</p><p class="cc">' + num(meta.counts[c].years[ys[0]]) + (c === 'L' ? ' measured ' : ' weighed ') + (ys[0] === year && thisYear ? 'this year' : 'in ' + ys[0]) + '</p></a>';
        }).join('') + '</div>' +
      '</section>';

    app.querySelector('#lookup').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = app.querySelector('#lq').value.trim();
      location.hash = v ? '#/search/' + encodeURIComponent(v) : '#/trees';
    });

    // The fan: three generations, two on a phone.
    const host = app.querySelector('#homeFan');
    const fan = Fan.create(host, { gens: isPhone() ? 2 : 3, maxGens: 3, href: (id) => '#/tree/' + id, rootHref: (id) => '#/tree/' + id,
      label: (m, G) => 'Family tree of ' + m.root.f.n + ', ' + ['', 'parents', 'parents and grandparents', 'three generations'][G] });
    fan.setData(N, hero.i);
    disposers.push(() => fan.destroy());
    onBreakpoint((phone) => { fan.setGens(phone ? 2 : 3); });

    // Pointing at a seed (its button, its row in the mothers table, or one of its squares) picks out its pumpkins on the grid.
    const grid = app.querySelector('.squares');
    let pinned = null;
    const pick = (k) => {
      if (!grid) return;
      grid.classList.toggle('hl', k != null);
      app.querySelectorAll('.sq.s, .seed-chip, tr[data-s]').forEach((el) => el.classList.toggle('pick', k != null && el.dataset.s === k));
      app.querySelectorAll('.seed-chip').forEach((el) => el.setAttribute('aria-pressed', String(pinned === el.dataset.s)));
    };
    app.querySelectorAll('.sq.s, .seed-chip, tr[data-s]').forEach((el) => {
      el.addEventListener('mouseenter', () => pick(el.dataset.s));
      el.addEventListener('mouseleave', () => pick(pinned));
    });
    app.querySelectorAll('.seed-chip').forEach((el) => {
      el.addEventListener('focus', () => pick(el.dataset.s));
      el.addEventListener('blur', () => pick(pinned));
      el.addEventListener('click', () => { pinned = pinned === el.dataset.s ? null : el.dataset.s; pick(pinned); });
    });

    // Fill in who grew each mother, and the biggest of each other crop, once the page is up.
    mothers.filter((t) => t.id !== hero.i).forEach((t) => {
      api('search', { q: t.raw }).then((res) => {
        const hit = (res.rows || []).find((r) => r.i === t.id);
        if (!hit || seq !== routeSeq) return;
        const g = app.querySelector('[data-mgrower="' + t.id + '"]'), n = app.querySelector('[data-mname="' + t.id + '"]');
        if (g) g.textContent = grower(hit);
        if (n) n.textContent = hit.n;
      }).catch(() => {});
    });
    app.querySelectorAll('[data-crop]').forEach((a) => {
      api('top', { c: a.dataset.crop, y: a.dataset.y, limit: 1 }).then((res) => {
        const f = res.rows && res.rows[0];
        if (!f || seq !== routeSeq) return;
        a.querySelector('.cl').innerHTML = '<span class="col-m">' + esc(wLong(f)) + ', grown by ' + esc(grower(f)) + (placeShort(f) ? ' in ' + esc(placeShort(f)) : '') + '</span><span class="only-s" style="color:var(--text);font-size:15px">' + esc(wTxt(f)) + '</span><span class="only-s">' + esc(grower(f)) + '</span>';
      }).catch(() => {});
    });
  }

  // ---------- A pumpkin's page ----------
  function pedigreeStats(rootId, N) {
    const memo = {};
    const par = (i) => { const f = N[i]; if (!f) return null; const s = f.sid, p = f.pm === 'self' ? f.sid : f.pid; return (s != null && p != null) ? [s, p] : null; };
    const kin = (a, b) => {
      if (a == null || b == null) return 0;
      if (!N[a] || !N[b]) return a === b ? 0.5 : 0;
      const key = a < b ? a + '|' + b : b + '|' + a;
      if (memo[key] !== undefined) return memo[key];
      let r;
      if (a === b) { const pp = par(a); r = 0.5 * (1 + (pp ? kin(pp[0], pp[1]) : 0)); }
      else {
        let x = a, y = b;
        if (N[b].y > N[a].y) { x = b; y = a; }
        const pp = par(x);
        r = pp ? 0.5 * (kin(pp[0], y) + kin(pp[1], y)) : 0;
      }
      memo[key] = r;
      return r;
    };
    const pp = par(rootId);
    const seen = new Set();
    let gens = 0;
    const walk = (i, g) => {
      const f = N[i];
      if (!f) return;
      if (g > 0) seen.add(i);
      if (g > gens) gens = g;
      if (f.sid != null) walk(f.sid, g + 1);
      if (f.pid != null && f.pid !== f.sid) walk(f.pid, g + 1);
    };
    walk(rootId, 0);
    return { F: pp ? kin(pp[0], pp[1]) : null, unique: seen.size, gens: gens };
  }

  function headHtml(f, data, meta, record) {
    const c = CLASS[f.c] || CLASS.P;
    const kids = data.asSeed.length + data.asPollen.length;
    const total = meta.counts[f.c] && meta.counts[f.c].years[f.y];
    let s = 'A ' + (f.u === 'in' ? num(f.w) + ' inch ' : num(f.w) + ' lb ') + c.one + ' that ' + esc(grower(f)) + ' grew' + (placeLong(f) ? ' in ' + esc(placeLong(f)) : '') + '.';
    const most = f.u === 'in' ? 'longest' : 'heaviest';
    if (f.st === 'DMG') s += ' It was damaged, so its weight is unofficial and it didn’t place.';
    else if (f.st === 'EXH') s += ' It was shown for exhibition only, so it didn’t place.';
    else if (f.p === '1') s += ' It was the ' + most + ' ' + c.one + ' weighed anywhere in ' + f.y + '.';
    else if (/^\d+$/.test(f.p || '') && total) s += ' It was the ' + ordinal(Number(f.p)) + ' ' + most + ' of the ' + num(total) + ' ' + c.many + ' weighed in ' + f.y + '.';
    if (kids) {
      const all = data.asSeed.concat(data.asPollen).slice().sort((a, b) => b.w - a.w);
      const best = all[0];
      s += ' Growers have since weighed ' + (kids === 1 ? 'one ' + c.one : num(kids) + ' ' + c.many) + ' grown from its seeds or its pollen';
      if (record && best.i === record.i && kids > 1) s += ', and one of them is <a href="#/fruit/' + best.i + '">' + esc(best.n) + '</a>, the ' + wTxt(best) + ' world record.';
      else if (kids > 1) s += ', and the heaviest of them is <a href="#/fruit/' + best.i + '">' + esc(best.n) + '</a>.';
      else s += ': <a href="#/fruit/' + best.i + '">' + esc(best.n) + '</a>.';
    }
    return '<p class="crumbs"><a href="#/results/' + f.c + '">' + esc(c.tab) + '</a> / <a href="#/results/' + f.c + '/' + f.y + '">' + f.y + '</a> / <a href="#/grower/' + encodeURIComponent(f.gk) + '">' + esc(grower(f)) + '</a></p>' +
      '<div class="phead"><h1' + (f.n.length > 20 ? ' class="long"' : '') + '>' + esc(f.n) + '</h1>' +
      '<div><p class="lead">' + s + '</p>' +
      (f.ph ? '<div class="pphoto"><button type="button" data-photo aria-label="Open a larger photo of ' + esc(f.n) + '"><img src="' + esc(f.ph.thumb) + '" alt="' + esc(f.n) + '" loading="lazy" width="200" height="140"></button><span class="cap">' + credit(f.ph) + '</span></div>' : '') +
      '</div></div>';
  }

  function parentHtml(f, N, side, meta) {
    const raw = side === 'm' ? f.sr : f.pr, id = side === 'm' ? f.sid : f.pid, m = side === 'm' ? f.sm : f.pm, alt = (side === 'm' ? f.sa : f.pa) || [];
    const who = side === 'm' ? 'mother' : 'father';
    const dt = side === 'm' ? 'Mother, the seed parent' : 'Father, the pollen parent';
    let v, d;
    if (m === 'self') { v = 'Self-pollinated'; d = 'The pollen came from the same plant that grew it, so its father’s side is the same as its mother’s.'; }
    else if (id != null && N[id]) {
      const p = N[id];
      v = '<a href="#/fruit/' + id + '">' + esc(p.n) + '</a>';
      d = wTxt(p) + ', grown by ' + esc(grower(p)) + (placeShort(p) ? ' in ' + esc(placeShort(p)) : '') + '. ' +
        (side === 'm' ? 'This pumpkin grew from one of its seeds.' : 'The pollen came from a plant grown from one of its seeds.') +
        (raw && raw.trim().toLowerCase() !== p.n.toLowerCase() ? ' The results list it as “' + esc(raw) + '”.' : '');
    } else if (id != null) { v = '<a href="#/fruit/' + id + '">' + esc(raw) + '</a>'; d = ''; }
    else if (m === 'ambiguous') {
      v = esc(raw) + QM;
      const c = alt.map((i) => N[i]).filter(Boolean);
      d = 'The results list the ' + who + ' as “' + esc(raw) + '”. That name fits ' + (c.length || 'more than one') + ' pumpkins on record, so I haven’t picked one' + (c.length ? ': ' + c.map((z) => fl(z, 'quiet')).join(', ') + '.' : '.');
    } else if (m === 'sib') { v = 'A sibling plant'; d = 'The pollen came from a sibling of the plant that grew it: another plant from the same seed' + (f.sr ? ', ' + esc(f.sr) : '') + '.'; }
    else if (m === 'open') { v = 'Open-pollinated'; d = 'Nobody chose the pollen, so the father isn’t known.'; }
    else if (!raw || m === 'none' || m === 'unknown') { v = 'Not on record'; d = 'The grower didn’t list a ' + who + '.'; }
    else { v = esc(raw); d = 'Not on record. The results list the ' + who + ' as “' + esc(raw) + '”, and I couldn’t match that name to a pumpkin. ' + unlinkedNote(raw, meta.years[0]); }
    return '<div><dt>' + dt + '</dt><dd class="v name">' + v + '</dd><dd>' + d + '</dd></div>';
  }

  // The father plant: the results name the seed it grew from, but they don't say what the plant itself grew.
  function fatherPlantHtml(f, N) {
    const pg = f.pg;
    if (!pg || pg.k === 'self') return '';
    const seed = pg.k === 'sib' ? (f.sr || 'the same') : (f.pr || 'that');
    const fr = (pg.ids || []).map((i) => N[i]).filter(Boolean);
    const g = esc(grower(f));
    let v, d;
    if (pg.st === 'one' && fr[0]) {
      v = '<a href="#/fruit/' + fr[0].i + '">' + esc(fr[0].n) + '</a>';
      d = 'This is a strong guess. The results name the seed the father plant grew from, but they don’t say what that plant went on to grow. ' + g + ' weighed exactly one other ' + f.y + ' pumpkin from a ' + esc(seed) + ' seed, so that plant almost certainly gave the pollen.';
    } else if (pg.st === 'many' && fr.length) {
      v = 'One of ' + fr.length + ' plants';
      d = g + ' weighed ' + fr.length + ' other ' + f.y + ' pumpkins from a ' + esc(seed) + ' seed: ' + fr.map((z) => fl(z, 'quiet')).join(', ') + '. The pollen came from one of those plants, and the records can’t say which.';
    } else if (pg.st === 'same-seed') {
      v = 'Same seed as the mother';
      d = 'The father is listed as the same seed as the mother, and ' + g + ' has no other ' + f.y + ' pumpkin from that seed on record. It was most likely self-pollinated, or pollinated by a sibling plant.';
    } else {
      v = 'Not on record';
      d = g + ' has no other ' + f.y + ' pumpkin from a ' + esc(seed) + ' seed on record. Either the father plant didn’t grow a pumpkin that was weighed, or the pollen came from another grower’s plant.';
    }
    return '<div><dt>What the father plant grew</dt><dd class="v name">' + v + '</dd><dd>' + d + '</dd></div>';
  }

  function kidList(data) {
    const kids = new Map();
    data.asSeed.forEach((z) => kids.set(z.i, { z: z, m: true, f: false }));
    data.asPollen.forEach((z) => { const k = kids.get(z.i); if (k) k.f = true; else kids.set(z.i, { z: z, m: false, f: true }); });
    return Array.from(kids.values()).sort((a, b) => b.z.w - a.z.w);
  }
  function kidRow(k) {
    const z = k.z;
    const role = k.m && k.f ? 'Mother and father' : k.m ? 'Mother' : 'Father';
    const other = k.m && k.f ? '<span class="mut">The same pumpkin</span>' : refHtml(z, k.m ? 'f' : 'm');
    return '<tr><td>' + fl(z) + tag(z) + '<span class="only-s">' + growerPlace(z) + ' · ' + role.toLowerCase() + '</span></td><td class="mut col-m">' + growerPlace(z) + '</td><td class="col-m">' + role + '</td><td class="mut col-m">' + other + '</td><td class="r w">' + wTxt(z) + '</td></tr>';
  }

  function restHtml(f, data, meta) {
    const N = data.nodes;
    const c = CLASS[f.c] || CLASS.P;
    const plant = fatherPlantHtml(f, N);
    const isLen = f.u === 'in';
    let stats = '<div><dt>' + (isLen ? 'Length' : 'Weight') + '</dt><dd class="v">' + (isLen ? num(f.w) + ' in' : num(f.w) + ' lb') + '</dd><dd>' + (f.kg ? num(Math.round(f.kg)) + ' kg' : isLen ? num(Math.round(f.w * 2.54)) + ' cm' : '') + '</dd></div>';
    if (!isLen) {
      stats += '<div><dt>Measured over the top</dt><dd class="v">' + (f.ott ? num(f.ott) + ' in' : 'Not on record') + '</dd><dd>Three tape measurements added together: around the pumpkin, over it side to side and over it end to end. Growers call the total OTT, for over the top.</dd></div>';
      const p = f.pct == null ? null : Math.round(f.pct);
      stats += '<div><dt>Compared with its size</dt><dd class="v">' + (p == null ? 'Not on record' : p > 0 ? p + '% heavier' : p < 0 ? Math.abs(p) + '% lighter' : 'Right on the chart') + '</dd><dd>A chart turns the tape total into a predicted weight.' + (f.est ? ' For this one it predicted ' + num(f.est) + ' lb.' : '') + '</dd></div>';
    }
    stats += '<div><dt>Weigh-off</dt><dd class="v" id="woPlace">' + (f.st === 'DMG' ? 'Damaged' : f.st === 'EXH' ? 'Exhibition only' : '&nbsp;') + '</dd><dd>' + esc(f.s) + ', ' + f.y + '. A weigh-off is the contest where it went on the scale.' +
      (f.p === '1' && f.st === 'placed' ? ' It was also the ' + (isLen ? 'longest ' : 'heaviest ') + c.one + ' weighed anywhere that year.' : '') + '</dd></div>';

    // Everything grown from it
    const list = kidList(data);
    const np = Fan.nameParts(f.n);
    const short = np.surname ? np.weight + ' ' + np.surname : f.n;
    let grown = '';
    if (list.length) {
      const nS = data.asSeed.length, nP = data.asPollen.length;
      grown = '<section class="wrap sec" style="margin-top:80px"><h2>The ' + (list.length === 1 ? 'one ' + c.one : num(list.length) + ' ' + c.many) + ' grown from it</h2>' +
        '<p class="soft measure" style="margin-top:8px">Each dot is one ' + c.one + ', placed by its ' + (isLen ? 'length' : 'weight') + '. ' +
        (nS ? num(nS) + ' grew from its seeds, which makes it their mother. ' : '') + (nP ? num(nP) + (nP === 1 ? ' was' : ' were') + ' pollinated by a plant grown from its seed, which makes it their father.' : '') + '</p>' +
        '<div class="dots" id="dots"></div>' +
        '<div class="kids"><div class="sec-head"><h3>' + (list.length > 6 ? 'The heaviest of them' : 'All of them') + '</h3>' + (list.length > 6 ? '<button class="linkbtn" type="button" id="allKids" aria-expanded="false">See all ' + num(list.length) + '</button>' : '') + '</div>' +
        '<table style="margin-top:8px"><thead><tr><th>' + esc(c.title) + '</th><th class="col-m">Grower</th><th class="col-m">' + esc(short) + ' was its</th><th class="col-m">Other parent</th><th class="r">' + (isLen ? 'Length' : 'Weight') + '</th></tr></thead><tbody id="kidRows">' + list.slice(0, 6).map(kidRow).join('') + '</tbody></table></div></section>';
    }
    const mini = (rows) => '<table style="margin-top:8px"><thead><tr><th>' + esc(c.title) + '</th><th class="col-m">Mother</th><th class="col-m">Father</th><th class="r">' + (isLen ? 'Length' : 'Weight') + '</th></tr></thead><tbody>' +
      rows.map((z) => '<tr><td>' + fl(z) + tag(z) + '<span class="only-s">' + esc(z.sr || 'Mother not on record') + '</span></td><td class="mut col-m">' + refHtml(z, 'm') + '</td><td class="mut col-m">' + refHtml(z, 'f') + '</td><td class="r w">' + wTxt(z) + '</td></tr>').join('') + '</tbody></table>';
    let extra = '';
    if (data.plantPollinated && data.plantPollinated.length) {
      extra += '<section class="wrap sec"><div class="kids" style="margin-top:0"><h3>Pumpkins its own plant probably pollinated</h3>' +
        '<p class="soft" style="margin-top:8px">' + esc(grower(f)) + ' pollinated ' + (data.plantPollinated.length === 1 ? 'this ' + f.y + ' ' + c.one : 'these ' + f.y + ' ' + c.many) + ' with a plant grown from the same seed as this one. If this was that plant, it’s ' + (data.plantPollinated.length === 1 ? 'the' : 'their') + ' father plant. That’s a strong guess, and <a href="#/about">About the data</a> explains how I make it.</p>' +
        mini(data.plantPollinated) + '</div></section>';
    }
    if (data.sameGrowerSameYear && data.sameGrowerSameYear.length) {
      extra += '<section class="wrap sec"><div class="kids" style="margin-top:0"><h3>What else ' + esc(grower(f)) + ' weighed in ' + f.y + '</h3>' + mini(data.sameGrowerSameYear) + '</div></section>';
    }
    return '<section class="wrap sec" style="margin-top:64px"><h2 class="sr">Its parents</h2><dl class="stats' + (plant ? ' three' : '') + '" style="' + (plant ? '' : 'grid-template-columns:repeat(2,1fr)') + '">' + parentHtml(f, N, 'm', meta) + parentHtml(f, N, 'f', meta) + plant + '</dl></section>' +
      '<section class="wrap sec" style="margin-top:56px"><h2 class="sr">Its numbers</h2><dl class="stats"' + (isLen ? ' style="grid-template-columns:repeat(2,1fr)"' : '') + '>' + stats + '</dl></section>' + grown + extra;
  }

  function drawDots(host, groups, unit) {
    const W = Math.max(280, host.clientWidth);
    const wide = W >= 700;
    const all0 = groups.reduce((a, g) => a.concat(g.rows), []);
    const best0 = all0.slice().sort((a, b) => b.w - a.w)[0];
    const left = wide ? 150 : 6, right = wide ? Math.max(40, (all0.length > 1 ? best0.n.length * 7.7 + 6 : 0)) : 14;
    const r = wide ? 5.5 : 4, gap = r * 2 + 1;
    const all = groups.reduce((a, g) => a.concat(g.rows), []);
    const maxW = Math.max.apply(null, all.map((z) => z.w));
    const want = wide ? 7 : 3.5;
    const pow = Math.pow(10, Math.floor(Math.log10(maxW / want)));
    const n = maxW / want / pow;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
    const top = maxW * (wide ? 1.01 : 1.04);
    const x = (w) => left + (W - left - right) * (w / top);
    const best = all.slice().sort((a, b) => b.w - a.w)[0];
    let y = 14;
    let body = '';
    let bestXY = null;
    groups.forEach((g) => {
      if (!g.rows.length) return;
      const placedDots = [];
      const sorted = g.rows.slice().sort((a, b) => a.w - b.w);
      let up = 0, down = 0;
      sorted.forEach((z) => {
        const cx = x(z.w);
        let lvl = 0;
        for (let k = 0; k < 13; k++) {
          lvl = k === 0 ? 0 : (k % 2 ? -1 : 1) * Math.ceil(k / 2);
          if (!placedDots.some((d) => d.lvl === lvl && Math.abs(d.cx - cx) < gap)) break;
        }
        placedDots.push({ cx: cx, lvl: lvl, z: z });
        up = Math.max(up, -lvl); down = Math.max(down, lvl);
      });
      const labelH = wide ? 0 : 44;
      const base = y + labelH + up * gap + r + 2;
      if (wide) {
        body += '<text x="0" y="' + (base) + '" fill="#FFF7EA" font-size="16" font-weight="600">' + esc(g.label) + '</text><text x="0" y="' + (base + 20) + '" fill="#C3B5A1" font-size="14">' + esc(g.count) + '</text>';
      } else {
        body += '<text x="0" y="' + (y + 16) + '" fill="#FFF7EA" font-size="15" font-weight="600">' + esc(g.label) + '</text><text x="0" y="' + (y + 34) + '" fill="#C3B5A1" font-size="13.5">' + esc(g.count) + (all.length > 1 && g.rows.indexOf(best) > -1 ? ', the heaviest is ' + esc(best.n) : '') + '</text>';
      }
      placedDots.forEach((d) => {
        const cy = base + d.lvl * gap;
        if (d.z === best) bestXY = [d.cx, cy];
        body += '<circle cx="' + d.cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r + '" fill="' + g.color + '" stroke="#15110E" stroke-width="1.5"><title>' + esc(d.z.n) + '</title></circle>';
      });
      g.base = base;
      y = base + Math.max(down * gap + r, wide ? 26 : 0) + (wide ? 34 : 22);
    });
    const H = y + 22;
    let grid = '';
    const lastTick = Math.floor(top / step + 1e-6) * step;
    for (let v = 0; v <= lastTick + 1e-6; v += step) {
      const gx = x(v).toFixed(1);
      grid += '<line x1="' + gx + '" x2="' + gx + '" y1="8" y2="' + (H - 30) + '" stroke="#3A2F27"/><text x="' + gx + '" y="' + (H - 8) + '" fill="#C3B5A1" font-size="' + (wide ? 14 : 12.5) + '" text-anchor="middle">' + num(v) + (v + step > lastTick + 1e-6 ? ' ' + unit : '') + '</text>';
    }
    let label = '';
    if (wide && best && bestXY && all.length > 1) {
      label = '<text x="' + (bestXY[0] + 12).toFixed(1) + '" y="' + (bestXY[1] + 5).toFixed(1) + '" fill="#FFF7EA" font-size="14" font-weight="600">' + esc(best.n) + '</text>';
    }
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(host.dataset.label || '') + '">' + grid + body + label + '</svg>';
  }

  function listHtml(model, G) {
    const GEN = ['', 'Parents', 'Grandparents', 'Great-grandparents', 'Great-great-grandparents', 'Great-great-great-grandparents'];
    const reps = Fan.repeats(model, G);
    let out = '';
    for (let g = 1; g <= G; g++) {
      const ring = model.slots.filter((s) => s.gen === g);
      if (!ring.length) continue;
      out += '<h3>' + GEN[g] + '</h3><ul>' + ring.map((s) => {
        let d;
        if (s.kind === 'fruit') d = '<a href="#/tree/' + s.id + '">' + esc(s.f.n) + '</a> · ' + wTxt(s.f) + ' · ' + esc(grower(s.f)) + (placeShort(s.f) ? ', ' + esc(placeShort(s.f)) : '') + (reps[s.id] > 1 ? ' · fills ' + reps[s.id] + ' places in this tree' : '');
        else if (s.kind === 'stub') d = '<a href="#/tree/' + s.id + '">' + esc(s.raw) + '</a>';
        else if (s.kind === 'amb') d = 'Listed as “' + esc(s.raw) + '”. That fits more than one pumpkin, so it’s shown as typed' + (s.alt.length ? ': ' + s.alt.map((z) => '<a href="#/tree/' + z.i + '">' + esc(z.n) + '</a>').join(', ') : '') + '.';
        else if (s.kind === 'ext') d = 'Listed as “' + esc(s.raw) + '”. Not on record.';
        else d = Fan.PSEUDO[s.kind].text;
        return '<li><span class="rel">' + Fan.relLabel(s.path) + '</span><span>' + d + '</span></li>';
      }).join('') + '</ul>';
    }
    return out;
  }

  function notesHtml(model, G, wanted, maxG, stats) {
    const root = model.root.f;
    const RINGS = ['', 'two parents', 'four grandparents', 'eight great-grandparents', 'sixteen great-great-grandparents', 'thirty-two great-great-great-grandparents'];
    const real = model.slots.some((s) => s.gen > 0 && s.kind !== 'none');
    if (!real) return '<p>The grower didn’t list either parent, so there’s no family tree to draw for this one yet.</p>';
    let rings = 'The ' + RINGS[1] + ' are in the first ring';
    if (G === 2) rings += ' and the ' + RINGS[2] + ' in the second';
    else if (G > 2) rings += ', then ' + RINGS.slice(2, G).join(', ') + ' and ' + RINGS[G];
    let p1 = 'Read it from the center out. ' + rings + '. Within each pair the mother comes first. Point at any pumpkin to light up the line that connects it to ' + esc(root.n) + ', and click it to put it at the center. On a touch screen, tap once to see who it is and tap again to put it at the center.';
    if (model.depth < wanted) p1 += ' The records go back ' + (model.depth === 1 ? 'one generation' : model.depth + ' generations') + ' for this pumpkin.';
    else if (G === maxG && model.depth >= maxG) p1 += ' The tree stops at ' + ['', 'one', 'two', 'three', 'four', 'five'][maxG] + ' generations because the outer ring gets too crowded to read past that. To go further back, put an ancestor at the center.';
    if (G > 1 && model.depth > 1) {
      const sm = model.byPath.rm, sf = model.byPath.rf;
      const why = { ext: 'isn’t matched to a pumpkin on record', amb: 'could be more than one pumpkin', none: 'wasn’t listed', open: 'isn’t known', self: 'is the same plant, so that side would repeat the mother’s', sib: 'is a sibling plant grown from the same seed, so that side would repeat the mother’s' };
      [[sm, 'mother', 'left'], [sf, 'father', 'right']].forEach((t) => {
        if (t[0] && why[t[0].kind]) p1 += ' The ' + t[2] + ' half stops at the first ring because the ' + t[1] + ' ' + why[t[0].kind] + '.';
      });
    }
    const reps = Fan.repeats(model, G);
    const ids = Object.keys(reps).filter((k) => reps[k] > 1).sort((a, b) => reps[b] - reps[a]);
    let p2 = '';
    if (ids.length) {
      const names = ids.map((k) => { const s = model.slots.find((o) => String(o.id) === k && o.gen > 0); return esc(Fan.slotName(s)) + ' (' + reps[k] + ' times)'; });
      p2 = '<p>' + countWord(ids.length) + (ids.length === 1 ? ' pumpkin fills' : ' pumpkins fill') + ' more than one place in this tree: ' + names.join(', ') + '. Growers keep crossing back to the pumpkins that grew big, so the same names come up again.</p>';
    }
    let p3 = '';
    if (stats && stats.unique) {
      p3 = '<p class="mut">The records hold ' + num(stats.unique) + (stats.unique === 1 ? ' ancestor' : ' ancestors') + ' of ' + esc(root.n) + ', going back ' + (stats.gens === 1 ? 'one generation' : stats.gens + ' generations') + '.' +
        (stats.F != null && stats.F > 0 ? ' Its inbreeding coefficient is ' + stats.F.toFixed(3) + '. That number measures how much its mother and father share ancestors, and zero would mean they share none on record.' : '') + '</p>';
    }
    return '<p>' + p1 + '</p>' + p2 + p3;
  }

  function cardHtml(s, info, model, meta) {
    const root = model.root.f;
    const chain = () => {
      const steps = [];
      let cur = s;
      while (cur.parent) { steps.push({ w: cur.role === 'm' ? 'mother' : 'father', of: Fan.slotName(cur.parent) }); cur = cur.parent; }
      if (!steps.length) return '';
      let t = 'Here it is the ' + steps[0].w + ' of ' + esc(steps[0].of);
      for (let i = 1; i < steps.length; i++) t += (i === steps.length - 1 ? ', the ' : ', which is the ') + steps[i].w + ' of ' + esc(steps[i].of);
      return '<p>' + t + '.</p>';
    };
    if (s.gen === 0) return '<h3>' + esc(root.n) + '</h3><p>This is the pumpkin at the center of the tree. Everything around it is an ancestor.</p>';
    if (s.kind === 'fruit') {
      const f = s.f;
      const c = CLASS[f.c] || CLASS.P;
      return '<h3><a href="#/fruit/' + f.i + '">' + esc(f.n) + '</a></h3>' +
        '<p>' + wTxt(f) + ', grown by ' + esc(grower(f)) + (placeShort(f) ? ' in ' + esc(placeShort(f)) : '') + '.' +
        (f.p === '1' && f.st === 'placed' ? ' It was the ' + (f.u === 'in' ? 'longest ' : 'heaviest ') + c.one + ' of ' + f.y + '.' : f.st === 'DMG' ? ' It was damaged, so the weight is unofficial.' : f.st === 'EXH' ? ' It was shown for exhibition only.' : '') + '</p>' +
        chain() +
        (info && info.reps > 1 ? '<p>It fills ' + info.reps + ' places in this tree.</p>' : '') +
        (s.raw && s.raw.trim().toLowerCase() !== f.n.toLowerCase() ? '<p class="hint">The results list it as “' + esc(s.raw) + '”.</p>' : '') +
        '<div class="acts"><a class="btn sm" href="#/tree/' + f.i + '" data-center="' + s.path + '">Open its own tree</a></div>';
    }
    if (s.kind === 'stub') return '<h3><a href="#/fruit/' + s.id + '">' + esc(s.raw) + '</a></h3>' + chain() + '<div class="acts"><a class="btn sm" href="#/tree/' + s.id + '" data-center="' + s.path + '">Open its own tree</a></div>';
    if (s.kind === 'amb') {
      return '<h3>' + esc(s.raw) + ' <span class="qk" style="vertical-align:3px;margin:0">?</span></h3><p>The results list this parent as “' + esc(s.raw) + '”. That name fits ' + (s.alt.length || 'more than one') + ' pumpkins on record, so I haven’t picked one.</p>' +
        (s.alt.length ? '<ul>' + s.alt.slice(0, 8).map((z) => '<li><a href="#/tree/' + z.i + '">' + esc(z.n) + '</a></li>').join('') + '</ul>' : '') + chain();
    }
    if (s.kind === 'ext') return '<h3>' + esc(s.raw) + '</h3><p>Not on record. This is the name as the grower typed it, and I couldn’t match it to a pumpkin. ' + unlinkedNote(s.raw, meta.years[0]) + '</p>' + chain();
    if (s.kind === 'self') return '<h3>Self-pollinated</h3><p>' + esc(Fan.slotName(s.parent)) + ' was pollinated with its own plant’s pollen, so this side of its family is the same as its mother’s side.</p>';
    if (s.kind === 'sib') return '<h3>Sibling plant</h3><p>The pollen for ' + esc(Fan.slotName(s.parent)) + ' came from a sibling plant, grown from the same seed as the plant that carried it.</p>';
    if (s.kind === 'open') return '<h3>Open-pollinated</h3><p>Nobody chose the pollen for ' + esc(Fan.slotName(s.parent)) + ', so its father isn’t known.</p>';
    return '<h3>Not on record</h3><p>The grower of ' + esc(Fan.slotName(s.parent)) + ' didn’t list this parent.</p>';
  }
  const CARD_HINT = '<p class="hint">Point at a pumpkin, or tap it, to see who it is and how it’s related. Click it, or tap it a second time, to put it at the center of the tree.</p>';

  async function fruitPage(id, o) {
    const seq = routeSeq;
    const pick = pendingPick && pendingPick.id === id ? pendingPick : null;
    pendingPick = null;
    const soft = !!(o.toTree && fp && fp.fan && fp.f && fp.f.i !== id && document.getElementById('treeSec'));
    setNav('trees');
    let foldDone = null;
    let hadFocus = false;
    if (soft) {
      hadFocus = !!(pick && pick.byKey) && fp.stage.contains(document.activeElement);
      foldDone = fp.fan.foldAway(pick ? pick.origin.path : null);
      fp.card.hidden = true;
    } else {
      loading();
    }
    const [data, meta] = await Promise.all([api('fruit', { id: id, depth: 20 }), api('meta'), fontsReady, foldDone]);
    if (seq !== routeSeq) return;
    if (data.error || !data.nodes || !data.nodes[data.root]) { notFound('That pumpkin'); return; }
    const N = data.nodes;
    const f = N[data.root];
    const record = await api('top', { c: f.c, y: 'all', limit: 1 }).then((r) => r.rows[0]).catch(() => null);
    if (seq !== routeSeq) return;
    setTitle(f.n);
    const stats = pedigreeStats(f.i, N);

    if (soft) {
      const at = ui.trail.findIndex((t) => t.i === id);
      if (at > -1) ui.trail = ui.trail.slice(0, at); else ui.trail.push({ i: fp.f.i, n: fp.f.n });
    } else {
      ui.trail = [];
      const phone = isPhone();
      const maxG = phone ? 4 : 5;
      app.innerHTML = '<section class="wrap" id="fpHead"></section>' +
        '<section class="wrap tree-sec" id="treeSec">' +
          '<div class="tree-bar"><h2 id="treeH" tabindex="-1">Family tree</h2>' +
            '<div class="gens"><span class="mut" id="gensLbl">Generations back</span><span class="seg" role="group" aria-labelledby="gensLbl" id="gensBtns"></span></div></div>' +
          '<div class="keyrow" id="treeKey"></div>' +
          '<nav class="trail" id="treeTrail" aria-label="Where you came from in this tree"></nav>' +
          '<div class="stage" id="treeStage"><div id="treeFan"></div><aside class="card tcard left" id="treeCard" hidden></aside></div>' +
          '<div class="tree-notes" id="treeNotes"></div>' +
          '<details class="tree-list" id="treeList"><summary>Read this tree as a list</summary><div></div></details>' +
        '</section><div id="fpRest"></div>';
      const stage = app.querySelector('#treeStage');
      const card = app.querySelector('#treeCard');
      const me = { stage: stage, card: card, maxG: maxG, f: null, data: null, meta: meta, stats: null };
      if (ui.gens == null || ui.gens > maxG) ui.gens = 4;
      me.fan = Fan.create(app.querySelector('#treeFan'), {
        gens: ui.gens, maxGens: maxG, leaveDelay: 420,
        href: (i) => '#/tree/' + i,
        label: (m, G) => 'Family tree of ' + m.root.f.n + ', ' + ['', 'one generation', 'two generations', 'three generations', 'four generations', 'five generations'][G] + ' of ancestors. The same ancestors are in the list under the tree.',
        onActivate: (s, origin, byKey) => { if (s && s.id != null && origin) pendingPick = { id: s.id, origin: origin, byKey: byKey }; },
        onSelect: (s, info) => {
          if (!s) { card.hidden = true; card.innerHTML = CARD_HINT; return; }
          card.innerHTML = cardHtml(s, info, me.fan.model, me.meta);
          card.hidden = false;
          // The card takes whichever top corner covers less of the line that's lit.
          const pts = me.fan.litPoints();
          const cover = (side) => {
            card.classList.toggle('left', side === 'left'); card.classList.toggle('right', side === 'right');
            const r = card.getBoundingClientRect();
            return pts.reduce((n, p) => n + (p.x > r.left - 8 && p.x < r.right + 8 && p.y > r.top - 8 && p.y < r.bottom + 8 ? (p.sel ? 10 : 1) : 0), 0);
          };
          const prefer = info.leftHalf ? 'right' : 'left', other = info.leftHalf ? 'left' : 'right';
          if (cover(other) < cover(prefer)) cover(other);
        },
      });
      card.innerHTML = CARD_HINT;
      // Moving from the fan onto the card keeps the card up.
      let cardTimer = null;
      card.addEventListener('pointerenter', () => { clearTimeout(cardTimer); me.fan.hold(); });
      card.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch') return; cardTimer = setTimeout(() => me.fan.release(), 200); });
      card.addEventListener('click', (e) => {
        const a = e.target.closest('[data-center]');
        if (!a) return;
        const s = me.fan.model.byPath[a.dataset.center];
        if (s) pendingPick = { id: s.id, origin: me.fan.originOf(s) };
      });
      const outside = (e) => { if (me.fan.sticky && !stage.contains(e.target)) me.fan.select(null); };
      document.addEventListener('pointerdown', outside);
      app.querySelector('#gensBtns').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-g]');
        if (!b) return;
        ui.gens = Number(b.dataset.g);
        me.fan.setGens(ui.gens);
        paintTree(me);
      });
      onBreakpoint((nowPhone) => { // a phone stops at four generations
        if ((nowPhone ? 4 : 5) !== me.maxG) route();
      });
      disposers.push(() => { me.fan.destroy(); document.removeEventListener('pointerdown', outside); });
      fp = me;
    }

    const me = fp;
    const stageTop = me.stage.getBoundingClientRect().top;
    me.f = f; me.data = data; me.meta = meta; me.stats = stats;
    const head = app.querySelector('#fpHead');
    head.innerHTML = headHtml(f, data, meta, record);
    const pb = head.querySelector('[data-photo]');
    if (pb) pb.addEventListener('click', () => openPhoto(f));
    app.querySelector('#fpRest').innerHTML = restHtml(f, data, meta);
    me.fan.setData(N, f.i, { origin: pick ? pick.origin : null, animate: still() ? 'none' : 'open' });
    paintTree(me);
    wireRest(me, seq);

    if (soft) {
      const nowTop = me.stage.getBoundingClientRect().top;
      if (stageTop > -40 && stageTop < window.innerHeight * 0.7) window.scrollBy(0, nowTop - stageTop);
      else app.querySelector('#treeSec').scrollIntoView({ block: 'start' });
      if (hadFocus) { const r = me.stage.querySelector('.hit[data-p="r"]'); if (r) r.focus({ preventScroll: true }); }
    } else if (o.toTree) {
      const sec = app.querySelector('#treeSec');
      sec.scrollIntoView({ block: 'start', behavior: 'auto' });
      const h = app.querySelector('#treeH');
      if (h) h.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, 0);
    }
  }

  // Everything around the fan that depends on which pumpkin is at the center and how many rings show.
  function paintTree(me) {
    const model = me.fan.model;
    const G = Math.max(1, Math.min(ui.gens, model.depth));
    const gb = app.querySelector('#gensBtns');
    let b = '';
    for (let g = 2; g <= me.maxG; g++) b += '<button type="button" data-g="' + g + '" aria-pressed="' + (ui.gens === g) + '">' + g + '</button>';
    gb.innerHTML = b;
    app.querySelector('#treeKey').innerHTML = keyRowHtml(model, G, !isPhone());
    const t = ui.trail;
    app.querySelector('#treeTrail').innerHTML = t.length
      ? '<a class="btn ghost sm" href="#/tree/' + t[t.length - 1].i + '"><span aria-hidden="true">←&nbsp;</span>Back to ' + esc(t[t.length - 1].n) + '</a>' +
        (t.length > 1 ? '<a href="#/tree/' + t[0].i + '">Start again from ' + esc(t[0].n) + '</a>' : '') +
        '<span class="mut">Now at the center: ' + esc(model.root.f.n) + '</span>'
      : '';
    app.querySelector('#treeNotes').innerHTML = notesHtml(model, G, ui.gens, me.maxG, me.stats);
    app.querySelector('#treeList > div').innerHTML = listHtml(model, G);
  }

  function wireRest(me, seq) {
    const f = me.f, data = me.data;
    const c = CLASS[f.c] || CLASS.P;
    const dots = app.querySelector('#dots');
    if (dots) {
      const groups = [
        { label: 'From its seeds', count: data.asSeed.length === 1 ? '1 ' + c.one : num(data.asSeed.length) + ' ' + c.many, rows: data.asSeed, color: '#F47B12' },
        { label: 'From its pollen', count: data.asPollen.length === 1 ? '1 ' + c.one : num(data.asPollen.length) + ' ' + c.many, rows: data.asPollen, color: '#8DB52B' },
      ];
      dots.dataset.label = (f.u === 'in' ? 'Lengths' : 'Weights') + ' of the ' + c.many + ' grown from ' + f.n;
      const draw = () => drawDots(dots, groups, f.u === 'in' ? 'in' : 'lb');
      draw();
      if (window.ResizeObserver) {
        let w = dots.clientWidth, timer = null;
        const ro = new ResizeObserver(() => { if (Math.abs(dots.clientWidth - w) < 2) return; w = dots.clientWidth; clearTimeout(timer); timer = setTimeout(() => { if (document.body.contains(dots)) draw(); }, 120); });
        ro.observe(dots);
        disposers.push(() => ro.disconnect());
      }
    }
    const allBtn = app.querySelector('#allKids');
    if (allBtn) {
      allBtn.addEventListener('click', () => {
        const list = kidList(data);
        const open = allBtn.getAttribute('aria-expanded') === 'true';
        app.querySelector('#kidRows').innerHTML = (open ? list.slice(0, 6) : list).map(kidRow).join('');
        allBtn.setAttribute('aria-expanded', String(!open));
        allBtn.textContent = open ? 'See all ' + num(list.length) : 'Show only the heaviest six';
        app.querySelector('.kids h3').textContent = open ? 'The heaviest of them' : 'All ' + num(list.length) + ' of them';
      });
    }
    // Place at its weigh-off: the results only carry a rank among everything weighed that year,
    // so the place comes from sorting that weigh-off's own entries.
    const wo = app.querySelector('#woPlace');
    if (wo && f.st === 'placed') {
      api('results', { c: f.c, y: f.y }).then((res) => {
        if (seq !== routeSeq || !document.body.contains(wo)) return;
        const site = (res.rows || []).filter((r) => r.s === f.s && r.st === 'placed');
        if (!site.length) { wo.textContent = 'Placed'; return; }
        const place = site.filter((r) => r.w > f.w).length + 1;
        wo.textContent = ordinal(place) + ' of ' + num(site.length);
      }).catch(() => { wo.textContent = 'Placed'; });
    }
  }

  // ---------- Family trees ----------
  async function treesPage(params) {
    setNav('trees');
    setTitle('Family trees');
    const seq = routeSeq;
    const t = ui.trees;
    const q = (params.q || '').trim();
    loading();
    const [top, found, rec] = await Promise.all([
      api('top', { c: t.c, y: 'all', limit: 100, all: '0' }),
      q ? api('search', { q: q }) : Promise.resolve(null),
      api('top', { c: 'P', y: 'all', limit: 1 }),
    ]);
    if (seq !== routeSeq) return;
    // One match is the answer: go straight to its tree.
    if (found && found.rows.length === 1 && !params.stay) { location.replace('#/tree/' + found.rows[0].i); return; }
    const top1 = rec.rows[0];
    const data = await api('fruit', { id: top1.i, depth: 20 });
    await fontsReady;
    if (seq !== routeSeq) return;
    const rows = top.rows;
    const c = CLASS[t.c];
    app.innerHTML = '<div class="wrap page-head"><h1>Family trees</h1>' +
      '<p class="lead">Every pumpkin grew from a seed out of one pumpkin, and was pollinated by a plant grown from a seed out of another. Growers call those two its seed parent and its pollen parent. I call them its mother and father. Look up any pumpkin by name to see the family behind it.</p>' +
      '<form class="lookup" role="search" id="treeForm" style="max-width:640px"><label for="tq">Look up any pumpkin’s family</label><div class="row"><input id="tq" type="search" autocomplete="off" placeholder="Try 2365 Wolf 2021" value="' + esc(q) + '"><button class="btn" type="submit">Search</button></div>' +
      '<p class="mut small" style="margin-top:8px">A pumpkin’s name is its weight, its grower’s last name and its year. 2365 Wolf 2021 weighed 2,365 lb and Andy Wolf grew it in 2021.</p></form></div>' +
      (found ? '<section class="wrap" style="margin-top:28px">' + treeMatches(q, found) + '</section>' : '') +
      '<section class="wrap feature"><div id="featFan"></div><div class="side"><h2 style="font-size:28px">' + esc(top1.n) + '</h2>' +
        '<p>The heaviest pumpkin ever weighed, at ' + wTxt(top1) + '. ' + esc(grower(top1)) + ' grew it in ' + esc(placeLong(top1)) + ' in ' + top1.y + '. Its mother is on the left of the fan and its father on the right.</p>' +
        '<a class="btn" href="#/tree/' + top1.i + '">Open the full tree</a></div></section>' +
      '<section class="wrap sec"><h2>Parents of the heaviest</h2>' +
        '<p class="soft measure" style="margin-top:8px">The pumpkins that show up most often as a mother or father of the ' + rows.length + ' heaviest ' + esc(c.many) + ' of all time.</p>' +
        '<nav class="tabs" aria-label="Class">' + ORDER.map((k) => '<a href="#/trees" data-c="' + k + '"' + (k === t.c ? ' class="on" aria-current="true"' : '') + '>' + esc(CLASS[k].tab) + '</a>').join('') + '</nav>' +
        parentsTable(rows) + '</section>' +
      '<section class="wrap sec"><h2>The heaviest ' + esc(c.many) + ' and their trees</h2>' + treeTable(rows.slice(0, 10), true) + '<p class="tbl-note col-m">' + TABLE_NOTE + '</p></section>';
    app.querySelector('#treeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = app.querySelector('#tq').value.trim();
      const next = v ? '#/trees?q=' + encodeURIComponent(v) : '#/trees';
      if (location.hash === next) route(); else location.hash = next;
    });
    app.querySelectorAll('[data-c]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      t.c = a.dataset.c;
      const y = window.scrollY;
      treesPage(Object.assign({}, params, { stay: 1 })).then(() => window.scrollTo(0, y));
    }));
    const fan = Fan.create(app.querySelector('#featFan'), { gens: isPhone() ? 2 : 3, maxGens: 3, href: (i) => '#/tree/' + i, rootHref: (i) => '#/tree/' + i });
    fan.setData(data.nodes, top1.i);
    disposers.push(() => fan.destroy());
    onBreakpoint((phone) => fan.setGens(phone ? 2 : 3));
  }

  function treeMatches(q, found) {
    if (!found.rows.length) return '<p class="empty">Nothing on record matches “' + esc(q) + '”. Try a weight and a last name, like “2365 Wolf”.</p>';
    return '<h2 style="font-size:28px">' + (found.total === 1 ? 'One match' : num(found.total) + ' matches') + ' for “' + esc(q) + '”</h2>' + treeTable(found.rows, false) +
      (found.total > found.rows.length ? '<p class="tbl-note">These are the ' + found.rows.length + ' most recent of ' + num(found.total) + ' matches. Add a weight or a year to narrow it down.</p>' : '');
  }
  const treeLink = (id, name) => '<a href="#/tree/' + id + '" aria-label="Family tree of ' + esc(name) + '">Family tree</a>';
  function treeTable(rows, rank) {
    if (!rows.length) return '<p class="empty">Nothing on record.</p>';
    const isLen = rows[0].u === 'in';
    return '<table style="margin-top:12px"><thead><tr>' + (rank ? '<th><span class="sr">Rank</span></th>' : '') + '<th>Name</th><th class="col-m">Grower</th><th class="col-m">Mother</th><th class="col-m col-x">Father</th><th class="r">' + (isLen ? 'Length' : 'Weight') + '</th><th class="r"><span class="sr">Family tree</span></th></tr></thead><tbody>' +
      rows.map((f, i) => '<tr>' + (rank ? '<td class="w rank">' + (i + 1) + '</td>' : '') + '<td>' + fl(f) + tag(f) + '<span class="only-s">' + growerPlace(f) + '</span></td><td class="mut col-m">' + growerPlace(f) + '</td><td class="mut col-m">' + refHtml(f, 'm') + '</td><td class="mut col-m col-x">' + refHtml(f, 'f') + '</td><td class="r w">' + wTxt(f) + '</td><td class="r">' + treeLink(f.i, f.n) + '</td></tr>').join('') +
      '</tbody></table>';
  }
  // Count how often each linked pumpkin is a parent of the heaviest. Rows arrive heaviest first,
  // so the first child counted for a parent is its heaviest.
  function topParents(rows) {
    const byId = new Map(rows.map((f) => [f.i, f]));
    const tally = new Map();
    const add = (id, raw, side, child) => {
      if (id == null) return;
      let p = tally.get(id);
      if (!p) { p = { id: id, raw: raw, seed: 0, pollen: 0, best: child }; tally.set(id, p); }
      if ((raw || '').length > (p.raw || '').length) p.raw = raw;
      p[side] += 1;
    };
    rows.forEach((f) => {
      add(f.sid, f.sr, 'seed', f);
      if (f.pm !== 'self' && f.pid !== f.sid) add(f.pid, f.pr, 'pollen', f);
    });
    return Array.from(tally.values())
      .sort((a, b) => (b.seed + b.pollen) - (a.seed + a.pollen) || b.best.w - a.best.w)
      .slice(0, 12)
      .map((p) => Object.assign(p, { f: byId.get(p.id) || null }));
  }
  function parentsTable(rows) {
    const list = topParents(rows);
    if (!list.length) return '<p class="empty">No linked parents in this class yet.</p>';
    return '<table style="margin-top:4px"><thead><tr><th>Parent</th><th class="r">Children in the top ' + rows.length + '</th><th class="r col-m">As mother</th><th class="r col-m">As father</th><th class="col-m">Heaviest child</th><th class="r"><span class="sr">Family tree</span></th></tr></thead><tbody>' +
      list.map((p) => {
        const name = p.f ? p.f.n : p.raw;
        return '<tr><td><a class="nm" href="#/fruit/' + p.id + '">' + esc(name) + '</a><span class="only-s">' + p.seed + ' as mother · ' + p.pollen + ' as father</span></td>' +
          '<td class="r w">' + (p.seed + p.pollen) + '</td><td class="r col-m">' + p.seed + '</td><td class="r col-m">' + p.pollen + '</td>' +
          '<td class="mut col-m">' + fl(p.best, 'quiet') + ' · ' + wTxt(p.best) + '</td><td class="r">' + treeLink(p.id, name) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // ---------- Results by class and year ----------
  async function results(c, y) {
    setNav('results');
    loading();
    const seq = routeSeq;
    const meta = await api('meta');
    if (!meta.counts[c]) { notFound('That class'); return; }
    const cl = CLASS[c];
    const years = Object.keys(meta.counts[c].years).map(Number).sort((a, b) => b - a);
    const all = y === 'all';
    const year = all ? null : (Number(y) && meta.counts[c].years[Number(y)] ? Number(y) : years[0]);
    const data = all ? await api('top', { c: c, y: 'all', limit: 100, all: '0' }) : await api('results', { c: c, y: year });
    if (seq !== routeSeq) return;
    const rows = data.rows;
    const isLen = rows[0] && rows[0].u === 'in';
    setTitle(all ? 'The 100 heaviest ' + cl.many : year + ' ' + cl.one + ' results');
    // Place at each weigh-off, worked out from that weigh-off's own entries.
    const place = new Map();
    if (!all) {
      const bySite = new Map();
      rows.forEach((r) => { if (r.st !== 'placed') return; if (!bySite.has(r.s)) bySite.set(r.s, []); bySite.get(r.s).push(r); });
      bySite.forEach((list) => { list.sort((a, b) => b.w - a.w); list.forEach((r, i) => place.set(r.i, i > 0 && list[i - 1].w === r.w ? place.get(list[i - 1].i) : i + 1)); });
    }
    const sites = all ? 0 : new Set(rows.map((r) => r.s)).size;
    let shown = ui.shown;
    let filtered = rows;
    const rowHtml = (f) => '<tr><td class="w rank">' + (f.st === 'placed' ? esc(f.p) : '') + '</td><td>' + fl(f) + tag(f) + '<span class="only-s">' + growerPlace(f) + '</span>' + (all ? '' : '<span class="only-x">' + esc(f.s) + (place.has(f.i) ? ' · ' + ordinal(place.get(f.i)) + ' there' : '') + '</span>') + '</td><td class="mut col-m">' + growerPlace(f) + '</td>' +
      (all ? '<td class="col-m yr">' + f.y + '</td>' : '') + '<td class="mut col-m">' + refHtml(f, 'm') + '</td><td class="mut col-m">' + refHtml(f, 'f') + '</td>' +
      (all ? '' : '<td class="mut col-m col-x">' + esc(f.s) + (place.has(f.i) ? ' · ' + ordinal(place.get(f.i)) : '') + '</td>') + '<td class="r w">' + wTxt(f) + '</td></tr>';
    const tableHtml = () => {
      if (!filtered.length) return '<p class="empty">Nothing matches that filter.</p>';
      const part = filtered.slice(0, shown);
      return '<table style="margin-top:12px"><thead><tr><th title="Rank among everything weighed that year">Rank</th><th>' + esc(cl.title) + '</th><th class="col-m">Grower</th>' + (all ? '<th class="col-m">Year</th>' : '') + '<th class="col-m">Mother</th><th class="col-m">Father</th>' + (all ? '' : '<th class="col-m col-x">Weigh-off and place there</th>') + '<th class="r">' + (isLen ? 'Length' : 'Weight') + '</th></tr></thead><tbody>' + part.map(rowHtml).join('') + '</tbody></table>' +
        (filtered.length > shown ? '<div class="more"><button class="btn ghost" type="button" data-more="200">Show 200 more</button><button class="btn ghost" type="button" data-more="all">Show all ' + num(filtered.length) + '</button><span class="mut small">Showing ' + num(shown) + ' of ' + num(filtered.length) + '</span></div>' : '');
    };
    app.innerHTML = '<div class="wrap page-head"><h1>' + (all ? 'The 100 heaviest ' + esc(cl.many) + ' of all time' : year + ' ' + esc(cl.one) + ' results') + '</h1>' +
      '<p class="lead">' + (all ? 'The heaviest that placed at an official weigh-off since ' + years[years.length - 1] + '.' : num(rows.length) + ' ' + (rows.length === 1 ? cl.one : cl.many) + ' from ' + num(sites) + ' weigh-offs, the contests where growers bring their biggest to be weighed on a certified scale. The rank is among everything weighed that year. Each row also names the weigh-off and where the entry placed there.') + '</p>' +
      '<nav class="tabs" aria-label="Class">' + ORDER.filter((k) => meta.counts[k]).map((k) => '<a href="#/results/' + k + (all ? '/all' : meta.counts[k].years[year] ? '/' + year : '') + '"' + (k === c ? ' class="on" aria-current="page"' : '') + '>' + esc(CLASS[k].tab) + '</a>').join('') + '</nav>' +
      '<div class="tools"><div><label for="ys">Season</label><select id="ys"><option value="all"' + (all ? ' selected' : '') + '>All time, the 100 heaviest</option>' + years.map((v) => '<option value="' + v + '"' + (v === year ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></div>' +
      '<div class="grow"><label for="flt">Filter by grower, weigh-off or parent</label><input id="flt" type="search" autocomplete="off" placeholder="Try a last name"></div></div></div>' +
      '<section class="wrap" id="resTbl">' + tableHtml() + '</section>' +
      '<div class="wrap"><p class="tbl-note col-m">' + TABLE_NOTE + '</p></div>';
    const box = app.querySelector('#resTbl');
    app.querySelector('#ys').addEventListener('change', (e) => { location.hash = '#/results/' + c + '/' + e.target.value; });
    app.querySelector('#flt').addEventListener('input', (e) => {
      const t = e.target.value.toLowerCase().trim();
      filtered = !t ? rows : rows.filter((f) => (f.n + ' ' + f.g + ' ' + f.s + ' ' + f.sr + ' ' + f.pr + ' ' + (f.loc || []).join(' ')).toLowerCase().includes(t));
      shown = ui.shown;
      box.innerHTML = tableHtml();
    });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-more]');
      if (!b) return;
      shown = b.dataset.more === 'all' ? filtered.length : shown + 200;
      box.innerHTML = tableHtml();
    });
  }

  // ---------- Grower ----------
  async function growerPage(key) {
    setNav('');
    loading();
    const seq = routeSeq;
    const data = await api('grower', { k: key });
    if (seq !== routeSeq) return;
    if (data.error || !data.rows || !data.rows.length) { notFound('That grower'); return; }
    const name = String(data.name || '').replace(/\s*&\s*/g, ' and ');
    setTitle(name);
    const rows = data.rows;
    const best = rows.filter((f) => f.c === 'P' && f.st !== 'DMG').sort((a, b) => b.w - a.w)[0];
    const years = Array.from(new Set(rows.map((f) => f.y)));
    const y0 = Math.min.apply(null, years), y1 = Math.max.apply(null, years);
    const plantCell = (f) => {
      if (!f.pg || f.pg.k === 'self') return '<span class="mut">' + (f.pg ? 'Its own plant' : '') + '</span>';
      if (f.pg.st === 'one') { const z = rows.find((r) => r.i === f.pg.ids[0]); return (z ? fl(z, 'quiet') : '<a class="quiet" href="#/fruit/' + f.pg.ids[0] + '">see it</a>'); }
      if (f.pg.st === 'many') return 'One of ' + f.pg.ids.length;
      return '<span class="mut">' + (f.pg.st === 'same-seed' ? 'Self or sibling' : 'Not on record') + '</span>';
    };
    const loc = { loc: data.loc || rows[0].loc };
    app.innerHTML = '<div class="wrap page-head"><p class="crumbs" style="padding-top:0"><a href="#/results/P">Results</a> / Growers</p><h1 style="margin-top:8px">' + esc(name) + '</h1>' +
      '<p class="lead">' + (placeLong(loc) ? esc(placeLong(loc)) + '. ' : '') + num(rows.length) + (rows.length === 1 ? ' entry' : ' entries') + ' on record' + (y0 === y1 ? ' in ' + y0 : ', from ' + y0 + ' to ' + y1) + '.</p></div>' +
      '<section class="wrap sec" style="margin-top:40px"><dl class="stats three">' +
        '<div><dt>On record</dt><dd class="v">' + num(rows.length) + '</dd><dd>' + (y0 === y1 ? y0 : y0 + ' to ' + y1) + '</dd></div>' +
        (best ? '<div><dt>Heaviest pumpkin</dt><dd class="v">' + wTxt(best) + '</dd><dd>' + fl(best, 'quiet') + '</dd></div>' : '') +
        '<div><dt>Seasons</dt><dd class="v">' + num(years.length) + '</dd><dd>Years with at least one entry at a weigh-off</dd></div></dl></section>' +
      '<section class="wrap sec" style="margin-top:56px"><h2>Everything ' + esc(name) + ' weighed</h2>' +
        '<table style="margin-top:12px"><thead><tr><th>Year</th><th>Name</th><th class="col-m">Class</th><th class="col-m">Mother</th><th class="col-m">Father</th><th class="col-m col-x">What the father plant grew</th><th class="col-m col-x">Weigh-off</th><th class="r">Weight</th></tr></thead><tbody>' +
        rows.map((f) => '<tr><td class="yr">' + f.y + '</td><td>' + fl(f) + tag(f) + '<span class="only-s">' + esc((CLASS[f.c] || CLASS.P).title) + ' · ' + esc(f.s) + '</span></td><td class="mut col-m">' + esc((CLASS[f.c] || CLASS.P).title) + '</td><td class="mut col-m">' + refHtml(f, 'm') + '</td><td class="mut col-m">' + refHtml(f, 'f') + '</td><td class="mut col-m col-x">' + plantCell(f) + '</td><td class="mut col-m col-x">' + esc(f.s) + '</td><td class="r w">' + wTxt(f) + '</td></tr>').join('') +
        '</tbody></table><p class="tbl-note col-m">' + TABLE_NOTE + ' The father plant column is a strong guess: it’s the grower’s other entry that season from the same seed as the father. <a href="#/about">How that works</a>.</p></section>';
  }

  // ---------- Search ----------
  async function searchPage(q) {
    setNav('');
    setTitle('Search: ' + q);
    loading();
    const seq = routeSeq;
    const data = await api('search', { q: q });
    if (seq !== routeSeq) return;
    const rows = data.rows || [];
    const growers = new Map();
    rows.forEach((f) => { if (!growers.has(f.gk)) growers.set(f.gk, f); });
    app.innerHTML = '<div class="wrap page-head"><h1>Results for “' + esc(q) + '”</h1>' +
      '<p class="lead">' + (rows.length ? (data.total === 1 ? 'One match' : num(data.total || rows.length) + ' matches') + (data.total > rows.length ? '. These are the ' + rows.length + ' most recent, so add a weight or a year to narrow it down' : '') + '.' : 'Nothing on record matches. Try a weight and a last name, like “2365 Wolf”, or just a last name.') + '</p></div>' +
      (growers.size && growers.size <= 12 ? '<section class="wrap" style="margin-top:28px"><h2 style="font-size:24px">Growers</h2><p style="margin-top:8px">' + Array.from(growers.values()).map((f) => '<a href="#/grower/' + encodeURIComponent(f.gk) + '">' + esc(grower(f)) + '</a>' + (placeShort(f) ? ' <span class="mut">' + esc(placeShort(f)) + '</span>' : '')).join(' · ') + '</p></section>' : '') +
      (rows.length ? '<section class="wrap" style="margin-top:28px">' + treeTable(rows, false) + '<p class="tbl-note col-m">' + TABLE_NOTE + '</p></section>' : '');
  }

  // ---------- About ----------
  async function about() {
    setNav('about');
    setTitle('About the data');
    loading();
    const seq = routeSeq;
    const meta = await api('meta');
    if (seq !== routeSeq) return;
    const y0 = meta.years[0], y1 = meta.years[meta.years.length - 1];
    app.innerHTML = '<div class="wrap page-head"><h1>About the data</h1>' +
      '<p class="lead">I built The Main Vine to make one thing easy: seeing the family behind a giant pumpkin. Here’s where the results come from, how I link them into family trees, and where the links are only a guess.</p></div>' +
      '<div class="wrap prose">' +
      '<h2 id="weigh-offs">How weigh-offs work</h2>' +
      '<p>Every fall, growers bring their biggest pumpkins to contests called weigh-offs, where each one goes on a certified scale. The Great Pumpkin Commonwealth, the group that sets the rules, collects the results from every official weigh-off, and BigPumpkins.com publishes them as one public list.</p>' +
      '<p>Everything here comes from that list: ' + num(meta.count) + ' results from ' + y0 + ' to ' + y1 + '. The newest season is unofficial until the Commonwealth verifies it. Pumpkins that were damaged or shown for exhibition only don’t place, but I keep them and label them, because growers still plant their seeds.</p>' +
      '<p>Weigh-offs have classes for more than pumpkins. The pumpkins here are Atlantic Giants, the kind that passes a ton. There are also classes for squash, field pumpkins, watermelons, tomatoes, bushel gourds and marrows, all judged by weight, and long gourds, judged by length.</p>' +
      '<h2>What a pumpkin’s name means</h2>' +
      '<p>Growers name a pumpkin for its weight, its grower and its year. So <b>2365 Wolf 2021</b> weighed 2,365 lb, and Andy Wolf grew it in 2021. Seeds are sold and traded under the same name, so “a 2365 Wolf” also means a seed out of that pumpkin.</p>' +
      '<h2>Mother and father</h2>' +
      '<p>Growers save seeds from a big pumpkin and plant them, so every pumpkin has a mother: the pumpkin its seed came out of. Growers call her the seed parent.</p>' +
      '<p>A pumpkin flower has to be pollinated, and growers do that by hand with pollen from a plant they choose. That plant grew from a seed too, and the pumpkin that seed came out of is the father. Growers call him the pollen parent, or the pollinator. A pumpkin pollinated with its own plant’s pollen is self-pollinated. One left to the bees is open-pollinated, and its father isn’t known.</p>' +
      '<h2>How I match the names</h2>' +
      '<p>The results list each pumpkin’s parents as names that someone typed, like “2365 Wolf 2021” or just “2020 Patton”. I match each name to a weighed pumpkin on its weight, the grower’s last name and the year, and I allow for small typos and missing years.</p>' +
      '<ul><li>A name that fits exactly one pumpkin gets a link.</li>' +
      '<li>A name that fits more than one stays as typed, with a <span class="qm" aria-hidden="true" style="margin:0 2px">?</span> beside it. I don’t pick one. In a family tree it shows as a dark piece with the typed name and “Not sure which”.</li>' +
      '<li>A name I can’t find stays as typed with no link, and in a family tree it reads “Not on record”. That usually means it was grown before ' + y0 + ', it was never on an official scale, or it’s spelled in a way I can’t match. A parent the grower didn’t list at all also reads “Not on record”.</li></ul>' +
      '<h2>The father plant is a strong guess</h2>' +
      '<p>The father was harder. The results name the seed the father plant grew from, but they don’t say what that plant went on to grow. So for every pumpkin I look at the same grower’s other entries that season. If exactly one of them grew from that seed, it’s almost certainly the father plant, and the pumpkin’s page shows it under “What the father plant grew”.</p>' +
      '<p>If the grower had two or more plants from that seed, I list them all and say I can’t tell which one it was. If there’s none on record, either that plant didn’t grow a pumpkin that got weighed, or the pollen came from another grower’s plant.</p>' +
      '<p>This assumes growers use pollen from their own patch, which is the usual practice. Borrowed pollen, plants nobody recorded and typos can all make the guess wrong, so treat it as a strong hint.</p>' +
      '<h2>Reading the family tree</h2>' +
      '<p>The tree is a fan. The pumpkin sits at the center, its two parents are in the first ring, its four grandparents in the second, and so on outward. Orange is a mother and green is a father, and a deeper color means a heavier pumpkin. A dot marks a pumpkin that fills more than one place in the tree, which happens a lot, because growers keep crossing back to the ones that grew big.</p>' +
      '<p>The fan stops at five generations, or four on a phone, because the outer ring gets too crowded to read. Click any pumpkin to put it at the center and keep going back. Under every tree there’s a link that reads the same ancestors out as a plain list.</p>' +
      '<p>The numbers on a pumpkin’s page are the ones growers look at. OTT, short for over the top, is three tape measurements added together: around the pumpkin, over it side to side and over it end to end. A chart turns that total into a predicted weight, and “compared with its size” says how far the scale beat the chart.</p>' +
      '<h2>What’s covered</h2>' +
      '<table><thead><tr><th>Class</th><th class="r">Results</th><th>Years</th></tr></thead><tbody>' +
      ORDER.filter((c) => meta.counts[c]).map((c) => { const ys = Object.keys(meta.counts[c].years).map(Number); return '<tr><td><a href="#/results/' + c + '">' + esc(CLASS[c].tab) + '</a></td><td class="r w">' + num(meta.counts[c].total) + '</td><td class="mut">' + Math.min.apply(null, ys) + ' to ' + Math.max.apply(null, ys) + '</td></tr>'; }).join('') +
      '</tbody></table>' +
      '<h2>Credits</h2>' +
      '<p>Results: the Great Pumpkin Commonwealth’s weigh-off results as published on <a href="https://www.bigpumpkins.com" target="_blank" rel="noopener">BigPumpkins.com</a>. This site isn’t affiliated with the Commonwealth or with BigPumpkins.com.</p>' +
      '<p>Photos: where a pumpkin has a photo, it comes from Wikimedia Commons under a Creative Commons license. The photographer, the license and a link to the source sit beside each one.</p>' +
      '</div>';
  }

  // ---------- Router ----------
  function parseHash() {
    const raw = location.hash || '#/';
    const i = raw.indexOf('?');
    const path = i > -1 ? raw.slice(0, i) : raw;
    const params = Object.fromEntries(new URLSearchParams(i > -1 ? raw.slice(i + 1) : '').entries());
    return { path: path, params: params };
  }
  async function route() {
    const { path, params } = parseHash();
    const seq = ++routeSeq;
    closeMenu();
    let m;
    try {
      if ((m = path.match(/^#\/(fruit|tree)\/(\d+)$/))) { await fruitPage(Number(m[2]), { toTree: m[1] === 'tree' }); return; }
      pendingPick = null;
      if (path === '#/trees') await treesPage(params);
      else if ((m = path.match(/^#\/results\/([A-Z])(?:\/(\d{4}|all))?$/))) await results(m[1], m[2]);
      else if ((m = path.match(/^#\/grower\/(.+)$/))) await growerPage(decodeURIComponent(m[1]));
      else if ((m = path.match(/^#\/search\/(.+)$/))) await searchPage(decodeURIComponent(m[1]));
      else if (path === '#/about') await about();
      else await home();
      if (seq !== routeSeq) return;
      if (!params.stay) window.scrollTo(0, 0);
    } catch (e) {
      if (seq === routeSeq) fail(e);
    }
  }

  // Header: search and the phone menu
  const menu = document.getElementById('menu');
  const menuBtn = document.getElementById('menuBtn');
  function closeMenu() { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { closeMenu(); menuBtn.focus(); } });
  const goSearch = (input) => (e) => {
    e.preventDefault();
    const q = document.getElementById(input).value.trim();
    if (!q) return;
    closeMenu();
    location.hash = '#/search/' + encodeURIComponent(q);
  };
  document.getElementById('searchForm').addEventListener('submit', goSearch('q'));
  document.getElementById('menuSearch').addEventListener('submit', goSearch('mq'));
  // The skip link moves focus without touching the hash, which the router owns.
  document.querySelector('.skip').addEventListener('click', (e) => { e.preventDefault(); const m = document.getElementById('app'); m.focus(); m.scrollIntoView(); });
  window.addEventListener('hashchange', route);
  route();
})();
