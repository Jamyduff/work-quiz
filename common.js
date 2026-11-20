// Work Quiz – code shared by the host, display and player screens.
(function () {
  "use strict";

  var WQ = window.WQ = {};

  // ---------- Scoring rules ----------
  WQ.POINTS_MAX = 1000;      // correct answer at the very first moment
  WQ.POINTS_MIN = 500;       // correct answer at the final second
  WQ.POINTS_TIMEOUT = 250;   // agreement round: time ran out, captain's pick was right
  WQ.GRACE_MS = 1500;        // answers arriving just after the timer still count
  WQ.STANDINGS_AFTER = [4, 9];
  WQ.LETTERS = ["A", "B", "C", "D"];
  WQ.MODE_LABEL = { captain: "Captain's call", agree: "Team agreement" };

  WQ.speedPoints = function (elapsedMs, totalMs) {
    var f = Math.min(1, Math.max(0, elapsedMs / totalMs));
    return Math.round(WQ.POINTS_MAX - (WQ.POINTS_MAX - WQ.POINTS_MIN) * f);
  };

  // Top half / bottom half standings. Odd number: middle team goes to the bottom.
  // Teams level on points at the line all go to the top. Each half is alphabetical.
  WQ.halfTable = function (teams) {
    var sorted = teams.slice().sort(function (a, b) { return b.points - a.points; });
    var k = Math.floor(sorted.length / 2);
    var top = [], bottom = [];
    if (k > 0) {
      var cutoff = sorted[k - 1].points;
      sorted.forEach(function (t) { (t.points >= cutoff ? top : bottom).push(t.name); });
    } else {
      bottom = sorted.map(function (t) { return t.name; });
    }
    var abc = function (a, b) { return a.localeCompare(b, undefined, { sensitivity: "base" }); };
    return { top: top.sort(abc), bottom: bottom.sort(abc) };
  };

  // ---------- Small helpers ----------
  WQ.$ = function (id) { return document.getElementById(id); };

  // Build DOM safely: WQ.h("div", {class: "x", onclick: fn}, ["text", childNode])
  WQ.h = function (tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
        else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return el;
  };

  // The database can hand lists back as objects ({0: .., 1: ..}); this always gives an array.
  WQ.arr = function (v) {
    if (Array.isArray(v)) return v.filter(function (x) { return x !== null && x !== undefined; });
    if (!v || typeof v !== "object") return [];
    return Object.keys(v).sort(function (a, b) { return Number(a) - Number(b); }).map(function (k) { return v[k]; });
  };

  WQ.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  WQ.show = function (id) {
    document.querySelectorAll("[data-screen]").forEach(function (s) { s.hidden = s.id !== id; });
  };

  WQ.store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  WQ.param = function (name) {
    var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  };

  WQ.baseUrl = function () {
    return location.origin + location.pathname.replace(/[^\/]*$/, "");
  };
  WQ.joinUrl = function (code) { return WQ.baseUrl() + "?g=" + code; };
  WQ.displayUrl = function (code) { return WQ.baseUrl() + "display.html?g=" + code; };

  WQ.fmt = function (n) { return (n || 0).toLocaleString("en-IE"); };

  WQ.drawQr = function (el, text) {
    try {
      var qr = window.QuizLib.qrcode(0, "M");
      qr.addData(text);
      qr.make();
      el.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch (e) { el.textContent = text; }
  };

  WQ.cleanName = function (s) {
    return String(s || "").replace(/\s+/g, " ").trim().slice(0, 24);
  };
  WQ.sameName = function (a, b) {
    return WQ.cleanName(a).toLocaleLowerCase() === WQ.cleanName(b).toLocaleLowerCase();
  };

  // ---------- Firebase ----------
  var L = window.QuizLib;
  WQ.offset = 0;
  WQ.now = function () { return Date.now() + WQ.offset; };

  WQ.init = function () {
    if (!window.FIREBASE_CONFIG || !L) return Promise.reject(new Error("The quiz files didn't load properly. Try refreshing."));
    var app = L.initializeApp(window.FIREBASE_CONFIG);
    WQ.db = L.getDatabase(app);
    WQ.auth = L.getAuth(app);
    L.onValue(L.ref(WQ.db, ".info/serverTimeOffset"), function (s) { WQ.offset = s.val() || 0; });
    return L.signInAnonymously(WQ.auth).then(function (cred) {
      WQ.uid = cred.user.uid;
      return WQ.uid;
    });
  };

  WQ.ref = function (path) {
    return L.ref(WQ.db, "games/" + WQ.code + (path ? "/" + path : ""));
  };
  WQ.listen = function (path, cb) {
    return L.onValue(WQ.ref(path), function (s) { cb(s.val()); }, function (err) {
      console.warn("Listen failed for " + path, err);
    });
  };

  // A small banner that appears when the connection drops.
  WQ.watchConnection = function () {
    var banner = WQ.h("div", { class: "conn-banner", hidden: true, text: "Connection lost – reconnecting…" });
    document.body.appendChild(banner);
    var everConnected = false;
    L.onValue(L.ref(WQ.db, ".info/connected"), function (s) {
      if (s.val() === true) { everConnected = true; banner.hidden = true; }
      else if (everConnected) banner.hidden = false;
    });
  };

  // ---------- Countdown ----------
  // Calls render(secondsLeft, fraction) about 10 times a second until stopped.
  WQ.countdown = function (startAt, seconds, render) {
    var total = seconds * 1000;
    function tick() {
      var left = Math.max(0, startAt + total - WQ.now());
      render(Math.ceil(left / 1000), left / total);
    }
    tick();
    var id = setInterval(tick, 100);
    return function stop() { clearInterval(id); };
  };

  WQ.timerBar = function () {
    var fill = WQ.h("div", { class: "timer-fill" });
    var num = WQ.h("div", { class: "timer-num" });
    var wrap = WQ.h("div", { class: "timer" }, [WQ.h("div", { class: "timer-track" }, [fill]), num]);
    wrap.update = function (secs, frac) {
      fill.style.width = (frac * 100).toFixed(1) + "%";
      num.textContent = secs;
      wrap.classList.toggle("urgent", secs <= 5);
    };
    return wrap;
  };

  // Sum a team's or player's per-question points, optionally for one round.
  WQ.sumPoints = function (qmap, round) {
    var total = 0;
    Object.keys(qmap || {}).forEach(function (qid) {
      var r = qmap[qid];
      if (!r) return;
      if (round && r.round !== round) return;
      total += r.points || 0;
    });
    return total;
  };
})();
