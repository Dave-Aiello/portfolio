/* Magic Dragon for iPhone, Gallery direction: clickable prototype.
   Each frame is one screen. Elements with data-go="<frame id>" open that frame; data-toast shows
   what would happen (calls, steppers, settings). The Figma import reads the same attributes.
   Product, customer and order details: real menu items and prices; people and orders are made up. */
(function () {
  "use strict";

  /* after: the frame moves on by itself (the launch, and the delivery states as the order progresses) */
  var FRAMES = [
  {
    "id": "launch",
    "n": "01",
    "title": "Launch",
    "note": "A purple line draws the dragon in 14 strokes over 1.3 s, head first and eyes last. The lavender body and faint belly then fade in under the lines, which stay at full strength, and the wordmark rises 8 pt. The screen holds until 2.5 s, then cross-fades into Home. If the menu is still loading, the line fades to a ghost and redraws until it arrives, ending on the same tinted mark. Reduce Motion shows the finished mark.",
    "after": {
      "to": "welcome",
      "ms": 2950
    }
  },
  {
    "id": "welcome",
    "n": "02",
    "title": "21+ and location",
    "note": "Massachusetts requires the 21+ check before the menu. Location comes next, and only roughly: it picks which store's menu you see. The street address is typed on the next screen."
  },
  {
    "id": "address",
    "n": "03",
    "title": "Delivery address",
    "note": "The delivery address is always typed, with suggestions as you go. Location never fills it in, so the driver goes where you said."
  },
  {
    "id": "home",
    "n": "04",
    "title": "Home",
    "note": "Photos do the selling. Store status and delivery time sit together at the top, so you know before browsing that delivery takes 40–50 minutes."
  },
  {
    "id": "menu",
    "n": "05",
    "title": "Menu",
    "note": "Four categories, as in the store: Flower, Pre-rolls, Vapes and Edibles. Every card has a real photo, price, brand and THC."
  },
  {
    "id": "category",
    "n": "06",
    "title": "Category and filters",
    "note": "Filters are plain chips under the title, one tap each. The count tells you how much is left to scroll."
  },
  {
    "id": "search",
    "n": "07",
    "title": "Search",
    "note": "Search matches names, brands and categories as you type. If nothing fits, the categories are right below."
  },
  {
    "id": "product",
    "n": "08",
    "title": "Product",
    "note": "THC, size and the lab test date come first, then the description. The 21+ warning is part of the page, not a pop-up."
  },
  {
    "id": "product-added",
    "n": "09",
    "title": "Added to bag",
    "note": "Adding keeps you browsing. The card turns into a stepper and the bag bar shows the count and subtotal."
  },
  {
    "id": "bag",
    "n": "10",
    "title": "Bag",
    "note": "Cash or debit at the door and the ID check are stated before checkout, so nothing at the door is a surprise. The bag shows the items, the fee, the taxes and the total, nothing else."
  },
  {
    "id": "sign-in",
    "n": "11",
    "title": "Phone sign-in",
    "note": "Sign-in waits until checkout: browsing never needs an account. The phone number is the account."
  },
  {
    "id": "code",
    "n": "12",
    "title": "Code entry",
    "note": "Six boxes, one digit each. The code from Messages is offered above the keypad, so one tap fills it and places the order."
  },
  {
    "id": "placed",
    "n": "13",
    "title": "Order placed",
    "note": "One clear success moment: the arrival window, the order number and what to have ready at the door."
  },
  {
    "id": "track-preparing",
    "n": "14",
    "title": "Tracking: preparing",
    "note": "Before a driver heads out, the map shows only your home. The four steps say where the order is.",
    "after": {
      "to": "track-on-the-way",
      "ms": 5000
    }
  },
  {
    "id": "track-on-the-way",
    "n": "15",
    "title": "Tracking: on the way",
    "note": "The map shows the driver's dragon badge and your home pin, nothing else: no route and no other stops. \"2 stops before you\" sets expectations without showing where.",
    "after": {
      "to": "track-arriving",
      "ms": 5000
    }
  },
  {
    "id": "track-arriving",
    "n": "16",
    "title": "Tracking: arriving",
    "note": "When you're the next stop, the sheet leads with what you need at the door: payment and ID.",
    "after": {
      "to": "track-delivered",
      "ms": 5000
    }
  },
  {
    "id": "track-delivered",
    "n": "17",
    "title": "Tracking: delivered",
    "note": "Delivered, with the time and the way to the receipt. The driver's position is no longer shown."
  },
  {
    "id": "receipt",
    "n": "18",
    "title": "Receipt",
    "note": "Every line, the fee and the taxes, and how it was paid. Questions go to the store's phone line."
  },
  {
    "id": "orders",
    "n": "19",
    "title": "Orders",
    "note": "Past orders with their photos, so you recognize them at a glance, and a one-tap reorder."
  },
  {
    "id": "account",
    "n": "20",
    "title": "Account",
    "note": "One list: address, location, text updates and the store's phone number. Deleting the account is in the app, not behind an email."
  },
  {
    "id": "location-off",
    "n": "21",
    "title": "Location turned off",
    "note": "If you skipped location, Account offers to turn it on, with the one reason it's needed."
  },
  {
    "id": "bag-empty",
    "n": "22",
    "title": "Empty bag",
    "note": "An empty bag points back to the menu and shows what's popular, with real photos."
  },
  {
    "id": "closed",
    "n": "23",
    "title": "Store closed",
    "note": "When the store is closed, Home says when it opens. You can still browse; the add buttons return at 1 PM."
  },
  {
    "id": "problem",
    "n": "24",
    "title": "Order problem",
    "note": "When something needs a person, the app says so plainly and puts the store's number in the main button. The store sorts it out with the driver."
  }
];

  var screenEl = document.getElementById("screen");
  var noteEl = document.getElementById("note");
  var curEl = document.getElementById("cur");
  var mapEl = document.querySelector(".stage-map");
  var deviceEl = document.getElementById("device");
  var wrapEl = document.getElementById("wrap");
  var params = new URLSearchParams(location.search);
  var bare = params.has("bare");
  var currentFrame = FRAMES[0].id;
  var frozen = false;
  var autoTimer = null, toastTimer = null;

  function byId(id) { for (var i = 0; i < FRAMES.length; i++) if (FRAMES[i].id === id) return FRAMES[i]; return null; }

  function render(id) {
    var f = byId(id) || FRAMES[0];
    var t = document.getElementById("t-" + f.id);
    clearTimeout(autoTimer);
    screenEl.innerHTML = t.innerHTML + '<div class="toast" role="status"></div>';
    screenEl.setAttribute("data-screen", f.id);
    currentFrame = f.id;
    if (noteEl) noteEl.textContent = f.note;
    if (curEl) curEl.textContent = f.n + "  " + f.title;
    if (mapEl) Array.prototype.forEach.call(mapEl.querySelectorAll("button[data-frame]"), function (b) {
      b.setAttribute("aria-current", String(b.getAttribute("data-frame") === f.id));
    });
    if (!bare && !frozen && history.replaceState) {
      var p = new URLSearchParams(location.search); p.set("frame", f.id);
      history.replaceState(null, "", "?" + p.toString());
    }
    if (f.after && !frozen && !bare) autoTimer = setTimeout(function () { render(f.after.to); }, f.after.ms);
  }

  function showToast(msg) {
    var el = screenEl.querySelector(".toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 1800);
  }

  screenEl.addEventListener("click", function (e) {
    var el = e.target.closest("[data-go],[data-toast]");
    if (!el || !screenEl.contains(el)) return;
    e.preventDefault();
    var go = el.getAttribute("data-go");
    if (go && go !== currentFrame && byId(go)) { render(go); return; }
    var msg = el.getAttribute("data-toast");
    if (msg) showToast(msg);
  });

  if (mapEl) mapEl.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-frame]");
    if (b) applyFrame(b.getAttribute("data-frame"), false);
  });

  /* fit the phone to the window (never larger than 1:1) */
  function fit() {
    if (bare) { deviceEl.style.transform = ""; wrapEl.style.width = wrapEl.style.height = ""; return; }
    var narrow = window.innerWidth <= 900;
    var w = narrow ? 390 : 414, h = narrow ? 844 : 868;
    var s = narrow ? Math.min(window.innerWidth / w, window.innerHeight / h) : Math.min(1, (window.innerHeight - 48) / h);
    deviceEl.style.transform = s < 1 || narrow ? "scale(" + s + ")" : "";
    wrapEl.style.width = w * s + "px";
    wrapEl.style.height = h * s + "px";
    if (narrow) wrapEl.style.margin = "0 auto";
  }
  window.addEventListener("resize", fit);

  function applyFrame(id, freeze) {
    frozen = !!freeze;
    render(id);
  }

  if (bare) document.body.classList.add("bare");
  fit();
  applyFrame(params.get("frame") || FRAMES[0].id, bare || params.has("freeze"));

  window.MAGICDRAGON = { FRAMES: FRAMES, applyFrame: applyFrame, current: function () { return currentFrame; } };
  /* same API name as the Steady prototype, so portfolio-live/figma/build.js can read this one by changing its URL */
  window.STEADY = window.MAGICDRAGON;
})();
