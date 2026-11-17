/*
 * Dispatch board: jQuery + the HTML5 Drag and Drop API.
 *
 * One state object drives everything. Every change (drag, keyboard move,
 * menu action, new order) goes through commit(), which snapshots the old
 * state for Undo, saves to localStorage and re-renders from state.
 * ETAs come from eta.js, which has no DOM code and its own tests.
 */
(function ($, Eta) {
  'use strict';

  var STORE_KEY = 'dispatch-demo:v1';
  var TOAST_MS = 6000;
  var EDGE_PX = 64;     // auto-scroll starts this close to an edge
  var MAX_STEP = 24;    // and moves at most this far per dragover event

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = null;     // { clock, hub, matrix, lanes, orders, lists }
  var history = [];     // [{ snap, message }]
  var dragging = null;  // ref of the card being dragged with the mouse
  var lifted = null;    // { ref, snap } while a card is moved with the keyboard
  var toastTimer = null;

  var $board = $('#board');
  var $live = $('#live');
  var $toast = $('#toast');
  var $marker = $('<li class="drop-marker" aria-hidden="true"></li>');
  var $menu = null;

  /* ---------- State ---------- */

  function snapshot() {
    return JSON.parse(JSON.stringify({ lists: state.lists, orders: state.orders }));
  }

  function restoreSnapshot(snap) {
    state.lists = snap.lists;
    state.orders = snap.orders;
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) { /* storage blocked: the board still works for this visit */ }
  }

  function readSaved() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function fromJson(board) {
    var orders = {};
    $.each(board.orders, function (_, order) { orders[order.ref] = order; });
    return {
      clock: board.clock,
      hub: board.hub,
      matrix: board.matrix,
      lanes: board.lanes,
      orders: orders,
      lists: board.lists
    };
  }

  function load(fresh) {
    var saved = fresh ? null : readSaved();
    history = [];
    if (saved) {
      state = saved;
      render();
      return;
    }
    $board.attr('aria-busy', 'true');
    $.getJSON('data/board.json')
      .done(function (board) {
        state = fromJson(board);
        save();
        render();
      })
      .fail(function () {
        $board.attr('aria-busy', 'false').empty().append(
          $('<p class="load-error" role="alert"></p>').text('The board could not be loaded. Reload the page to try again.')
        );
      });
  }

  function laneById(id) {
    for (var i = 0; i < state.lanes.length; i++) {
      if (state.lanes[i].id === id) return state.lanes[i];
    }
    return null;
  }

  function locate(ref) {
    var found = null;
    $.each(state.lists, function (laneId, refs) {
      var index = $.inArray(ref, refs);
      if (index !== -1) {
        found = { lane: laneId, index: index, total: refs.length };
        return false;
      }
    });
    return found;
  }

  function plan() {
    var result = { byRef: {}, lanes: {} };
    $.each(state.lanes, function (_, lane) {
      if (lane.id === 'unassigned') return;
      var stops = $.map(state.lists[lane.id] || [], function (ref) { return state.orders[ref]; });
      var run = Eta.planLane(stops, {
        clock: state.clock,
        availableAt: lane.availableAt,
        hub: state.hub,
        matrix: state.matrix
      });
      result.lanes[lane.id] = run;
      $.each(run.stops, function (_, stop) { result.byRef[stop.ref] = stop; });
    });
    return result;
  }

  /* ---------- Rendering ---------- */

  function cardFor(ref) {
    return $board.find('.card[data-ref="' + ref + '"]');
  }

  function money(n) {
    return '$' + n.toFixed(2);
  }

  var STATUS_TEXT = { ready: 'Ready', preparing: 'Preparing', attention: 'Needs attention' };

  function renderCard(order, timing) {
    var etaText = timing ? 'ETA ' + Eta.formatTime(timing.eta) : 'ETA —';
    var label = [order.ref, order.customer, order.town, order.window, etaText, STATUS_TEXT[order.status]];
    if (timing && timing.late) label.push('late for its window');
    if (order.note) label.push(order.note);

    var $grab = $('<div class="grab" role="button" tabindex="0"></div>').attr({
      'aria-roledescription': 'order card',
      'aria-describedby': 'dnd-help',
      'aria-label': label.join(', ')
    });

    $grab.append(
      $('<div class="c-top"></div>').append(
        $('<span class="c-ref"></span>').text(order.ref),
        $('<span class="c-name"></span>').text(order.customer),
        $('<span class="c-when"></span>').text(order.window)
      ),
      $('<div class="c-line"></div>').text(order.town + ' · ' + order.miles.toFixed(1) + ' mi'),
      $('<div class="c-line"></div>').text(money(order.total) + ' · ' + order.payment)
    );

    var $menuButton = $('<button type="button" class="c-menu" aria-haspopup="menu" aria-expanded="false"></button>')
      .attr('aria-label', 'Actions for ' + order.ref)
      .append('<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>');

    // The foot sits outside the grab button so the menu button isn't nested in another button.
    var $foot = $('<div class="c-foot"></div>').append(
      $('<span class="c-eta"></span>').text(etaText)
        .toggleClass('is-unknown', !timing)
        .toggleClass('is-late', !!(timing && timing.late)),
      $('<span class="chip"></span>').addClass('chip-' + order.status).text(STATUS_TEXT[order.status]),
      $menuButton
    );

    var $card = $('<li class="card" draggable="true"></li>')
      .attr('data-ref', order.ref)
      .toggleClass('is-lifted', !!(lifted && lifted.ref === order.ref))
      .append($grab, $foot);
    if (timing && timing.late) {
      $card.append($('<p class="c-note is-late"></p>').text('Late for ' + order.window));
    }
    if (order.note) {
      $card.append($('<p class="c-note"></p>').text(order.note));
    }
    return $card;
  }

  function renderLane(lane, timings) {
    var refs = state.lists[lane.id] || [];
    var isDriver = lane.id !== 'unassigned';
    var titleId = 'lane-' + lane.id;

    var $head = $('<header class="lane-head"></header>');
    if (isDriver) {
      $head.append($('<span class="avatar" aria-hidden="true"></span>').text(lane.initials).css('background-color', lane.color));
    }
    var $title = $('<div class="lane-title"></div>').append($('<h2></h2>').attr('id', titleId).text(lane.name));
    if (isDriver) {
      var where = lane.availableAt > state.clock ? 'Back at hub ' + Eta.formatTime(lane.availableAt) : 'At hub';
      $title.append($('<p></p>').text(lane.vehicle + ' · ' + where));
    }
    $head.append($title, $('<span class="count"></span>').text(refs.length));

    var $list = $(isDriver ? '<ol></ol>' : '<ul></ul>').addClass('lane-list').attr({
      'data-lane': lane.id,
      'aria-labelledby': titleId
    });
    $.each(refs, function (_, ref) {
      $list.append(renderCard(state.orders[ref], timings.byRef[ref]));
    });
    if (!refs.length) {
      $list.append($('<li class="empty"></li>').text(isDriver ? 'No stops' : 'All assigned'));
    }

    var $lane = $('<section class="lane"></section>').attr({ 'data-lane': lane.id, 'aria-labelledby': titleId });
    $lane.append($head, $list);
    if (isDriver && refs.length) {
      var run = timings.lanes[lane.id];
      $lane.append($('<p class="lane-foot"></p>').text(
        'Leaves ' + Eta.formatTime(run.departAt) + ' · back ' + Eta.formatTime(run.backAtHub)
      ));
    }
    return $lane;
  }

  function renderStats(timings) {
    var unassigned = (state.lists.unassigned || []).length;
    var assigned = 0;
    var late = 0;
    $.each(state.lists, function (laneId, refs) {
      if (laneId !== 'unassigned') assigned += refs.length;
    });
    $.each(timings.byRef, function (_, stop) { if (stop.late) late += 1; });

    var $stats = $('#stats').empty().append(
      $('<span></span>').append($('<b></b>').text(unassigned), ' unassigned'), ' ',
      $('<span></span>').append($('<b></b>').text(assigned), ' assigned')
    );
    if (late) {
      $stats.append(' ', $('<span class="is-late"></span>').append($('<b></b>').text(late), ' late'));
    }
    $('#clock').text(Eta.formatTime(state.clock) + ' · sample data');
  }

  function cardRects() {
    var rects = {};
    $board.find('.card').each(function () {
      rects[this.getAttribute('data-ref')] = this.getBoundingClientRect();
    });
    return rects;
  }

  /* Moved cards glide from their old spot to the new one (FLIP). */
  function glide(before) {
    $board.find('.card').each(function () {
      var old = before[this.getAttribute('data-ref')];
      if (!old) return;
      var now = this.getBoundingClientRect();
      var dx = old.left - now.left;
      var dy = old.top - now.top;
      if (!dx && !dy) return;
      var el = this;
      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      el.getBoundingClientRect(); // apply the start position before transitioning
      el.style.transition = 'transform 180ms ease';
      el.style.transform = '';
      setTimeout(function () { el.style.transition = ''; }, 200);
    });
  }

  function render(opts) {
    opts = opts || {};
    var before = opts.animate === false || reduceMotion ? null : cardRects();
    var timings = plan();
    var $lanes = $.map(state.lanes, function (lane) { return renderLane(lane, timings); });

    $board.empty().append($lanes).attr('aria-busy', 'false');
    renderStats(timings);
    $('#undo').prop('disabled', history.length === 0);

    if (opts.focus) {
      var grab = cardFor(opts.focus).find('.grab')[0];
      if (grab) {
        grab.focus();
        if (grab.scrollIntoView) grab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    if (before) glide(before);
  }

  /* ---------- Changes ---------- */

  function announce(message) {
    $live.text('');
    setTimeout(function () { $live.text(message); }, 60);
  }

  function showToast(message) {
    $('#toast-text').text(message);
    $toast.prop('hidden', false);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, TOAST_MS);
  }

  function hideToast() {
    if ($toast.is(':hover') || $.contains($toast[0], document.activeElement)) {
      toastTimer = setTimeout(hideToast, TOAST_MS);
      return;
    }
    $toast.prop('hidden', true);
  }

  function describeMove(ref, fromLane) {
    var at = locate(ref);
    var lane = laneById(at.lane);
    var order = state.orders[ref];
    if (at.lane === 'unassigned') return ref + ' unassigned';
    var stop = plan().byRef[ref];
    var text = at.lane === fromLane
      ? ref + ' is now stop ' + (at.index + 1) + ' for ' + lane.name
      : ref + ' assigned to ' + lane.name + ' as stop ' + (at.index + 1);
    text += ', ETA ' + Eta.formatTime(stop.eta);
    if (stop.late) text += '. Late for its ' + order.window + ' window';
    if (order.note) text += '. ' + order.note;
    return text;
  }

  function commit(snap, message, focusRef) {
    history.push({ snap: snap, message: message });
    if (history.length > 50) history.shift();
    save();
    render({ focus: focusRef });
    announce(message);
    showToast(message);
  }

  function moveOrder(ref, toLane, toIndex, focus) {
    var from = locate(ref);
    var snap = snapshot();
    state.lists[from.lane].splice(from.index, 1);
    var target = state.lists[toLane];
    toIndex = Math.max(0, Math.min(toIndex, target.length));
    target.splice(toIndex, 0, ref);
    if (from.lane === toLane && from.index === toIndex) return; // dropped where it started
    commit(snap, describeMove(ref, from.lane), focus ? ref : null);
  }

  function undo() {
    var last = history.pop();
    if (!last) return;
    restoreSnapshot(last.snap);
    save();
    $toast.prop('hidden', true);
    render();
    announce('Undone: ' + last.message);
  }

  /* ---------- Mouse: HTML5 drag and drop ---------- */

  function placeMarker($list, y) {
    var before = null;
    $list.children('.card').not('.is-dragging').each(function () {
      var r = this.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        before = this;
        return false;
      }
    });
    $list.children('.empty').hide();
    if (before) {
      if ($marker[0].nextSibling !== before) $marker.insertBefore(before);
    } else if ($marker[0].parentNode !== $list[0] || $marker[0].nextSibling) {
      $list.append($marker);
    }
  }

  function markerIndex($list) {
    var index = 0;
    $list.children().each(function () {
      if (this === $marker[0]) return false;
      if ($(this).is('.card:not(.is-dragging)')) index += 1;
    });
    return index;
  }

  function clearMarker() {
    var $list = $marker.parent();
    $marker.detach();
    $list.children('.empty').show();
  }

  /* Each dragover nudges the scroll a bounded step, so resting near an edge keeps scrolling. */
  function edgeStep(pointer, start, end) {
    if (end - start <= EDGE_PX * 2) return 0;
    if (pointer < start + EDGE_PX) return -Math.max(1, Math.ceil(MAX_STEP * (1 - Math.max(0, pointer - start) / EDGE_PX)));
    if (pointer > end - EDGE_PX) return Math.max(1, Math.ceil(MAX_STEP * (1 - Math.max(0, end - pointer) / EDGE_PX)));
    return 0;
  }

  function autoScroll(event) {
    var box = $board[0].getBoundingClientRect();
    var dx = edgeStep(event.clientX, box.left, box.right);
    if (dx) $board[0].scrollLeft += dx;
    var dy = edgeStep(event.clientY, 0, window.innerHeight);
    if (dy) window.scrollBy(0, dy);
  }

  $board.on('dragstart', '.card', function (e) {
    if (lifted) return false;
    closeMenu();
    dragging = this.getAttribute('data-ref');
    var transfer = e.originalEvent.dataTransfer;
    transfer.effectAllowed = 'move';
    try { transfer.setData('text/plain', dragging); } catch (err) { transfer.setData('Text', dragging); }
    var card = this;
    // Wait a tick so the browser's drag image is taken before the card fades.
    setTimeout(function () { $(card).addClass('is-dragging'); }, 0);
  });

  $board.on('dragover', '.lane', function (e) {
    if (!dragging) return;
    e.preventDefault();
    e.originalEvent.dataTransfer.dropEffect = 'move';
    placeMarker($(this).find('.lane-list'), e.originalEvent.clientY);
    autoScroll(e.originalEvent);
  });

  $board.on('dragleave', '.lane', function (e) {
    var to = e.originalEvent.relatedTarget;
    if (!to || !$.contains(this, to)) clearMarker();
  });

  $board.on('drop', '.lane', function (e) {
    if (!dragging) return;
    e.preventDefault();
    var $list = $(this).find('.lane-list');
    var index = $marker.parent()[0] === $list[0] ? markerIndex($list) : $list.children('.card').not('.is-dragging').length;
    var ref = dragging;
    endDrag();
    moveOrder(ref, $list.attr('data-lane'), index, false);
  });

  $board.on('dragend', '.card', endDrag);

  function endDrag() {
    dragging = null;
    clearMarker();
    $board.find('.is-dragging').removeClass('is-dragging');
  }

  /* ---------- Keyboard: pick up, move, drop ---------- */

  function position(ref) {
    var at = locate(ref);
    var lane = laneById(at.lane);
    if (at.lane === 'unassigned') return 'Unassigned, ' + (at.index + 1) + ' of ' + at.total;
    var stop = plan().byRef[ref];
    return lane.name + ', stop ' + (at.index + 1) + ' of ' + at.total + ', ETA ' + Eta.formatTime(stop.eta) + (stop.late ? ', late' : '');
  }

  function lift(ref) {
    closeMenu();
    lifted = { ref: ref, snap: snapshot(), from: locate(ref).lane };
    render({ focus: ref, animate: false });
    announce('Picked up ' + ref + '. ' + position(ref) + '. Arrow keys move it, Space drops it, Escape cancels.');
  }

  function nudge(laneStep, indexStep) {
    var ref = lifted.ref;
    var at = locate(ref);
    var laneIds = $.map(state.lanes, function (lane) { return lane.id; });
    var laneIndex = $.inArray(at.lane, laneIds);
    var toLane = laneIds[Math.max(0, Math.min(laneIds.length - 1, laneIndex + laneStep))];
    var toIndex = toLane === at.lane ? at.index + indexStep : Math.min(at.index, state.lists[toLane].length);
    var limit = state.lists[toLane].length - (toLane === at.lane ? 1 : 0);
    toIndex = Math.max(0, Math.min(limit, toIndex));
    if (toLane === at.lane && toIndex === at.index) {
      announce(position(ref));
      return;
    }
    state.lists[at.lane].splice(at.index, 1);
    state.lists[toLane].splice(toIndex, 0, ref);
    render({ focus: ref });
    announce(position(ref));
  }

  function drop() {
    var move = lifted;
    lifted = null;
    if (JSON.stringify(move.snap.lists) === JSON.stringify(state.lists)) {
      render({ focus: move.ref, animate: false });
      announce(move.ref + ' dropped where it started.');
      return;
    }
    commit(move.snap, describeMove(move.ref, move.from), move.ref);
  }

  function cancelLift() {
    var move = lifted;
    lifted = null;
    restoreSnapshot(move.snap);
    render({ focus: move.ref });
    announce('Move cancelled. ' + move.ref + ' is back at ' + position(move.ref) + '.');
  }

  $board.on('keydown', '.grab', function (e) {
    var ref = $(this).closest('.card').attr('data-ref');
    if (!lifted) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        lift(ref);
      }
      return;
    }
    if (lifted.ref !== ref) return;
    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); nudge(0, -1); break;
      case 'ArrowDown': e.preventDefault(); nudge(0, 1); break;
      case 'ArrowLeft': e.preventDefault(); nudge(-1, 0); break;
      case 'ArrowRight': e.preventDefault(); nudge(1, 0); break;
      case ' ':
      case 'Enter': e.preventDefault(); drop(); break;
      case 'Escape': e.preventDefault(); cancelLift(); break;
      case 'Tab': cancelLift(); break;
    }
  });

  // Clicking anywhere else while a card is lifted puts it back.
  $(document).on('mousedown', function (e) {
    if (lifted && !$(e.target).closest('.card[data-ref="' + lifted.ref + '"]').length) cancelLift();
  });

  /* ---------- Card menu (works on touch screens too) ---------- */

  function menuItem(label, action) {
    return $('<li role="none"></li>').append(
      $('<button type="button" role="menuitem" tabindex="-1"></button>').text(label).on('click', function () {
        closeMenu(true);
        action();
      })
    );
  }

  function openMenu($button) {
    closeMenu();
    var ref = $button.closest('.card').attr('data-ref');
    var at = locate(ref);
    var order = state.orders[ref];

    $menu = $('<ul class="menu" role="menu"></ul>').attr('aria-label', 'Actions for ' + ref).data('button', $button);
    $.each(state.lanes, function (_, lane) {
      if (lane.id === at.lane) return;
      var label = lane.id === 'unassigned' ? 'Unassign' : 'Assign to ' + lane.name;
      $menu.append(menuItem(label, function () { moveOrder(ref, lane.id, state.lists[lane.id].length, true); }));
    });
    if (at.index > 0) {
      $menu.append(menuItem(at.lane === 'unassigned' ? 'Move to top' : 'Make next stop', function () { moveOrder(ref, at.lane, 0, true); }));
    }
    $menu.append('<li role="separator"></li>');
    $menu.append(menuItem(order.status === 'ready' ? 'Mark not ready' : (order.status === 'attention' ? 'Resolve and mark ready' : 'Mark ready'), function () {
      var snap = snapshot();
      var o = state.orders[ref];
      o.status = o.status === 'ready' ? 'preparing' : 'ready';
      delete o.note;
      commit(snap, ref + ' marked ' + (o.status === 'ready' ? 'ready' : 'not ready'), ref);
    }));

    // Inside <main> so the open menu stays in a landmark for screen readers.
    $board.append($menu);
    var r = $button[0].getBoundingClientRect();
    var width = $menu.outerWidth();
    var height = $menu.outerHeight();
    var top = r.bottom + 4 + height > window.innerHeight ? r.top - 4 - height : r.bottom + 4;
    $menu.css({ top: Math.max(8, top), left: Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width)) });
    $button.attr('aria-expanded', 'true');
    $menu.find('[role="menuitem"]').first().trigger('focus');
  }

  function closeMenu(keepFocus) {
    if (!$menu) return;
    var $button = $menu.data('button');
    $menu.remove();
    $menu = null;
    if ($button) {
      $button.attr('aria-expanded', 'false');
      if (!keepFocus && document.activeElement === document.body) $button.trigger('focus');
    }
  }

  $board.on('click', '.c-menu', function (e) {
    e.stopPropagation();
    var isOpen = $menu && $menu.data('button')[0] === this;
    if (isOpen) closeMenu();
    else openMenu($(this));
  });

  $(document).on('keydown', '.menu', function (e) {
    var $items = $menu.find('[role="menuitem"]');
    var index = $items.index(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); $items.eq((index + 1) % $items.length).trigger('focus'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); $items.eq((index - 1 + $items.length) % $items.length).trigger('focus'); }
    else if (e.key === 'Home') { e.preventDefault(); $items.first().trigger('focus'); }
    else if (e.key === 'End') { e.preventDefault(); $items.last().trigger('focus'); }
    else if (e.key === 'Escape') { e.preventDefault(); var $b = $menu.data('button'); closeMenu(true); $b.trigger('focus'); }
    else if (e.key === 'Tab') { closeMenu(true); }
  });

  $(document).on('mousedown', function (e) {
    if ($menu && !$(e.target).closest('.menu, .c-menu').length) closeMenu(true);
  });
  $(window).on('resize', function () { closeMenu(true); });
  $board.on('scroll', function () { closeMenu(true); });

  /* ---------- Toolbar ---------- */

  $('#new-order').on('click', function () {
    var $button = $(this).prop('disabled', true).attr('aria-busy', 'true');
    // Each click asks the server for the queue, like a real board polling for orders.
    $.getJSON('data/incoming.json')
      .done(function (queue) {
        var next = $.grep(queue, function (order) { return !state.orders[order.ref]; })[0];
        if (!next) {
          announce('No new orders right now.');
          showToast('No new orders right now');
          return;
        }
        var snap = snapshot();
        state.orders[next.ref] = next;
        state.lists.unassigned.unshift(next.ref);
        commit(snap, 'New order ' + next.ref + ', ' + next.customer + ', ' + next.town + ', ' + next.window, null);
        cardFor(next.ref).addClass('is-new');
      })
      .fail(function () { showToast('Could not reach the order queue'); })
      .always(function () { $button.prop('disabled', false).removeAttr('aria-busy'); });
  });

  $('#undo, #toast-undo').on('click', undo);

  $('#reset').on('click', function () {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
    $toast.prop('hidden', true);
    load(true);
    announce('Board reset.');
  });

  $(document).on('keydown', function (e) {
    var isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z');
    if (isUndo && !$(e.target).is('input, textarea, select') && !lifted) {
      e.preventDefault();
      undo();
    }
  });

  load(false);
})(jQuery, window.DispatchEta);
