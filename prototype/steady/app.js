/* Steady: a first crypto purchase inside an everyday money app.
   Concept prototype. Prices, balances and addresses are examples. */
(function () {
  "use strict";

  var BALANCE = 2418.36; var START_BALANCE = BALANCE;
  var FEE_RATE = 0.0149;
  var LOCK_SECONDS = 30;

  var COINS = {
    btc: { id: "btc", name: "Bitcoin", sym: "BTC", price: 96840.0, change: 1.2, letter: "B", dp: 8 },
    eth: { id: "eth", name: "Ethereum", sym: "ETH", price: 3512.4, change: -0.8, letter: "E", dp: 6 },
    usdc: { id: "usdc", name: "USDC", sym: "USDC", price: 1.0, change: 0, letter: "U", dp: 2, note: "Stablecoin, stays near $1.00" }
  };

  var SAVED_ADDR = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
  var LOOKALIKE = "bc1qxy2kg9fq3vtd8cw7m4sp6e5nhr0aj2ulzx0wlh";

  var state = {
    screen: "home",
    coin: "btc",
    amount: "",
    lock: LOCK_SECONDS,
    expired: false,
    sheet: false,
    limit: true,
    range: "1W",
    pasted: "",
    sendTo: "",
    toast: "",
    frozen: false
  };

  /* Each frame is one screen in one state. The screen map, screenshots
     and the Figma import all use this list. */
  var FRAMES = [
    { id: "home", title: "Home", set: {}, note: "Crypto sits inside the money app people already use, as one tile on Home. The tile leads with the smallest amount you can buy, because cost is the first worry." },
    { id: "intro", title: "Before your first buy", set: { screen: "intro" }, note: "Four facts, shown once before the first purchase, in plain words. Risk comes first, not last. The disclosure sits next to the button instead of behind a link." },
    { id: "choose", title: "Choose", set: { screen: "choose" }, note: "Three assets, not three hundred. The stablecoin gets one line of explanation, since \"USDC\" means nothing to a first-time buyer." },
    { id: "amount", title: "Amount", set: { screen: "amount", amount: "" }, note: "Dollars first, crypto second. People think in what they spend, so the coin amount is the secondary line." },
    { id: "amount-filled", title: "Amount entered", set: { screen: "amount", amount: "25" }, note: "Preset chips cover most first buys, so a new user can get through with two taps. The live conversion updates as you type." },
    { id: "amount-over", title: "More than balance", set: { screen: "amount", amount: "3000" }, note: "Going over your balance is caught on the keypad, with the fix right there. You never hit Review just to be told no." },
    { id: "review", title: "Review", set: { screen: "review", amount: "25", lock: 24 }, note: "The price is held for 30 seconds with a visible countdown. The fee is shown in dollars and as a percent before Face ID, never after." },
    { id: "review-faceid", title: "Confirm", set: { screen: "review", amount: "25", lock: 19, sheet: true }, note: "Face ID confirms the exact total. The sheet repeats the number so the last thing you see before paying is what you pay." },
    { id: "review-expired", title: "Price expired", set: { screen: "review", amount: "25", lock: 0, expired: true }, note: "When the hold runs out, nothing changes silently. You see the new price and what it does to your order before you refresh." },
    { id: "success", title: "Bought", set: { screen: "success", amount: "25" }, note: "Confirms what you own in both units and where it lives. The next step is looking at it, not buying more." },
    { id: "holding", title: "Your Bitcoin", set: { screen: "holding", amount: "25" }, note: "Gain or loss is measured against what you paid, not the 24-hour move, because that's the question a first-time owner actually has." },
    { id: "send-address", title: "Send to a wallet", set: { screen: "send-address", amount: "25" }, note: "From my years on a self-custody wallet: most losses start with a paste. This flow assumes the clipboard can lie." },
    { id: "send-pasted", title: "Address pasted", set: { screen: "send-address", amount: "25", pasted: LOOKALIKE }, note: "The pasted address looks right at a glance: same start, same end. That's exactly why the next screen exists." },
    { id: "send-check", title: "Check address", set: { screen: "send-check", amount: "25", pasted: LOOKALIKE }, note: "Address poisoning: a scammer sends a tiny deposit from a look-alike address so it shows up in your history. Steady compares every paste with saved addresses and shows exactly where they differ." },
    { id: "send-test", title: "Test send", set: { screen: "send-test", amount: "25", sendTo: SAVED_ADDR }, note: "Crypto sends can't be reversed, so a $1 test is offered the first time you send to an address." },
    { id: "sent", title: "Test sent", set: { screen: "sent", amount: "25", sendTo: SAVED_ADDR }, note: "Sets the expectation for how long it takes and says you'll be told when it lands, so nobody refreshes in a panic." }
  ];

  /* ---------- helpers ---------- */
  function money(n) {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function moneyShort(n) {
    var s = n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return "$" + s;
  }
  function amountNum() { return parseFloat(state.amount || "0") || 0; }
  function coin() { return COINS[state.coin]; }
  function coinQty(usd) {
    var c = coin();
    return (usd / c.price).toFixed(c.dp);
  }
  function fee(usd) { return Math.round(usd * FEE_RATE * 100) / 100; }
  function shortAddr(a) { return a.slice(0, 8) + "…" + a.slice(-6); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------- icons (20px stroke) ---------- */
  function icon(name, size) {
    size = size || 20;
    var p = {
      back: '<path d="M15 18l-6-6 6-6"/>',
      close: '<path d="M18 6L6 18M6 6l12 12"/>',
      chev: '<path d="M9 18l6-6-6-6"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      send: '<path d="M7 17L17 7M8 7h9v9"/>',
      pay: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
      card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 15h4"/>',
      home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
      chart: '<path d="M4 19h16M6 15l4-4 3 3 5-6"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
      wave: '<path d="M3 17l5-6 4 4 5-7 4 5"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
      seed: '<path d="M12 21v-8"/><path d="M12 13c0-4 3-7 7-7 0 4-3 7-7 7z"/><path d="M12 15c0-3-2-5-5-5 0 3 2 5 5 5z"/>',
      lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
      alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17h.01"/>',
      check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
      del: '<path d="M21 6H8l-5 6 5 6h13z"/><path d="M12 10l4 4M16 10l-4 4"/>',
      paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9z"/>',
      qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
      wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M16 13h2M3 10h18"/>',
      shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
      savings: '<path d="M4 10h16v10H4zM2 10l10-6 10 6"/><path d="M8 14v3M12 14v3M16 14v3"/>',
      face: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M9 9v1.5M15 9v1.5M12 9v4h-1M9.5 16c1.5 1 3.5 1 5 0"/>'
    }[name] || "";
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>";
  }

  function statusBar() {
    return '<div class="status"><span>9:41</span><span class="status-icons">' +
      '<svg width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor"/><rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor"/><rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor"/></svg>' +
      '<svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true"><path d="M8 11.5l2.4-2.9a3.6 3.6 0 0 0-4.8 0zM3.6 6.4a6.6 6.6 0 0 1 8.8 0l1.4-1.7a8.8 8.8 0 0 0-11.6 0zM.3 2.6a11.6 11.6 0 0 1 15.4 0L17 1A13.6 13.6 0 0 0-1 1z" fill="currentColor"/></svg>' +
      '<svg width="27" height="13" viewBox="0 0 27 13" aria-hidden="true"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="18" height="9" rx="2" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.5-1.1 1.5-2s-.7-1.7-1.5-2z" fill="currentColor" opacity=".4"/></svg>' +
      "</span></div>";
  }

  function nav(title, opts) {
    opts = opts || {};
    var left = opts.back ? '<button class="icon-btn" data-go="' + opts.back + '" aria-label="Back">' + icon("back", 24) + "</button>" : "<span></span>";
    var right = opts.close ? '<button class="icon-btn" data-go="' + opts.close + '" aria-label="Close">' + icon("close", 22) + "</button>" : "<span></span>";
    return '<div class="nav">' + left + '<div class="nav-title">' + esc(title || "") + "</div>" + right + "</div>";
  }

  function coinBadge(c, small) {
    return '<span class="coin ' + c.id + (small ? " sm" : "") + '" aria-hidden="true">' + c.letter + "</span>";
  }

  function tabbar(active) {
    var tabs = [["home", "Home", "home"], ["card", "Card", "card"], ["crypto", "Crypto", "chart"], ["account", "Account", "user"]];
    return '<div class="tabbar">' + tabs.map(function (t) {
      return '<span class="' + (t[0] === active ? "on" : "") + '">' + icon(t[2], 24) + t[1] + "</span>";
    }).join("") + "</div>";
  }

  /* ---------- screens ---------- */
  var views = {};

  views.home = function () {
    return statusBar() +
      '<div class="body">' +
        '<div class="greet"><div><div class="label" style="margin:0">Good morning</div><div class="h2" style="margin:0">Sam</div></div><div class="avatar">SR</div></div>' +
        '<div class="card balance-card">' +
          '<div class="label">Checking ••4821</div>' +
          '<div class="money-xl" style="font-size:36px;line-height:44px">' + money(BALANCE) + "</div>" +
          '<div class="quick">' +
            '<span><i>' + icon("plus") + "</i>Add</span>" +
            '<span><i>' + icon("send") + "</i>Send</span>" +
            '<span><i>' + icon("pay") + "</i>Pay</span>" +
            '<span><i>' + icon("savings") + "</i>Save</span>" +
          "</div>" +
        "</div>" +
        '<div class="section-title">New in Steady</div>' +
        '<button class="tile" data-go="intro">' +
          '<span class="facts" style="margin:0"><span class="ico">' + icon("wave") + "</span></span>" +
          '<span class="row-main"><span class="row-title">Crypto<span class="new">New</span></span><span class="row-sub" style="display:block">Buy Bitcoin and more, starting at $1</span></span>' +
          '<span class="chev">' + icon("chev") + "</span>" +
        "</button>" +
        '<div class="section-title">Recent</div>' +
        '<div class="list">' +
          activity("Grocery store", "Today", "−$64.12") +
          activity("Paycheck", "Fri", "+$1,240.00", true) +
          activity("Gas station", "Thu", "−$38.50") +
          activity("Phone bill", "Wed", "−$45.00") +
        "</div>" +
      "</div>" +
      tabbar("home") + '<div class="home-indicator" style="background:var(--surface)"><span></span></div>';
  };

  function activity(title, when, amt, up) {
    return '<div class="row" style="cursor:default"><span class="row-main"><span class="row-title" style="display:block">' + title + '</span><span class="row-sub" style="display:block">' + when + '</span></span><span class="row-end' + (up ? " up" : "") + '">' + amt + "</span></div>";
  }

  views.intro = function () {
    return statusBar() + nav("", { close: "home" }) +
      '<div class="body">' +
        '<h1 class="h1">Before your first buy</h1>' +
        '<p class="lead">Four things worth knowing. We\'ll only show this once.</p>' +
        '<ul class="facts">' +
          fact("wave", "Prices move a lot", "Crypto can lose value fast. Only buy an amount you'd be OK seeing drop.") +
          fact("clock", "Sell anytime", "Sell back to Checking any day, any hour. The money shows up right away.") +
          fact("receipt", "Fees shown before you pay", "You'll see the exact price and fee in dollars before you confirm.") +
          fact("seed", "Start small", "You can buy as little as $1. Most people start with $10 to $25.") +
        "</ul>" +
      "</div>" +
      '<div class="footer">' +
        '<button class="btn" data-go="choose">Continue</button>' +
        '<p class="fine center" style="margin-top:10px">Crypto is not a bank deposit, is not FDIC insured, and may lose value. Provided by a licensed partner.</p>' +
      "</div>" +
      '<div class="home-indicator"><span></span></div>';
  };

  function fact(ic, title, text) {
    return '<li><span class="ico">' + icon(ic) + '</span><span><b>' + title + "</b><p>" + text + "</p></span></li>";
  }

  views.choose = function () {
    return statusBar() + nav("Buy crypto", { back: "intro" }) +
      '<div class="body">' +
        '<h2 class="h2" style="margin-top:8px">What do you want to buy?</h2>' +
        '<p class="lead" style="margin-bottom:16px">You can switch or sell later.</p>' +
        '<div class="list">' +
          ["btc", "eth", "usdc"].map(function (id) {
            var c = COINS[id];
            var sub = c.note || c.sym;
            var ch = c.change === 0 ? '<span class="row-sub" style="display:block">0.0%</span>' :
              '<span class="row-sub ' + (c.change > 0 ? "up" : "down") + '" style="display:block">' + (c.change > 0 ? "+" : "−") + Math.abs(c.change).toFixed(1) + "% today</span>";
            return '<button class="row" data-coin="' + id + '">' + coinBadge(c) +
              '<span class="row-main"><span class="row-title" style="display:block">' + c.name + '</span><span class="row-sub" style="display:block">' + sub + "</span></span>" +
              '<span class="row-end">' + money(c.price) + ch + "</span></button>";
          }).join("") +
        "</div>" +
        '<p class="fine" style="margin-top:14px">Prices update every few seconds. You\'ll lock a price on the next step.</p>' +
      "</div>" + '<div class="home-indicator"><span></span></div>';
  };

  views.amount = function () {
    var c = coin();
    var n = amountNum();
    var over = n + fee(n) > BALANCE;
    var valid = n >= 1 && !over;
    var display = state.amount === "" ? "$0" : "$" + Number(state.amount.split(".")[0]).toLocaleString("en-US") + (state.amount.indexOf(".") > -1 ? "." + state.amount.split(".")[1] : "");
    var sub = over
      ? '<span class="down">More than your Checking balance</span>'
      : (n > 0 ? "≈ " + coinQty(n) + " " + c.sym : "Minimum $1");
    var chips = [10, 25, 50].map(function (v) {
      return '<button class="chip" data-chip="' + v + '" aria-pressed="' + (state.amount === String(v)) + '">$' + v + "</button>";
    }).join("");
    var keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"].map(function (k) {
      return '<button class="key" data-key="' + k + '" aria-label="' + (k === "del" ? "Delete" : k) + '">' + (k === "del" ? icon("del", 26) : k) + "</button>";
    }).join("");
    var cta = over
      ? '<button class="btn" data-go="move-savings">Move ' + money(Math.ceil((n + fee(n) - BALANCE) * 100) / 100) + " from Savings</button>"
      : '<button class="btn" data-go="review"' + (valid ? "" : " disabled") + ">Review</button>";
    return statusBar() + nav("Buy " + c.name, { back: "choose" }) +
      '<div class="body" style="display:flex;flex-direction:column;padding-bottom:0">' +
        '<div class="amount-head">' + coinBadge(c, true) + "1 " + c.sym + " = " + money(c.price) + "</div>" +
        '<div class="amount-value' + (state.amount === "" ? " placeholder" : "") + (over ? " down" : "") + '">' + display + "</div>" +
        '<div class="amount-sub">' + sub + "</div>" +
        '<div class="chips">' + chips + "</div>" +
        '<div style="flex:1"></div>' +
        '<div class="from"><span>Pay from <b>Checking ••4821</b></span><span>' + money(BALANCE) + "</span></div>" +
        '<div class="keypad">' + keys + "</div>" +
      "</div>" +
      '<div class="footer" style="padding-top:8px">' + cta + "</div>" + '<div class="home-indicator"><span></span></div>';
  };

  views.review = function () {
    var c = coin();
    var n = amountNum();
    var f = fee(n);
    var price = state.expired ? c.price * 1.0012 : c.price;
    var qty = ((n) / price).toFixed(c.dp);
    var mm = "0:" + String(Math.max(0, state.lock)).padStart(2, "0");
    var lockRow = state.expired
      ? '<div class="lock"><span>' + icon("clock", 16) + ' Price hold ended</span><span class="down">Expired</span></div>'
      : '<div class="lock"><span style="display:flex;gap:6px;align-items:center">' + icon("lock", 16) + 'Price held for you</span><span id="lock-time">' + mm + "</span></div>";
    var bar = '<div class="lock-bar"><span id="lock-bar" style="width:' + (state.expired ? 0 : (state.lock / LOCK_SECONDS) * 100) + '%"></span></div>';
    var expiredNote = state.expired
      ? '<div class="notice" style="margin-bottom:12px">' + icon("info") + "<span>The price moved to " + money(price) + ". Your " + money(n) + " now buys " + qty + " " + c.sym + ", about " + money(n - (n / price) * c.price) + " less than before. Nothing was charged.</span></div>"
      : "";
    var cta = state.expired
      ? '<button class="btn" data-action="refresh">Get a new price</button>'
      : '<button class="btn" data-action="confirm">Buy ' + money(n + f) + "</button>";
    var html = statusBar() + nav("Review", { back: "amount" }) +
      '<div class="body">' +
        lockRow + bar + expiredNote +
        '<div class="card">' +
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">' + coinBadge(c) + '<div><div class="row-title">' + qty + " " + c.sym + '</div><div class="row-sub">' + c.name + "</div></div></div>" +
          "<dl style=\"margin:0\">" +
            '<div class="kv"><dt>' + c.name + ' price</dt><dd>' + money(price) + "</dd></div>" +
            '<div class="kv"><dt>Amount</dt><dd>' + money(n) + "</dd></div>" +
            '<div class="kv"><dt>Fee (1.49%)</dt><dd>' + money(f) + "</dd></div>" +
            '<div class="kv total"><dt>Total from Checking</dt><dd>' + money(n + f) + "</dd></div>" +
          "</dl>" +
        "</div>" +
        '<div class="card"><div class="switch-row"><div><div class="row-title">Monthly crypto limit</div><div class="row-sub">Cap buys at $100 a month. Change it anytime.</div></div>' +
          '<button class="switch" role="switch" data-action="limit" aria-checked="' + state.limit + '" aria-label="Monthly crypto limit"><span class="knob"></span></button></div></div>' +
        '<div class="notice calm" style="margin-top:12px">' + icon("info") + "<span>This is your first crypto buy. You can sell anytime, but the price can drop below what you paid.</span></div>" +
      "</div>" +
      '<div class="footer">' + cta + "</div>" + '<div class="home-indicator"><span></span></div>';
    if (state.sheet) {
      html += '<div class="sheet-backdrop" data-action="sheet-close"><div class="sheet" role="dialog" aria-label="Confirm with Face ID">' +
        '<div class="grab"></div>' +
        '<div class="center"><div class="label" style="margin:0">Buy ' + qty + " " + c.sym + '</div><div class="money-xl" style="font-size:34px;line-height:42px">' + money(n + f) + "</div></div>" +
        '<div class="faceid">' + icon("face", 56) + '<span class="label" style="margin:0">Confirm with Face ID</span></div>' +
        '<button class="btn ghost" data-action="faceid-done">Simulate Face ID</button>' +
      "</div></div>";
    }
    return html;
  };

  views.success = function () {
    var c = coin();
    var n = amountNum();
    return statusBar() + nav("", { close: "home" }) +
      '<div class="body">' +
        '<div class="done-mark">' + icon("check", 32) + "</div>" +
        '<h1 class="h1 center">You own ' + c.name + "</h1>" +
        '<p class="lead center">' + coinQty(n) + " " + c.sym + " is in your Crypto account. You can sell it back to Checking anytime.</p>" +
        '<div class="card"><dl style="margin:0">' +
          '<div class="kv"><dt>Paid</dt><dd>' + money(n + fee(n)) + "</dd></div>" +
          '<div class="kv"><dt>Price</dt><dd>' + money(c.price) + "</dd></div>" +
          '<div class="kv"><dt>Fee</dt><dd>' + money(fee(n)) + "</dd></div>" +
          '<div class="kv"><dt>Monthly limit</dt><dd>' + (state.limit ? "$100, $" + (100 - n).toFixed(0) + " left" : "Off") + "</dd></div>" +
        "</dl></div>" +
      "</div>" +
      '<div class="footer"><button class="btn" data-go="holding">See your ' + c.name + '</button><button class="btn ghost" data-go="home" data-toast="' + c.name + ' added to Crypto">Done</button></div>' +
      '<div class="home-indicator"><span></span></div>';
  };

  function chartPath(seed, range) {
    var pts = { "1D": 40, "1W": 48, "1M": 60, "1Y": 72, "All": 80 }[range] || 48;
    var s = seed + pts;
    function rnd() { s = (s * 9301 + 49297) % 233280; return s / 233280; }
    var y = 0, v = 0, arr = [];
    for (var i = 0; i < pts; i++) { v = 0.55 * v + (rnd() - 0.5) * 6; y += v; arr.push(y); }
    var min = Math.min.apply(null, arr), max = Math.max.apply(null, arr);
    arr = arr.map(function (x) { return 24 + ((x - min) / (max - min || 1)) * 96; });
    /* bought 75% of the way along; bend the tail so it ends a little below that price */
    var idx = Math.floor(pts * 0.75), end = pts - 1;
    var paid = arr[idx], target = Math.min(132, paid + 9), shift = target - arr[end];
    for (var k = idx + 1; k <= end; k++) arr[k] += shift * ((k - idx) / (end - idx));
    var w = 342;
    var d = arr.map(function (x, i) { return (i === 0 ? "M" : "L") + ((i / (pts - 1)) * w).toFixed(1) + " " + x.toFixed(1); }).join(" ");
    return { d: d, last: arr[end], paid: paid, w: w };
  }

  views.holding = function () {
    var c = coin();
    var n = amountNum();
    var qty = parseFloat(coinQty(n));
    var now = c.price * 0.99;
    var val = qty * now;
    var paid = n + fee(n);
    var diff = val - paid;
    var ch = chartPath(7, state.range);
    var ranges = ["1D", "1W", "1M", "1Y", "All"].map(function (r) {
      return '<button data-range="' + r + '" aria-pressed="' + (state.range === r) + '">' + r + "</button>";
    }).join("");
    return statusBar() + nav(c.name, { back: "success" }) +
      '<div class="body">' +
        '<div class="label" style="margin-top:4px">Your ' + c.name + "</div>" +
        '<div class="money-xl">' + money(val) + "</div>" +
        '<div class="row-sub ' + (diff >= 0 ? "up" : "down") + '" style="font-size:15px">' + (diff >= 0 ? "+" : "−") + money(Math.abs(diff)) + " since you bought, fee included</div>" +
        '<svg class="chart" viewBox="0 0 350 150" aria-label="Price chart, ' + state.range + '">' +
          '<line x1="0" x2="350" y1="' + ch.paid.toFixed(1) + '" y2="' + ch.paid.toFixed(1) + '" stroke="var(--text-3)" stroke-dasharray="3 4"/>' +
          '<text x="0" y="' + (ch.paid - 5).toFixed(1) + '">You paid</text>' +
          '<path d="' + ch.d + '" fill="none" stroke="var(--brand)" stroke-width="2"/>' +
          '<circle cx="' + ch.w + '" cy="' + ch.last.toFixed(1) + '" r="4" fill="var(--brand)"/>' +
        "</svg>" +
        '<div class="ranges">' + ranges + "</div>" +
        '<div class="card"><dl style="margin:0">' +
          '<div class="kv"><dt>You own</dt><dd>' + qty.toFixed(c.dp) + " " + c.sym + "</dd></div>" +
          '<div class="kv"><dt>You paid</dt><dd>' + money(paid) + "</dd></div>" +
          '<div class="kv"><dt>Price now</dt><dd>' + money(now) + "</dd></div>" +
        "</dl></div>" +
        '<div class="two" style="margin-top:12px"><button class="btn" data-go="amount" data-amount="">Buy more</button><button class="btn secondary" data-toast="Selling isn\'t part of this prototype">Sell</button></div>' +
        '<div class="list" style="margin-top:12px"><button class="row" data-go="send-address">' +
          '<span class="facts" style="margin:0"><span class="ico">' + icon("wallet") + "</span></span>" +
          '<span class="row-main"><span class="row-title" style="display:block">Move to your own wallet</span><span class="row-sub" style="display:block">Send to a wallet only you control</span></span>' +
          '<span class="chev">' + icon("chev") + "</span></button></div>" +
      "</div>" + '<div class="home-indicator"><span></span></div>';
  };

  views["send-address"] = function () {
    var filled = !!state.pasted;
    return statusBar() + nav("Send " + coin().name, { back: "holding" }) +
      '<div class="body">' +
        '<div class="field"><label for="to">To</label><div class="mono" id="to">' + (filled ? esc(state.pasted) : '<span style="color:var(--text-3)">Wallet address</span>') + "</div></div>" +
        '<div class="two" style="margin-top:8px">' +
          '<button class="btn secondary" data-action="paste" style="height:44px;font-size:15px;display:flex;gap:8px;justify-content:center;align-items:center">' + icon("paste", 18) + "Paste</button>" +
          '<button class="btn secondary" data-toast="Camera isn\'t part of this prototype" style="height:44px;font-size:15px;display:flex;gap:8px;justify-content:center;align-items:center">' + icon("qr", 18) + "Scan QR</button>" +
        "</div>" +
        '<div class="section-title">Saved</div>' +
        '<div class="list"><button class="row" data-action="use-saved">' +
          '<span class="facts" style="margin:0"><span class="ico">' + icon("shield") + "</span></span>" +
          '<span class="row-main"><span class="row-title" style="display:block">My hardware wallet</span><span class="row-sub" style="display:block;font-family:\'Geist Mono\',ui-monospace,monospace">' + shortAddr(SAVED_ADDR) + "</span></span>" +
          '<span class="chev">' + icon("chev") + "</span></button></div>" +
        '<div class="section-title">Recent activity</div>' +
        '<div class="list"><div class="row" style="cursor:default">' +
          '<span class="row-main"><span class="row-title" style="display:block">Received 0.00000546 BTC</span><span class="row-sub" style="display:block;font-family:\'Geist Mono\',ui-monospace,monospace">From ' + shortAddr(LOOKALIKE) + " · Yesterday</span></span></div></div>" +
      "</div>" +
      '<div class="footer"><button class="btn" data-go="send-check"' + (filled ? "" : " disabled") + ">Continue</button></div>" + '<div class="home-indicator"><span></span></div>';
  };

  function chunks(a, ref) {
    var out = [];
    for (var i = 0; i < a.length; i += 4) {
      var g = a.slice(i, i + 4), html = "";
      for (var j = 0; j < g.length; j++) {
        var ch = g[j];
        html += ref && ref[i + j] !== ch ? "<b>" + ch + "</b>" : ch;
      }
      out.push(html);
    }
    return out.join(" ");
  }

  views["send-check"] = function () {
    var a = state.pasted || LOOKALIKE;
    var poisoned = a !== SAVED_ADDR;
    return statusBar() + nav("Check the address", { back: "send-address" }) +
      '<div class="body">' +
        (poisoned
          ? '<div class="notice danger" style="margin-top:4px">' + icon("alert") + "<span><b>This doesn't match your saved wallet.</b> The start and end are the same, but the middle is different. It came from a tiny deposit yesterday, a common scam called address poisoning.</span></div>"
          : '<div class="notice calm" style="margin-top:4px">' + icon("shield") + "<span>Matches your saved address, My hardware wallet.</span></div>") +
        '<div class="compare" style="margin-top:16px">' +
          '<div><span class="label">Pasted address</span>' + chunks(a, poisoned ? SAVED_ADDR : null) + "</div>" +
          (poisoned ? '<div><span class="label">My hardware wallet, saved Oct 12</span><span class="same">' + chunks(SAVED_ADDR) + "</span></div>" : "") +
        "</div>" +
        '<p class="fine" style="margin-top:12px">Differences are marked in red. Always check the whole address against your wallet app, not just the first and last few characters.</p>' +
      "</div>" +
      '<div class="footer">' +
        (poisoned
          ? '<button class="btn" data-action="use-saved">Send to my saved wallet</button><button class="btn ghost" data-action="clear-paste">Enter a different address</button>'
          : '<button class="btn" data-go="send-test">Continue</button>') +
      "</div>" + '<div class="home-indicator"><span></span></div>';
  };

  function step(n, text, color) {
    return '<li' + (color ? ' style="color:' + color + '"' : "") + '><span class="num">' + n + "</span><span>" + text + "</span></li>";
  }

  views["send-test"] = function () {
    var c = coin();
    var n = amountNum();
    var qty = coinQty(n);
    return statusBar() + nav("Send " + c.name, { back: "send-address" }) +
      '<div class="body">' +
        '<h1 class="h1">Send $1 first?</h1>' +
        '<p class="lead">You haven\'t sent to this wallet from Steady before. Crypto sends can\'t be undone, so a small test is the safest way to start.</p>' +
        '<div class="card"><ol class="steps">' +
          step(1, "We send $1.00 of " + c.name + " to My hardware wallet.") +
          step(2, "You check that it shows up there.") +
          step(3, "Come back and send the rest. We'll remind you.") +
        "</ol></div>" +
        '<div class="card"><dl style="margin:0">' +
          '<div class="kv"><dt>To</dt><dd style="font-family:\'Geist Mono\',ui-monospace,monospace;font-size:14px">' + shortAddr(SAVED_ADDR) + "</dd></div>" +
          '<div class="kv"><dt>Network fee</dt><dd>about $0.42</dd></div>' +
          '<div class="kv"><dt>Arrives in</dt><dd>10 to 30 min</dd></div>' +
        "</dl></div>" +
      "</div>" +
      '<div class="footer"><button class="btn" data-go="sent">Send $1 test</button><button class="btn ghost" data-toast="Full send isn\'t part of this prototype">Send all ' + qty + " " + c.sym + " now</button></div>" +
      '<div class="home-indicator"><span></span></div>';
  };

  views.sent = function () {
    var c = coin();
    return statusBar() + nav("", { close: "holding" }) +
      '<div class="body">' +
        '<div class="done-mark">' + icon("send", 30) + "</div>" +
        '<h1 class="h1 center">Test is on its way</h1>' +
        '<p class="lead center">$1.00 of ' + c.name + " is heading to My hardware wallet. It usually lands in 10 to 30 minutes, and we'll let you know when it does.</p>" +
        '<div class="card"><ol class="steps">' +
           step(1, "Sent from Steady", "var(--text)") +
          step(2, "Confirming on the network", "var(--text-2)") +
          step(3, "Arrives in your wallet", "var(--text-3)") +
        "</ol></div>" +
      "</div>" +
      '<div class="footer"><button class="btn" data-go="holding" data-toast="We\'ll notify you when it arrives">Done</button></div>' +
      '<div class="home-indicator"><span></span></div>';
  };

  /* ---------- render + events ---------- */
  var screenEl = document.getElementById("screen");
  var noteEl = document.getElementById("note");
  var mapEl = document.getElementById("map");
  var timer = null;
  var currentFrame = "home";

  function render() {
    screenEl.innerHTML = views[state.screen]() + '<div class="toast' + (state.toast ? " show" : "") + '" role="status">' + esc(state.toast) + "</div>";
    var f = frameFor();
    currentFrame = f ? f.id : currentFrame;
    if (noteEl && f) noteEl.textContent = f.note;
    if (mapEl) {
      Array.prototype.forEach.call(mapEl.querySelectorAll("button"), function (b) {
        b.setAttribute("aria-current", String(b.getAttribute("data-frame") === currentFrame));
      });
    }
    var body = screenEl.querySelector(".body");
    if (body) body.scrollTop = 0;
  }

  function frameFor() {
    var s = state.screen;
    if (s === "amount") {
      if (amountNum() + fee(amountNum()) > BALANCE) return byId("amount-over");
      return byId(state.amount ? "amount-filled" : "amount");
    }
    if (s === "review") return byId(state.sheet ? "review-faceid" : state.expired ? "review-expired" : "review");
    if (s === "send-address") return byId(state.pasted ? "send-pasted" : "send-address");
    return byId(s);
  }
  function byId(id) { for (var i = 0; i < FRAMES.length; i++) if (FRAMES[i].id === id) return FRAMES[i]; return null; }

  function go(screen) {
    if (screen === "move-savings") {
      var need = Math.ceil((amountNum() + fee(amountNum()) - BALANCE) * 100) / 100;
      BALANCE = Math.round((BALANCE + need) * 100) / 100;
      showToast("Moved " + money(need) + " from Savings");
      render();
      return;
    }
    state.screen = screen;
    state.sheet = false;
    if (screen === "review") startLock();
    else stopLock();
    if (screen === "send-address") state.pasted = state.pasted || "";
    render();
  }

  function startLock() {
    state.lock = LOCK_SECONDS;
    state.expired = false;
    stopLock();
    if (state.frozen) return;
    timer = setInterval(function () {
      state.lock -= 1;
      if (state.lock <= 0) {
        state.expired = true;
        state.sheet = false;
        stopLock();
        render();
        return;
      }
      var t = document.getElementById("lock-time");
      var b = document.getElementById("lock-bar");
      if (t) t.textContent = "0:" + String(state.lock).padStart(2, "0");
      if (b) b.style.width = (state.lock / LOCK_SECONDS) * 100 + "%";
    }, 1000);
  }
  function stopLock() { if (timer) { clearInterval(timer); timer = null; } }

  var toastTimer = null;
  function showToast(msg) {
    state.toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      state.toast = "";
      var t = screenEl.querySelector(".toast");
      if (t) t.classList.remove("show");
    }, 2200);
  }

  screenEl.addEventListener("click", function (e) {
    var el = e.target.closest("button, [data-action]");
    if (!el || el.disabled) return;
    var d = el.dataset;

    if (d.action === "sheet-close" && e.target !== el) return; // clicks inside the sheet
    if (d.toast) showToast(d.toast);
    if (d.amount !== undefined && d.go) state.amount = d.amount;

    if (d.coin) { state.coin = d.coin; state.amount = ""; go("amount"); return; }
    if (d.chip) { state.amount = d.chip; render(); return; }
    if (d.key) { press(d.key); return; }
    if (d.range) { state.range = d.range; render(); return; }

    switch (d.action) {
      case "confirm": state.sheet = true; render(); return;
      case "sheet-close": state.sheet = false; render(); return;
      case "faceid-done": stopLock(); go("success"); return;
      case "refresh": go("review"); showToast("New price held for 30 seconds"); render(); return;
      case "limit": state.limit = !state.limit; render(); return;
      case "paste": state.pasted = LOOKALIKE; render(); return;
      case "use-saved": state.pasted = SAVED_ADDR; state.sendTo = SAVED_ADDR; go("send-test"); return;
      case "clear-paste": state.pasted = ""; go("send-address"); return;
    }
    if (d.go) { go(d.go); return; }
    if (d.toast) render();
  });

  function press(k) {
    var a = state.amount;
    if (k === "del") a = a.slice(0, -1);
    else if (k === ".") { if (a.indexOf(".") === -1) a = (a || "0") + "."; }
    else {
      var parts = a.split(".");
      if (parts[1] !== undefined && parts[1].length >= 2) return;
      if (parts[0].length >= 6 && parts[1] === undefined) return;
      a = a === "0" ? k : a + k;
    }
    state.amount = a;
    render();
  }

  /* ---------- screen map + deep links ---------- */
  if (mapEl) {
    mapEl.innerHTML = FRAMES.map(function (f) {
      return '<li><button data-frame="' + f.id + '">' + esc(f.title) + "</button></li>";
    }).join("");
    mapEl.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-frame]");
      if (b) applyFrame(b.getAttribute("data-frame"), false);
    });
  }

  function applyFrame(id, frozen) {
    var f = byId(id) || FRAMES[0];
    stopLock();
    state.screen = "home"; state.amount = ""; state.sheet = false; state.expired = false;
    state.lock = LOCK_SECONDS; state.pasted = ""; state.toast = ""; state.coin = "btc"; BALANCE = START_BALANCE;
    state.limit = true; state.range = "1W";
    for (var k in f.set) state[k] = f.set[k];
    state.frozen = !!frozen;
    if (state.screen === "review" && !frozen && !state.expired) {
      var keep = state.lock;
      startLock();
      state.lock = keep;
    }
    render();
  }

  var params = new URLSearchParams(location.search);
  if (params.has("bare")) document.body.classList.add("bare");
  applyFrame(params.get("frame") || "home", params.has("bare") || params.has("freeze"));

  window.STEADY = { FRAMES: FRAMES, applyFrame: applyFrame, current: function () { return currentFrame; } };
})();
