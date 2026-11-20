// Work Quiz – big-screen display. Shows only what everyone is allowed to see.
(function () {
  "use strict";
  var $ = WQ.$, h = WQ.h;
  var g = { meta: null, state: null, players: {}, assign: {} };
  var timer = { qid: null, bar: null, stop: null };

  $("d-full").addEventListener("click", function () {
    var el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen();
  });
  document.addEventListener("fullscreenchange", function () { $("d-full").hidden = !!document.fullscreenElement; });

  function message(text) {
    var m = WQ.clear($("d-main"));
    m.appendChild(h("h2", { text: text }));
  }

  function start() {
    var code = (WQ.param("g") || "").toUpperCase();
    if (!code) return message("Open this page from the quiz master screen (Open big screen).");
    WQ.code = code;
    WQ.watchConnection();
    WQ.listen("meta", function (v) {
      g.meta = v;
      if (!v) return message("There's no game with the code " + code + ".");
      setTheme(v.theme || "festive");
      render();
    });
    WQ.listen("state", function (v) { g.state = v || { phase: "lobby" }; render(); });
    WQ.listen("players", function (v) { g.players = v || {}; render(); });
    WQ.listen("assign", function (v) { g.assign = v || {}; render(); });
  }

  var queued = false;
  function render() {
    if (queued) return;
    queued = true;
    setTimeout(function () { queued = false; draw(); }, 16);
  }

  function teamIds() {
    var t = (g.meta && g.meta.teams) || {};
    return Object.keys(t).sort(function (a, b) { return (t[a].order || 0) - (t[b].order || 0); });
  }
  function teamName(tid) { return g.meta.teams[tid].name; }
  function nameOf(uid) { return g.players[uid] ? g.players[uid].name : ""; }
  function membersOf(tid) {
    return Object.keys(g.players).filter(function (uid) { return g.assign[uid] && g.assign[uid].team === tid; })
      .sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b)); });
  }
  function roundsList() {
    var r = (g.meta && g.meta.rounds) || {};
    return Object.keys(r).map(function (k) { return r[k]; }).sort(function (a, b) { return a.num - b.num; });
  }

  function draw() {
    if (!g.meta || !g.state) return;
    var s = g.state;
    $("d-top-left").textContent = g.meta.title || "Work Quiz";
    $("d-top-right").textContent = s.phase === "final" ? "Final results" : s.round ? "Round " + s.round + " of " + (s.totalRounds || g.meta.totalRounds) : "Game " + WQ.code;
    var main = WQ.clear($("d-main"));
    var fn = {
      lobby: drawLobby, topics: drawTopics, roundIntro: drawRoundIntro, question: drawQuestion, closed: drawQuestion,
      reveal: drawQuestion, roundEnd: drawRoundEnd, standings: drawStandings, final: drawFinal
    }[s.phase] || drawLobby;
    fn(main, s);
    if (s.phase !== "question" && timer.stop) { timer.stop(); timer.stop = null; timer.qid = null; }
  }

  function drawLobby(main) {
    var url = WQ.joinUrl(WQ.code);
    var qr = h("div", { class: "qr-box" });
    WQ.drawQr(qr, url);
    var n = Object.keys(g.players).length;
    var teamCards = teamIds().map(function (tid) {
      var m = membersOf(tid);
      return h("div", { class: "team-card" }, [
        h("h3", { text: teamName(tid) }),
        h("div", { class: "names", text: m.length ? m.map(nameOf).join(", ") : "–" })
      ]);
    });
    var waiting = Object.keys(g.players).filter(function (uid) { return !g.assign[uid] || !g.meta.teams[g.assign[uid].team]; }).map(nameOf).sort();
    main.appendChild(h("div", { class: "lobby" }, [
      qr,
      h("div", null, [
        h("h1", { text: "Join the quiz" }),
        h("p", { class: "muted", text: "Scan the code with your phone camera, or go to:" }),
        h("div", { class: "join-url", text: url.replace(/^https?:\/\//, "") }),
        h("p", { style: { marginTop: "2vh" } }, [h("span", { class: "pill", text: n + (n === 1 ? " person" : " people") + " joined" })]),
        waiting.length ? h("p", { class: "muted", text: "Waiting for a team: " + waiting.join(", ") }) : null
      ])
    ]));
    if (teamCards.length) main.appendChild(h("div", { class: "teams-grid" }, teamCards));
  }

  function drawTopics(main) {
    main.appendChild(h("h1", { text: "Tonight's rounds" }));
    main.appendChild(h("div", { class: "topics" }, roundsList().map(function (rd) {
      return h("div", null, [h("span", { class: "num", text: rd.num }), rd.topic, " ", h("span", { class: "pill", text: WQ.MODE_LABEL[rd.mode] })]);
    })));
  }

  function drawRoundIntro(main, s) {
    var help = s.mode !== "agree" ? "The first tap in each team locks in the team's answer, so talk it through before anyone taps! Everyone answers for their own score too."
      : "Each team's answer locks in when everyone picks the same option. If time runs out, the captain's pick counts for half points.";
    main.appendChild(h("div", { class: "center" }, [
      h("h2", { text: "Round " + s.round }),
      h("h1", { style: { fontSize: "4em" }, text: s.roundTopic }),
      h("p", null, [h("span", { class: "pill", style: { fontSize: "1em" }, text: WQ.MODE_LABEL[s.mode] })]),
      h("p", { class: "muted", style: { maxWidth: "40em", margin: "2vh auto 0" }, text: help })
    ]));
  }

  function drawQuestion(main, s) {
    var q = s.question || { text: "", options: [] };
    var live = s.phase === "question", reveal = s.phase === "reveal";
    main.appendChild(h("div", { class: "muted", style: { marginBottom: "1vh" },
      text: s.roundTopic + " · Question " + s.qNum + " of " + s.qCount + " · " + WQ.MODE_LABEL[s.mode] }));
    main.appendChild(h("div", { class: "question-text", text: q.text }));
    if (live) {
      if (timer.qid !== s.qid) {
        if (timer.stop) timer.stop();
        timer.qid = s.qid;
        timer.bar = WQ.timerBar();
        timer.stop = typeof s.startAt === "number" ? WQ.countdown(s.startAt, s.seconds, timer.bar.update) : null;
      }
      main.appendChild(timer.bar);
    }
    main.appendChild(h("div", { class: "opts" }, WQ.arr(q.options).map(function (text, i) {
      var L_ = WQ.LETTERS[i];
      var cls = "opt opt-" + L_.toLowerCase() + (reveal ? (s.correct === L_ ? " correct" : " dim") : "");
      return h("div", { class: cls }, [h("span", { class: "letter", text: L_ }), h("span", { class: "text", text: text })]);
    })));
    if (live) main.appendChild(h("div", { class: "locked center", text: "Teams locked in: " + (s.lockedCount || 0) + " of " + (s.teamCount || 0) }));
    else if (s.phase === "closed") main.appendChild(h("div", { class: "locked center", text: "Time's up!" }));
  }

  function drawRoundEnd(main, s) {
    main.appendChild(h("div", { class: "center" }, [
      h("h1", { text: "End of round " + s.round }),
      h("p", { class: "muted", style: { fontSize: "1.3em" }, text: "Check your phones to see how your team did." })
    ]));
  }

  function drawStandings(main, s) {
    var st = s.standings || { top: [], bottom: [] };
    main.appendChild(h("div", { class: "center" }, [
      h("h1", { text: "Standings after round " + s.round }),
      h("p", { class: "muted", text: "Teams are in alphabetical order, so nobody knows who's winning…" })
    ]));
    main.appendChild(h("div", { class: "half-table", style: { marginTop: "3vh" } }, [
      h("div", { class: "label", text: "Top half" }),
      h("div", { class: "half" }, WQ.arr(st.top).map(function (n) { return h("span", { class: "team-chip", text: n }); })),
      h("div", { class: "divider" }),
      h("div", { class: "half" }, WQ.arr(st.bottom).map(function (n) { return h("span", { class: "team-chip", text: n }); })),
      h("div", { class: "label", text: "Bottom half" })
    ]));
  }

  // ---------- Final reveal ----------
  var MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };
  function ordinal(n) { return n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]); }
  var celebrated = null;

  function drawFinal(main, s) {
    var counts = s.counts || { players: 0, teams: 0 };
    var shown = s.shown || {};
    var sp = shown.players || {}, st = shown.teams || {};
    var nT = Object.keys(st).length, nP = Object.keys(sp).length;
    var last = s.last || {};

    if (!nP && !nT) {
      main.appendChild(h("div", { class: "center" }, [
        h("div", { class: "festive-only big-emoji", text: "🎄" }),
        h("h1", { style: { fontSize: "4.2em" }, text: "Final results" }),
        h("h2", { class: "muted", text: "Time to find out who's top of the nice list…" })
      ]));
      return;
    }

    function playerRows(compact) {
      var rows = [];
      for (var place = 1; place <= counts.players; place++) {
        var r = sp["p" + place];
        var fresh = r && last.kind === "players" && last.place === place;
        rows.push(h("div", { class: "reveal-row" + (r ? " shown" : "") + (fresh ? " fresh" : "") + (place === 1 && r ? " winner" : "") }, [
          h("span", { class: "place", text: MEDAL[place] || ordinal(place) }),
          h("span", { class: "who", text: r ? r.name : "?" }),
          h("span", { class: "pts", text: r ? WQ.fmt(r.points) : "" })
        ]));
      }
      return h("div", { class: "reveal-list" + (compact ? " compact" : "") }, rows);
    }

    if (!nT) {
      main.appendChild(h("h1", { class: "center", text: "Top players" }));
      main.appendChild(playerRows(false));
      if (sp.p1 && last.kind === "players" && last.place === 1) {
        main.appendChild(h("p", { class: "center gold-text", style: { fontSize: "1.4em", marginTop: "2vh" }, text: "⭐ Top player: " + sp.p1.name + "! ⭐" }));
      }
      return;
    }

    // Team podium: 2nd, 1st, 3rd from left to right
    var order = [2, 1, 3].filter(function (p) { return p <= counts.teams; });
    var podium = h("div", { class: "podium" }, order.map(function (place) {
      var r = st["p" + place];
      var fresh = r && last.kind === "teams" && last.place === place;
      return h("div", { class: "podium-col place-" + place + (r ? " shown" : "") + (fresh ? " fresh" : "") }, [
        h("div", { class: "podium-name", text: r ? r.name : "?" }),
        h("div", { class: "podium-pts", text: r ? WQ.fmt(r.points) + " pts" : "" }),
        h("div", { class: "podium-block" }, [h("span", { text: MEDAL[place] }), h("span", { class: "podium-place", text: ordinal(place) })])
      ]);
    }));
    var winner = st.p1;
    main.appendChild(h("div", { class: "final-grid" }, [
      h("div", null, [
        h("h1", { class: "center", text: winner ? "🏆 " + winner.name + " win!" : "Team results" }),
        podium
      ]),
      counts.players ? h("div", null, [h("h2", { text: "Top players" }), playerRows(true)]) : null
    ]));
    if (winner && celebrated !== WQ.code) {
      celebrated = WQ.code;
      confetti();
    }
  }

  // ---------- Festive theme: fairy lights, snow and confetti ----------
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var snowOn = false, snowFlakes = [], snowRaf = null;

  function setTheme(theme) {
    var festive = theme !== "plain";
    document.body.classList.toggle("festive", festive);
    var lights = $("d-lights");
    if (festive && !lights.firstChild) {
      for (var i = 0; i < 36; i++) lights.appendChild(h("span", { class: "bulb b" + (i % 4), style: { animationDelay: (i * 0.37 % 3).toFixed(2) + "s" } }));
    }
    if (festive && !snowOn) startSnow();
    if (!festive && snowOn) stopSnow();
  }

  function sizeCanvas(c) {
    var dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    c.style.width = innerWidth + "px"; c.style.height = innerHeight + "px";
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function startSnow() {
    var c = $("d-snow"), ctx = c.getContext("2d");
    snowOn = true;
    sizeCanvas(c);
    var n = reduceMotion ? 25 : 90;
    snowFlakes = [];
    for (var i = 0; i < n; i++) snowFlakes.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      r: 1 + Math.random() * 3, vy: 0.3 + Math.random() * 0.9, sway: Math.random() * 6.28, a: 0.35 + Math.random() * 0.5 });
    function frame() {
      if (!snowOn) return;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      snowFlakes.forEach(function (f) {
        f.y += reduceMotion ? f.vy * 0.3 : f.vy;
        f.sway += 0.01;
        f.x += Math.sin(f.sway) * 0.4;
        if (f.y > innerHeight + 5) { f.y = -5; f.x = Math.random() * innerWidth; }
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283);
        ctx.fillStyle = "rgba(255,255,255," + f.a + ")"; ctx.fill();
      });
      snowRaf = requestAnimationFrame(frame);
    }
    frame();
  }
  function stopSnow() {
    snowOn = false;
    if (snowRaf) cancelAnimationFrame(snowRaf);
    var c = $("d-snow"); c.getContext("2d").clearRect(0, 0, c.width, c.height);
  }
  window.addEventListener("resize", function () { if (snowOn) sizeCanvas($("d-snow")); });

  function confetti() {
    var c = $("d-confetti"), ctx = c.getContext("2d");
    sizeCanvas(c);
    var colours = ["#f2c14e", "#d6453d", "#2c9a55", "#ffffff", "#2f6fd6"];
    var parts = [];
    for (var i = 0; i < (reduceMotion ? 60 : 220); i++) {
      parts.push({ x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3, y: innerHeight * 0.35,
        vx: (Math.random() - 0.5) * 14, vy: -6 - Math.random() * 10, w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3, col: colours[i % colours.length] });
    }
    var start = performance.now();
    function frame(t) {
      var age = t - start;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(function (p) {
        p.vy += 0.25; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - age / 6500);
        ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (age < 6500) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
    requestAnimationFrame(frame);
  }

  WQ.init().then(start).catch(function (e) { message((e && e.message) || String(e)); });
})();
