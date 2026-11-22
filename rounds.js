// Work Quiz – the newer round types: the year wheel, the ordering tiles and the resize stage,
// plus the charts shown at their reveals. Used by the player, big-screen and quiz master screens.
(function () {
  "use strict";
  var h = WQ.h;
  function busy(b) { if (WQ.setBusy) WQ.setBusy(b); }

  // ======================================================================
  // Guess the year: a wheel of years that clicks to each year.
  // o: { min, max, start, onChange(year) }
  // ======================================================================
  WQ.yearWheel = function (o) {
    var ROW = 52, min = o.min, max = o.max;
    var clamp = function (y) { return Math.max(min, Math.min(max, Math.round(y))); };
    var value = clamp(o.start), locked = false, enabled = true;
    var items = [], list = h("div", { class: "yw-list" });
    for (var y = min; y <= max; y++) {
      var it = h("div", { class: "yw-item", text: String(y) });
      it.dataset.y = y;
      items.push(it);
      list.appendChild(it);
    }
    var win = h("div", { class: "yw-window", tabindex: "0", role: "listbox", "aria-label": "Year" }, [list]);
    var wheel = h("div", { class: "yw-wheel" }, [h("div", { class: "yw-band" }), win, h("div", { class: "yw-fade top" }), h("div", { class: "yw-fade bottom" })]);
    var steps = h("div", { class: "yw-btns" }, [-10, -1, 1, 10].map(function (d) {
      return h("button", { class: "yw-step", type: "button", text: (d > 0 ? "+" : "−") + Math.abs(d),
        "aria-label": (d > 0 ? "Later by " : "Earlier by ") + Math.abs(d), onclick: function () { if (canUse()) go((target !== null ? target : value) + d, true); } });
    }));
    var el = h("div", { class: "yw" }, [wheel, steps]);
    var marked = null, restoring = false, idle = null, scrolling = false, target = null;   // target: where a button press is heading

    function canUse() { return enabled && !locked; }
    function mark() {
      var it = items[value - min];
      if (marked === it) return;
      if (marked) marked.classList.remove("sel");
      if (it) it.classList.add("sel");
      marked = it;
    }
    function go(y, smooth) {
      y = clamp(y);
      target = smooth ? y : null;
      win.scrollTo({ top: (y - min) * ROW, behavior: smooth ? "smooth" : "auto" });
    }
    win.addEventListener("scroll", function () {
      if (restoring) { restoring = false; return; }
      var y = clamp(min + Math.round(win.scrollTop / ROW));
      if (y !== value) { value = y; mark(); if (o.onChange) o.onChange(value); }
      // Hold back screen redraws while the wheel is moving (a redraw would stop it mid-spin).
      if (!scrolling) { scrolling = true; busy(true); }
      clearTimeout(idle);
      idle = setTimeout(function () { scrolling = false; target = null; busy(false); }, 200);
    });
    list.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest(".yw-item");
      if (t && canUse()) go(+t.dataset.y, true);
    });
    win.addEventListener("keydown", function (e) {
      if (!canUse()) return;
      var d = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 }[e.key];
      if (d) { e.preventDefault(); go((target !== null ? target : value) + d, true); }
    });
    function refresh() {
      // The wheel loses its position when the screen redraws, so put it back.
      var top = (value - min) * ROW;
      if (Math.abs(win.scrollTop - top) > 1) { restoring = true; win.scrollTop = top; }
      mark();
    }
    function setState() {
      el.classList.toggle("locked", locked);
      el.classList.toggle("disabled", !enabled);
      win.style.overflowY = canUse() ? "auto" : "hidden";
      steps.querySelectorAll("button").forEach(function (b) { b.disabled = !canUse(); });
    }
    setState();
    mark();
    return {
      el: el, refresh: refresh,
      value: function () { return value; },
      setValue: function (y) { value = clamp(y); refresh(); },
      setLocked: function (b) { locked = !!b; setState(); },
      setEnabled: function (b) { enabled = !!b; setState(); }
    };
  };

  // How far off a year guess was, in words.
  WQ.yearOffText = function (guess, answer) {
    var d = guess - answer;
    if (d === 0) return "spot on";
    return Math.abs(d) + (Math.abs(d) === 1 ? " year " : " years ") + (d < 0 ? "too early" : "too late");
  };

  // The big-screen chart of everyone's guesses, from 7 years before the answer to 7 after.
  WQ.yearChart = function (guesses, answer) {
    var SPAN = 7, bins = [], early = 0, late = 0;
    for (var i = -SPAN; i <= SPAN; i++) bins.push(0);
    guesses.forEach(function (g) {
      var d = g - answer;
      if (d < -SPAN) early++; else if (d > SPAN) late++; else bins[d + SPAN]++;
    });
    var cols = [{ label: "Earlier", n: early, cls: "far" }];
    bins.forEach(function (n, i) {
      var d = i - SPAN;
      cols.push({ label: String(answer + d), n: n, cls: d === 0 ? "exact" : Math.abs(d) === 1 ? "near" : "" });
    });
    cols.push({ label: "Later", n: late, cls: "far" });
    var top = Math.max(1, Math.max.apply(null, cols.map(function (c) { return c.n; })));
    return h("div", { class: "year-chart" }, cols.map(function (c) {
      return h("div", { class: "yc-col " + c.cls }, [
        h("div", { class: "yc-n", text: c.n ? String(c.n) : "" }),
        h("div", { class: "yc-bar-wrap" }, [h("div", { class: "yc-bar", style: { height: (c.n / top * 100) + "%" } })]),
        h("div", { class: "yc-label", text: c.label })
      ]);
    }));
  };

  // ======================================================================
  // Ordering: tap the things in order. o: { items (in the order shown), top, bottom, onChange(order) }
  // The order is a string of positions in the shown list, e.g. "2031" means the 3rd thing shown goes first.
  // ======================================================================
  WQ.orderBoard = function (o) {
    var n = o.items.length, order = [], locked = false, enabled = true, marks = null;
    var el = h("div", { class: "ord" });
    function canUse() { return enabled && !locked && !marks; }
    function changed() { draw(); if (o.onChange) o.onChange(order.length === n ? order.join("") : null); }
    function draw() {
      WQ.clear(el);
      el.appendChild(h("div", { class: "ord-end", text: "▲ " + o.top }));
      var slots = h("div", { class: "ord-slots" });
      // Placed things, then one empty slot for the next tap (the rest stay hidden, to keep it short on phones).
      var showTo = canUse() ? Math.min(n, order.length + 1) : Math.max(order.length, 1);
      for (var k = 0; k < showTo; k++) {
        var d = order[k], row = h("div", { class: "ord-slot" + (d === undefined ? " empty" : "") }, [h("span", { class: "ord-num", text: String(k + 1) })]);
        if (d !== undefined) {
          var ok = marks ? marks[k] : null;
          row.appendChild(h("button", { class: "ord-tile placed" + (ok === true ? " right" : ok === false ? " wrong" : ""), type: "button",
            disabled: !canUse(), onclick: (function (kk) { return function () { order.splice(kk, 1); changed(); }; })(k) },
            [h("span", { class: "ord-text", text: o.items[d] }), marks ? h("span", { class: "ord-mark", text: ok ? "✓" : "✗" }) : null]));
        } else {
          var hint = !canUse() ? "" : k === 0 ? "Tap the one that goes first (" + o.top.toLowerCase() + ")" : k === n - 1 ? "Tap the last one (" + o.bottom.toLowerCase() + ")" : "Tap the next one";
          row.appendChild(h("span", { class: "ord-placeholder", text: hint }));
        }
        slots.appendChild(row);
      }
      el.appendChild(slots);
      if (order.length === n || !canUse()) el.appendChild(h("div", { class: "ord-end", text: "▼ " + o.bottom }));
      var left = [];
      for (var i = 0; i < n; i++) if (order.indexOf(i) < 0) left.push(i);
      if (left.length && canUse()) {
        el.appendChild(h("div", { class: "ord-pool" }, left.map(function (i) {
          return h("button", { class: "ord-tile", type: "button", onclick: function () { if (canUse() && order.indexOf(i) < 0) { order.push(i); changed(); } } },
            [h("span", { class: "ord-text", text: o.items[i] })]);
        })));
      }
      if (order.length && canUse()) {
        el.appendChild(h("button", { class: "btn-link ord-clear", type: "button", text: "Start again", onclick: function () { order = []; changed(); } }));
      }
    }
    draw();
    return {
      el: el,
      getOrder: function () { return order.length === n ? order.join("") : null; },
      setOrder: function (s) { order = String(s || "").split("").map(Number); draw(); },
      setLocked: function (b) { if (locked !== !!b) { locked = !!b; draw(); } },
      setEnabled: function (b) { if (enabled !== !!b) { enabled = !!b; draw(); } },
      // shown: for each shown position, its place in the right order. Marks each placed tile right or wrong.
      setMarks: function (shown) { marks = order.map(function (d, k) { return shown[d] === k; }); draw(); }
    };
  };

  // The right order as a list. shown: for each shown position, its place in the right order.
  WQ.orderList = function (items, shown, top, bottom, cls) {
    var byPlace = [];
    shown.forEach(function (place, d) { byPlace[place] = items[d]; });
    return h("div", { class: "ord-answer " + (cls || "") }, [
      h("div", { class: "ord-end", text: "▲ " + top }),
      h("ol", null, byPlace.map(function (t) { return h("li", { text: t }); })),
      h("div", { class: "ord-end", text: "▼ " + bottom })
    ]);
  };

  // ======================================================================
  // Resize: the blue picture stays put, players make the red one bigger or smaller.
  // Scale = the red picture's height as a multiple of the blue one's. Whichever is taller fills the view.
  // o: { fixed: {src or data, w, h}, moving: {...}, interactive, maxW(), maxH(), onChange(scale) }
  // ======================================================================
  function srcOf(p) { return p ? (p.data || p.src || null) : null; }
  WQ.outline = function (pic, color, cls) {
    var d = h("div", { class: "rs-obj " + (cls || "") });
    setMask(d, srcOf(pic));
    d.style.backgroundColor = color;
    return d;
  };
  function setMask(d, src) {
    d.style.visibility = src ? "" : "hidden";   // until the picture arrives
    if (!src || d.dataset.src === src) return;
    d.dataset.src = src;
    var u = 'url("' + String(src).replace(/"/g, "%22") + '")';
    d.style.webkitMaskImage = u; d.style.maskImage = u;
  }
  var LOGMAX = Math.log(WQ.RESIZE_MAX);
  WQ.resizeStage = function (o) {
    var q = 1, ghost = null, locked = false, interactive = !!o.interactive, zoom = 1, sx = 0, sy = 0, zoomed = false;
    var fixedEl = WQ.outline(o.fixed, "var(--b)", "fixed");
    var movingEl = WQ.outline(o.moving, "var(--a)", "moving");
    var ghostEl = WQ.outline(o.moving, "var(--gold)", "ghost");
    ghostEl.hidden = true;
    var ground = h("div", { class: "rs-ground" });
    var inner = h("div", { class: "rs-inner" }, [ground, fixedEl, ghostEl, movingEl]);
    var scroller = h("div", { class: "rs-scroll" }, [inner]);
    var frame = h("div", { class: "rs-frame" }, [scroller]);
    var el = h("div", { class: "rs" + (interactive ? " interactive" : "") }, [frame]);
    scroller.addEventListener("scroll", function () { sx = scroller.scrollLeft; sy = scroller.scrollTop; });

    var slider = null, zoomLabel = null, controls = null;
    if (o.controls !== false) {
      slider = h("input", { type: "range", class: "rs-slider", min: "-1000", max: "1000", step: "1", value: "0", "aria-label": "Size of the red picture" });
      slider.addEventListener("input", function () { setQ(Math.exp(+slider.value / 1000 * LOGMAX), true, true); });
      ["pointerdown", "touchstart"].forEach(function (ev) { slider.addEventListener(ev, function () { busy(true); }, { passive: true }); });
      ["pointerup", "pointercancel", "touchend", "touchcancel", "change", "blur"].forEach(function (ev) { slider.addEventListener(ev, function () { busy(false); }); });
      zoomLabel = h("span", { class: "rs-zoom-label", text: "1×" });
      // Zoom buttons sit on the picture, so the size slider and Lock in fit on a phone screen.
      frame.appendChild(h("div", { class: "rs-zoom" }, [
        h("button", { type: "button", "aria-label": "Zoom out", text: "−", onclick: function () { setZoom(zoom - 1); } }),
        zoomLabel,
        h("button", { type: "button", "aria-label": "Zoom in", text: "+", onclick: function () { setZoom(zoom + 1); } })
      ]));
      controls = h("div", { class: "rs-controls" }, [
        h("div", { class: "rs-size" }, [
          h("button", { class: "pin-zoom", type: "button", "aria-label": "Smaller", text: "−", onclick: function () { if (canUse()) setQ(q / 1.02, true); } }),
          h("div", { class: "rs-slider-wrap" }, [slider, h("div", { class: "rs-slider-labels" }, [h("span", { text: "◀ Smaller" }), h("span", { text: "Bigger ▶" })])]),
          h("button", { class: "pin-zoom", type: "button", "aria-label": "Bigger", text: "+", onclick: function () { if (canUse()) setQ(q * 1.02, true); } })
        ])
      ]);
      el.appendChild(controls);
    }
    function canUse() { return interactive && !locked; }
    function aspect(p) { return p && p.w && p.h ? p.w / p.h : 0.7; }
    function setQ(v, fromUser, fromSlider) {
      q = Math.max(1 / WQ.RESIZE_MAX, Math.min(WQ.RESIZE_MAX, v));
      if (slider && !fromSlider) slider.value = String(Math.round(Math.log(q) / LOGMAX * 1000));
      layout();
      if (fromUser && o.onChange) o.onChange(q);
    }
    function layout() {
      var W = Math.max(120, Math.min(el.clientWidth || 340, o.maxW ? o.maxW() : 1e6));
      var H = Math.max(100, o.maxH ? o.maxH() : W * 0.9);
      scroller.style.width = W + "px"; scroller.style.height = H + "px";
      var ab = aspect(o.fixed), ar = aspect(o.moving);
      // At the reveal, the right size (gold) stands next to the player's own (red).
      var g = ghost || 0, top = Math.max(1, q, g), gap = W * 0.06, pad = 10;
      var units = ab + ar * q + (g ? ar * g : 0), gaps = gap * (g ? 2 : 1);
      var k = Math.min((H - pad * 2) * 0.94 / top, (W * 0.94 - gaps) / units);
      var K = k * zoom, G = gap * zoom, Wz = W * zoom, Hz = H * zoom;
      inner.style.width = Wz + "px"; inner.style.height = Hz + "px";
      var groundY = Hz - pad;
      var x0 = (Wz - (K * units + G * (g ? 2 : 1))) / 2;
      place(fixedEl, x0, groundY, K * ab, K);
      var xr = x0 + K * ab + G;
      place(movingEl, xr, groundY, K * ar * q, K * q);
      ghostEl.hidden = !g;
      if (g) place(ghostEl, xr + K * ar * q + G, groundY, K * ar * g, K * g);
      ground.style.top = groundY + "px";
      scroller.classList.toggle("zoomed", zoom > 1);
      if (zoom > 1) {
        if (zoomed) { scroller.scrollLeft = (xr + K * ar * q / 2) - W / 2; scroller.scrollTop = Hz - H; zoomed = false; }
        else { scroller.scrollLeft = sx; scroller.scrollTop = sy; }
      }
    }
    function place(e, x, groundY, w, ht) {
      e.style.left = x + "px"; e.style.top = (groundY - ht) + "px";
      e.style.width = Math.max(0.5, w) + "px"; e.style.height = Math.max(0.5, ht) + "px";
    }
    function setZoom(z) {
      z = Math.max(1, Math.min(4, z));
      if (z === zoom) return;
      zoom = z; zoomed = true;
      if (zoomLabel) zoomLabel.textContent = zoom + "×";
      layout();
    }
    function setState() {
      el.classList.toggle("locked", locked);
      if (slider) slider.disabled = !canUse();
      if (controls) controls.querySelectorAll(".rs-size button").forEach(function (b) { b.disabled = !canUse(); });
    }
    window.addEventListener("resize", function () { if (el.isConnected) layout(); });
    setState();
    return {
      el: el,
      refresh: layout,
      setPics: function (fixed, moving) {
        if (fixed) { o.fixed = fixed; setMask(fixedEl, srcOf(fixed)); }
        if (moving) { o.moving = moving; setMask(movingEl, srcOf(moving)); setMask(ghostEl, srcOf(moving)); }
      },
      getScale: function () { return q; },
      setScale: function (v) { setQ(v, false); },
      setLocked: function (b) { locked = !!b; setState(); },
      setInteractive: function (b) { interactive = !!b; el.classList.toggle("interactive", interactive); setState(); },
      setGhost: function (v) { ghost = v || null; layout(); },
      hideControls: function () { if (controls) controls.hidden = true; }
    };
  };

  // The big-screen strip of everyone's resize guesses: too small on the left, too big on the right.
  WQ.resizeStrip = function (guesses, right, level) {
    var lv = WQ.RESIZE_LEVELS[level] || WQ.RESIZE_LEVELS.medium, SPAN = Math.log(3);
    var pos = function (r) { return 50 + Math.max(-1, Math.min(1, Math.log(r) / SPAN)) * 46; };
    var band = h("div", { class: "rsx-band" });
    var lo = pos(1 / (1 + lv.full / 100)), hi = pos(1 + lv.full / 100);
    band.style.left = lo + "%"; band.style.width = (hi - lo) + "%";
    var dots = guesses.map(function (g, i) {
      var r = g / right, d = h("div", { class: "rsx-dot" + (Math.abs(Math.log(r)) > SPAN ? " out" : "") });
      d.style.left = pos(r) + "%";
      d.style.top = (18 + (i * 37) % 64) + "%";
      return d;
    });
    return h("div", { class: "rsx" }, [
      h("div", { class: "rsx-track" }, [band, h("div", { class: "rsx-mid" })].concat(dots)),
      h("div", { class: "rsx-labels" }, [h("span", { text: "◀ 3× too small" }), h("span", { text: "Spot on" }), h("span", { text: "3× too big ▶" })])
    ]);
  };
})();
