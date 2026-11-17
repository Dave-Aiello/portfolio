/*
 * Signature pad on a canvas, using Pointer Events so mouse, touch and
 * stylus share one code path. Strokes are kept as points in CSS pixels
 * and redrawn whenever the canvas is resized, so the signature survives
 * rotating a phone. The backing store is scaled by devicePixelRatio to
 * stay sharp on high-density screens.
 */
(function (root) {
  'use strict';

  function SignaturePad(canvas, onChange) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = [];
    this.current = null;
    this.onChange = onChange || function () {};
    this._bind();
    this.resize();
  }

  SignaturePad.prototype._bind = function () {
    var pad = this;
    var canvas = this.canvas;

    function point(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      pad.current = [point(e)];
      pad.strokes.push(pad.current);
      pad._drawStroke(pad.current);
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!pad.current) return;
      e.preventDefault();
      // Coalesced events give every point the hardware reported, for smoother lines.
      var events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (var i = 0; i < events.length; i++) pad.current.push(point(events[i]));
      pad.redraw();
    });

    function end() {
      if (!pad.current) return;
      pad.current = null;
      pad.onChange();
    }
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    if (root.ResizeObserver) {
      new root.ResizeObserver(function () { pad.resize(); }).observe(canvas);
    } else {
      root.addEventListener('resize', function () { pad.resize(); });
    }
  };

  SignaturePad.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    var dpr = root.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  };

  /* Draws one stroke, smoothing the line through the midpoints between samples. */
  SignaturePad.prototype._drawStroke = function (pts) {
    var ctx = this.ctx;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#17202a';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
      return;
    }
    ctx.beginPath();
    var prev = pts[0];
    ctx.moveTo(prev.x, prev.y);
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i];
      var mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
      ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
      prev = p;
    }
    ctx.lineTo(prev.x, prev.y);
    ctx.stroke();
  };

  SignaturePad.prototype.redraw = function () {
    var r = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, r.width, r.height);
    for (var i = 0; i < this.strokes.length; i++) this._drawStroke(this.strokes[i]);
  };

  SignaturePad.prototype.isEmpty = function () {
    return this.strokes.length === 0;
  };

  SignaturePad.prototype.clear = function () {
    this.strokes = [];
    this.redraw();
    this.onChange();
  };

  SignaturePad.prototype.getStrokes = function () {
    return JSON.parse(JSON.stringify(this.strokes));
  };

  SignaturePad.prototype.setStrokes = function (strokes) {
    this.strokes = strokes || [];
    this.redraw();
  };

  /* A PNG of the signature on white, for the finished report. */
  SignaturePad.prototype.toDataURL = function () {
    var out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    var ctx = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(this.canvas, 0, 0);
    return out.toDataURL('image/png');
  };

  root.SignaturePad = SignaturePad;
})(window);
