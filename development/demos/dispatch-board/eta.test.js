/* QUnit tests for eta.js. Open test.html in any browser to run them. */
(function (Eta) {
  'use strict';

  var matrix = {
    Hub: { A: 10, B: 20 },
    A: { B: 8 }
  };

  QUnit.module('parseWindow');

  QUnit.test('reads evening windows', function (assert) {
    assert.deepEqual(Eta.parseWindow('8–9 PM'), { start: 1200, end: 1260 });
    assert.deepEqual(Eta.parseWindow('7-8 PM'), { start: 1140, end: 1200 }, 'plain hyphen');
    assert.deepEqual(Eta.parseWindow('9–10 PM'), { start: 1260, end: 1320 });
  });

  QUnit.test('reads windows that cross noon or use minutes', function (assert) {
    assert.deepEqual(Eta.parseWindow('11 AM–12 PM'), { start: 660, end: 720 });
    assert.deepEqual(Eta.parseWindow('7:30–8:15 PM'), { start: 1170, end: 1215 });
  });

  QUnit.test('ASAP and unknown text have no window', function (assert) {
    assert.strictEqual(Eta.parseWindow('ASAP'), null);
    assert.strictEqual(Eta.parseWindow('tonight'), null);
    assert.strictEqual(Eta.parseWindow(''), null);
  });

  QUnit.module('formatTime');

  QUnit.test('formats minutes after midnight', function (assert) {
    assert.strictEqual(Eta.formatTime(1160), '7:20 PM');
    assert.strictEqual(Eta.formatTime(0), '12:00 AM');
    assert.strictEqual(Eta.formatTime(725), '12:05 PM');
    assert.strictEqual(Eta.formatTime(545), '9:05 AM');
  });

  QUnit.module('travel');

  QUnit.test('looks up either direction', function (assert) {
    assert.strictEqual(Eta.travel(matrix, 'Hub', 'A'), 10);
    assert.strictEqual(Eta.travel(matrix, 'B', 'A'), 8);
    assert.strictEqual(Eta.travel(matrix, 'A', 'A'), Eta.SAME_TOWN_MIN);
  });

  QUnit.test('throws for an unknown pair', function (assert) {
    assert.throws(function () { Eta.travel(matrix, 'A', 'Z'); }, /No travel time/);
  });

  QUnit.module('planLane');

  var base = { clock: 1160, availableAt: 0, hub: 'Hub', matrix: matrix };

  function withBase(changes) {
    var opts = {};
    var key;
    for (key in base) opts[key] = base[key];
    for (key in changes) opts[key] = changes[key];
    return opts;
  }

  QUnit.test('chains stops from the hub', function (assert) {
    var run = Eta.planLane([{ ref: 'x', town: 'A', window: 'ASAP' }, { ref: 'y', town: 'B', window: 'ASAP' }], base);
    var leave = 1160 + Eta.LOAD_MIN;
    assert.strictEqual(run.departAt, leave);
    assert.strictEqual(run.stops[0].eta, leave + 10);
    assert.strictEqual(run.stops[1].eta, leave + 10 + Eta.SERVICE_MIN + 8);
    assert.strictEqual(run.backAtHub, run.stops[1].eta + Eta.SERVICE_MIN + 20);
  });

  QUnit.test('waits for a driver who is still out', function (assert) {
    var run = Eta.planLane([{ ref: 'x', town: 'A', window: 'ASAP' }], withBase({ availableAt: 1190 }));
    assert.strictEqual(run.departAt, 1190 + Eta.LOAD_MIN);
  });

  QUnit.test('never arrives before a window opens', function (assert) {
    var run = Eta.planLane([{ ref: 'x', town: 'A', window: '8–9 PM' }], base);
    assert.strictEqual(run.stops[0].eta, 1200);
    assert.strictEqual(run.stops[0].waited, 1200 - (1165 + 10));
    assert.false(run.stops[0].late);
  });

  QUnit.test('flags a stop reached after its window closes', function (assert) {
    var run = Eta.planLane([{ ref: 'x', town: 'B', window: '6–7 PM' }], base);
    assert.true(run.stops[0].late);
  });

  QUnit.test('an empty lane has no return time', function (assert) {
    var run = Eta.planLane([], base);
    assert.deepEqual(run.stops, []);
    assert.strictEqual(run.backAtHub, null);
  });
})(window.DispatchEta);

