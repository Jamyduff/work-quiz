// Work Quiz – the picture board used by pin questions (and pictures above multiple-choice questions).
// Positions are always % across (x) and % down (y) the picture, so they mean the same on every screen size.
(function () {
  "use strict";
  var h = WQ.h;

  // Markers players place. ax/ay is the point of the marker that sits on the spot (0–1 of its width/height);
  // size is its width as a % of the picture's width.
  var MARKERS = {
    pin: { ax: 0.5, ay: 1, size: 6.5, svg:
      '<svg viewBox="0 0 24 34" xmlns="http://www.w3.org/2000/svg"><path d="M12 1C5.9 1 1 5.9 1 12c0 8.6 11 21 11 21s11-12.4 11-21C23 5.9 18.1 1 12 1z" fill="currentColor" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="4.2" fill="#fff"/></svg>' },
    tail: { ax: 0.133, ay: 0.036, size: 10.5, svg:
      '<svg viewBox="0 0 120 330" xmlns="http://www.w3.org/2000/svg"><path d="M16 12 C55 55 72 130 62 215" stroke="#8a9199" stroke-width="17" fill="none" stroke-linecap="round"/><path d="M48 196 C24 236 30 292 60 324 C90 292 96 236 74 196 C66 208 56 208 48 196 Z" fill="#4a4f56"/><path d="M58 230 C56 260 58 285 62 305" stroke="#353a40" stroke-width="4" fill="none" stroke-linecap="round"/></svg>' },
    carrot: { ax: 0.02, ay: 0.5, size: 12, svg:
      '<svg viewBox="0 0 140 60" xmlns="http://www.w3.org/2000/svg"><path d="M4 14 C40 8 100 22 136 30 C100 38 40 52 4 46 C-2 36 -2 24 4 14 Z" fill="#f0812a"/><g stroke="#c95f12" stroke-width="3" stroke-linecap="round"><line x1="34" y1="18" x2="40" y2="28"/><line x1="62" y1="22" x2="66" y2="32"/><line x1="88" y1="26" x2="92" y2="33"/><line x1="48" y1="44" x2="52" y2="36"/></g></svg>' },
    earth: { ax: 0.5, ay: 0.5, size: 14, svg:
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="eg" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#6fb1ff"/><stop offset="1" stop-color="#1b4fa8"/></radialGradient><clipPath id="ec"><circle cx="50" cy="50" r="47"/></clipPath></defs><circle cx="50" cy="50" r="47" fill="url(#eg)"/><g clip-path="url(#ec)" fill="#4f9d4a"><path d="M18 30c8-8 22-10 28-4 4 4-2 10 2 16s-6 10-12 8-8-8-14-8-10-6-4-12z"/><path d="M58 18c10 0 20 6 22 14s-6 8-10 6-6 4-10 2-8-6-6-12 0-10 4-10z"/><path d="M50 58c8-2 16 4 16 12s-6 16-12 18-8-6-8-12-4-16 4-18z"/></g><g clip-path="url(#ec)" fill="#fff" opacity=".75"><path d="M10 50c10-4 20 0 30-2s16-6 22-4c-8 4-18 8-28 8s-18 2-24-2z"/><path d="M52 34c8-2 16 0 26-2-6 4-14 6-26 2z"/></g><circle cx="50" cy="50" r="47" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/></svg>' }
  };
  WQ.MARKERS = MARKERS;
  WQ.markerName = function (s) {
    var k = String(s || "").trim().toLowerCase();
    return MARKERS[k] ? k : null;
  };

  // A "busy" flag so screens don't redraw while someone is dragging their pin.
  WQ.pinBusy = false;
  var afterBusy = [];
  WQ.whenPinIdle = function (fn) { if (!WQ.pinBusy) fn(); else if (afterBusy.indexOf(fn) < 0) afterBusy.push(fn); };
  function setBusy(b) {
    WQ.pinBusy = b;
    if (!b) { var list = afterBusy; afterBusy = []; list.forEach(function (f) { f(); }); }
  }

  function markerEl(kind, cls, label) {
    var m = MARKERS[kind] || MARKERS.pin;
    var el = h("div", { class: "pin-marker " + (cls || "") });
    el.style.width = m.size + "%";
    el.style.transform = "translate(" + (-m.ax * 100) + "%," + (-m.ay * 100) + "%)";
    var art = h("div", { class: "pin-art" });
    art.innerHTML = m.svg;
    el.appendChild(art);
    if (label) el.appendChild(h("span", { class: "pin-label", text: label }));
    // Position of the anchor inside the marker box, for the grab handle and the label
    el.style.setProperty("--ax", (m.ax * 100) + "%");
    el.style.setProperty("--ay", (m.ay * 100) + "%");
    return el;
  }
  function place(el, p) { el.style.left = p.x + "%"; el.style.top = p.y + "%"; }

  // o: { pic: {src or data, w, h}, marker, interactive, zoom, maxW(), maxH(), onChange(pin) }
  WQ.pinBoard = function (o) {
    var pic = o.pic || { w: 4, h: 3 };
    var aspect = (pic.w || 4) / (pic.h || 3);
    var zoom = 1, pin = null, locked = false, interactive = !!o.interactive, curSrc = null;
    var sx = 0, sy = 0;
    var img = h("img", { class: "pin-img", alt: "", draggable: "false" });
    var loading = h("div", { class: "pin-loading", text: "Loading picture…" });
    var layer = h("div", { class: "pin-layer" });
    var inner = h("div", { class: "pin-inner" }, [img, layer, loading]);
    var scroller = h("div", { class: "pin-scroll" }, [inner]);
    var el = h("div", { class: "pin-board" + (interactive ? " interactive" : "") }, [scroller]);
    var own = null, team = null, extra = [], revealEls = null, revealStart = 0;
    var zoomLabel = null;

    img.addEventListener("load", function () { loading.hidden = true; });
    img.addEventListener("error", function () { loading.hidden = false; loading.textContent = "The picture didn't load."; });
    scroller.addEventListener("scroll", function () { sx = scroller.scrollLeft; sy = scroller.scrollTop; });

    function setSrc(src) {
      if (!src || src === curSrc) return;
      curSrc = src;
      loading.hidden = false; loading.textContent = "Loading picture…";
      img.src = src;
    }
    setSrc(pic.data || pic.src || null);

    // ---------- sizing ----------
    function layout() {
      var availW = el.clientWidth || 360;
      if (o.maxW) availW = Math.min(availW, o.maxW());
      var maxH = o.maxH ? o.maxH() : 1e6;
      var bw = Math.max(120, Math.min(availW, maxH * aspect));
      scroller.style.width = bw + "px";
      scroller.style.height = (bw / aspect) + "px";
      inner.style.width = (bw * zoom) + "px";
      inner.style.height = (bw * zoom / aspect) + "px";
      scroller.classList.toggle("zoomed", zoom > 1);
    }
    function refresh() {
      layout();
      if (zoom > 1) { scroller.scrollLeft = sx; scroller.scrollTop = sy; }
      syncReveal();
    }
    window.addEventListener("resize", function () { if (el.isConnected) layout(); });

    // ---------- zoom ----------
    if (o.zoom) {
      zoomLabel = h("span", { class: "pin-zoom-label", text: "1×" });
      var tools = h("div", { class: "pin-tools" }, [
        h("button", { class: "pin-zoom", type: "button", "aria-label": "Zoom out", text: "−", onclick: function () { setZoom(zoom - 1); } }),
        zoomLabel,
        h("button", { class: "pin-zoom", type: "button", "aria-label": "Zoom in", text: "+", onclick: function () { setZoom(zoom + 1); } })
      ]);
      el.appendChild(tools);
    }
    function setZoom(z) {
      z = Math.max(1, Math.min(4, z));
      if (z === zoom) return;
      var vw = scroller.clientWidth, vh = scroller.clientHeight;
      // keep the pin (or the middle of the view) in the same place
      var fx, fy;
      if (pin) { fx = pin.x / 100; fy = pin.y / 100; }
      else { fx = (scroller.scrollLeft + vw / 2) / inner.offsetWidth; fy = (scroller.scrollTop + vh / 2) / inner.offsetHeight; }
      zoom = z;
      layout();
      scroller.scrollLeft = sx = Math.max(0, fx * inner.offsetWidth - vw / 2);
      scroller.scrollTop = sy = Math.max(0, fy * inner.offsetHeight - vh / 2);
      if (zoomLabel) zoomLabel.textContent = zoom + "×";
    }

    // ---------- placing and dragging ----------
    function pointToPin(e) {
      var r = inner.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width * 100, y = (e.clientY - r.top) / r.height * 100;
      return { x: Math.round(Math.max(0, Math.min(100, x)) * 100) / 100, y: Math.round(Math.max(0, Math.min(100, y)) * 100) / 100 };
    }
    function drawOwn() {
      if (!pin) { if (own) { own.remove(); own = null; } return; }
      if (!own) {
        own = markerEl(o.marker, "own");
        own.appendChild(h("span", { class: "pin-handle" }));
        layer.appendChild(own);
      }
      own.classList.toggle("locked", locked);
      own.classList.toggle("grab", interactive && !locked);
      place(own, pin);
    }
    var tap = null, drag = null, loupe = null;
    function canEdit() { return interactive && !locked; }
    scroller.addEventListener("pointerdown", function (e) {
      if (!canEdit() || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (own && own.contains(e.target)) {
        e.preventDefault();
        drag = { id: e.pointerId, touch: e.pointerType !== "mouse" };
        try { scroller.setPointerCapture(e.pointerId); } catch (x) {}
        setBusy(true);
        moveTo(e);
        return;
      }
      tap = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    scroller.addEventListener("pointermove", function (e) {
      if (drag && e.pointerId === drag.id) { e.preventDefault(); moveTo(e); return; }
      if (tap && e.pointerId === tap.id && Math.abs(e.clientX - tap.x) + Math.abs(e.clientY - tap.y) > 10) tap = null;
    });
    function endDrag() {
      if (!drag) return;
      drag = null;
      if (loupe) { loupe.remove(); loupe = null; }
      setBusy(false);
      if (o.onChange) o.onChange(pin);
    }
    scroller.addEventListener("pointerup", function (e) {
      if (drag && e.pointerId === drag.id) return endDrag();
      if (tap && e.pointerId === tap.id && canEdit()) {
        pin = pointToPin(e);
        drawOwn();
        if (o.onChange) o.onChange(pin);
      }
      tap = null;
    });
    scroller.addEventListener("pointercancel", function () { tap = null; endDrag(); });
    function moveTo(e) {
      pin = pointToPin(e);
      drawOwn();
      if (drag && drag.touch && curSrc) showLoupe(e);
    }
    function showLoupe(e) {
      var Z = 2.5, S = 120;
      if (!loupe) {
        loupe = h("div", { class: "pin-loupe" });
        loupe.style.backgroundImage = "url(\"" + curSrc.replace(/"/g, "%22") + "\")";
        document.body.appendChild(loupe);
      }
      var w = inner.offsetWidth * Z, ht = inner.offsetHeight * Z;
      loupe.style.backgroundSize = w + "px " + ht + "px";
      loupe.style.backgroundPosition = (-(pin.x / 100 * w - S / 2)) + "px " + (-(pin.y / 100 * ht - S / 2)) + "px";
      var top = e.clientY - S - 70;
      if (top < 6) top = e.clientY + 60;
      loupe.style.left = Math.max(6, Math.min(innerWidth - S - 6, e.clientX - S / 2)) + "px";
      loupe.style.top = top + "px";
    }

    // ---------- reveal ----------
    // target: {x,y}; dots: [{x,y}]; level: "easy|medium|hard"; markerAtTarget: show the marker art at the right spot
    function setReveal(r) {
      if (revealEls) return;
      revealEls = [];
      revealStart = performance.now();
      var dots = r.dots || [];
      var step = dots.length ? Math.min(70, 1800 / dots.length) : 0;
      dots.forEach(function (d, i) {
        var dot = h("div", { class: "pin-dot pin-pop" + (d.mine ? " mine" : "") });
        place(dot, d);
        dot.dataset.delay = Math.round(i * step);
        layer.appendChild(dot);
        revealEls.push(dot);
      });
      var lv = WQ.PIN_LEVELS[r.level] || WQ.PIN_LEVELS.medium;
      var ring = h("div", { class: "pin-ring pin-pop" });
      ring.style.width = (lv.full * 2) + "%";
      ring.style.height = (lv.full * 2 * aspect) + "%";
      place(ring, r.target);
      ring.dataset.delay = Math.round(dots.length * step + 300);
      layer.appendChild(ring);
      revealEls.push(ring);
      var star = r.markerAtTarget && o.marker && o.marker !== "pin" ? markerEl(o.marker, "target-art pin-pop") : h("div", { class: "pin-target pin-pop" });
      place(star, r.target);
      star.dataset.delay = ring.dataset.delay;
      layer.appendChild(star);
      revealEls.push(star);
      syncReveal();
    }
    // Keeps the reveal animation running smoothly even when the screen redraws mid-animation.
    function syncReveal() {
      if (!revealEls) return;
      var t = performance.now() - revealStart;
      revealEls.forEach(function (e) {
        var d = parseInt(e.dataset.delay || "0", 10);
        if (t > d + 700) { e.classList.remove("pin-pop"); e.style.animationDelay = ""; }
        else e.style.animationDelay = (d - t) + "ms";
      });
    }

    // Other pins: the team's pin on phones, or every team's pin on the quiz master screen.
    function setOthers(list) {
      extra.forEach(function (e) { e.remove(); });
      extra = (list || []).map(function (p) {
        var m = markerEl(p.marker || "pin", "other " + (p.cls || ""), p.label);
        if (p.color) m.style.color = p.color;
        place(m, p);
        layer.appendChild(m);
        return m;
      });
    }

    return {
      el: el,
      refresh: refresh,
      setSrc: setSrc,
      setPin: function (p) { pin = p ? { x: p.x, y: p.y } : null; drawOwn(); },
      getPin: function () { return pin; },
      setLocked: function (b) { locked = !!b; el.classList.toggle("locked", locked); drawOwn(); },
      setInteractive: function (b) { interactive = !!b; el.classList.toggle("interactive", interactive); drawOwn(); },
      setOthers: setOthers,
      setReveal: setReveal,
      revealed: function () { return !!revealEls; },
      busy: function () { return !!drag; }
    };
  };
})();
