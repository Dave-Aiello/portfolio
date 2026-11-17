/*
 * Route timing for the dispatch board. Pure functions, no DOM, so the
 * same code runs in the page and in the QUnit suite (test.html).
 * Times are minutes after midnight.
 */
(function (root) {
  'use strict';

  var LOAD_MIN = 5;      // loading the car before a trip
  var SERVICE_MIN = 4;   // time at each door
  var SAME_TOWN_MIN = 6; // two stops in the same town

  function travel(matrix, from, to) {
    if (from === to) return SAME_TOWN_MIN;
    if (matrix[from] && typeof matrix[from][to] === 'number') return matrix[from][to];
    if (matrix[to] && typeof matrix[to][from] === 'number') return matrix[to][from];
    throw new Error('No travel time between ' + from + ' and ' + to);
  }

  function toMinutes(hour, minute, meridiem) {
    var h = hour % 12;
    if (meridiem === 'PM') h += 12;
    return h * 60 + (minute || 0);
  }

  /* "8–9 PM" -> { start: 1200, end: 1260 }. "ASAP" -> null. */
  function parseWindow(text) {
    if (!text || text === 'ASAP') return null;
    var m = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[–-]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/.exec(text);
    if (!m) return null;
    var endMer = m[6];
    var startMer = m[3] || endMer;
    var start = toMinutes(+m[1], m[2] ? +m[2] : 0, startMer);
    var end = toMinutes(+m[4], m[5] ? +m[5] : 0, endMer);
    if (end <= start) end += 12 * 60;
    return { start: start, end: end };
  }

  function formatTime(minutes) {
    var m = Math.round(minutes) % (24 * 60);
    var h = Math.floor(m / 60);
    var mm = m % 60;
    var mer = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + mer;
  }

  /*
   * Plans one driver's run.
   *   stops: [{ ref, town, window }] in delivery order
   *   opts:  { clock, availableAt, hub, matrix }
   * A stop with a delivery window is never reached early: the driver waits
   * for the window to open. A stop reached after its window closes is late.
   */
  function planLane(stops, opts) {
    var departAt = Math.max(opts.clock, opts.availableAt || 0) + LOAD_MIN;
    var here = opts.hub;
    var t = departAt;
    var planned = [];
    for (var i = 0; i < stops.length; i++) {
      var stop = stops[i];
      var arrive = t + travel(opts.matrix, here, stop.town);
      var win = parseWindow(stop.window);
      var eta = win && arrive < win.start ? win.start : arrive;
      planned.push({
        ref: stop.ref,
        eta: eta,
        waited: eta - arrive,
        late: !!win && eta > win.end
      });
      t = eta + SERVICE_MIN;
      here = stop.town;
    }
    return {
      departAt: departAt,
      stops: planned,
      backAtHub: stops.length ? t + travel(opts.matrix, here, opts.hub) : null
    };
  }

  root.DispatchEta = {
    LOAD_MIN: LOAD_MIN,
    SERVICE_MIN: SERVICE_MIN,
    SAME_TOWN_MIN: SAME_TOWN_MIN,
    travel: travel,
    parseWindow: parseWindow,
    formatTime: formatTime,
    planLane: planLane
  };
})(this);
