// Work Quiz – big-screen display. Shows only what everyone is allowed to see.
(function () {
  "use strict";
  var $ = WQ.$, h = WQ.h;
  var g = { meta: null, state: null, players: {}, assign: {} };
  var timer = { qid: null, bar: null, stop: null };
  var picCache = {}, picLoading = {}, boardCache = { key: null, board: null }, fullCache = { key: null, board: null };
  var ptimer = { key: null, bar: null, stop: null };

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
    WQ.listen("pics", function (v) {
      v = v || {};
      Object.keys(v).forEach(function (id) {
        var p = v[id];
        if (!p || !p.data || picCache[id] || picLoading[id]) return;
        picLoading[id] = true;
        var im = new Image();
        im.onload = function () { delete picLoading[id]; picCache[id] = { data: p.data, w: p.w, h: p.h }; render(); };
        im.onerror = function () { delete picLoading[id]; };
        im.src = p.data;
      });
      Object.keys(picCache).forEach(function (id) { if (!v[id] && !(g.state && (g.state.qid === id || g.state.qid + "f" === id))) delete picCache[id]; });
    });
  }

  function picSource(pic) {
    if (!pic) return null;
    if (pic.src) return { src: pic.src, w: pic.w, h: pic.h };
    var c = picCache[pic.id];
    return { data: c ? c.data : null, w: pic.w, h: pic.h };
  }
  function boardFor(s) {
    var q = s.question || {};
    if (boardCache.key === s.qid && boardCache.board) return boardCache.board;
    var isPin = q.kind === "pin";
    var board = WQ.pinBoard({ pic: picSource(q.pic), marker: q.marker || "pin",
      maxH: function () { return window.innerHeight * (isPin ? 0.74 : 0.3); },
      maxW: function () { return window.innerWidth * (isPin ? 0.58 : 0.8); } });
    boardCache = { key: s.qid, board: board };
    return board;
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
      preview: drawQuestion, ready: drawQuestion,
      reveal: drawQuestion, roundEnd: drawRoundEnd, standings: drawStandings, final: drawFinal,
      picks: drawPicks, steal: drawSteal, stealReveal: drawStealReveal
    }[s.phase] || drawLobby;
    fn(main, s);
    if (s.phase !== "question" && timer.stop) { timer.stop(); timer.stop = null; timer.qid = null; }
    if (s.phase !== "preview" && ptimer.stop) { ptimer.stop(); ptimer.stop = null; ptimer.key = null; }
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
      return h("div", null, [h("span", { class: "num", text: rd.num }), rd.topic, " ", h("span", { class: "pill", text: rd.type === "pin" ? "📍 " + WQ.TYPE_LABEL.pin : WQ.MODE_LABEL[rd.mode] })]);
    })));
  }

  function drawRoundIntro(main, s) {
    var help = s.type === "pin" ? "A picture appears with something to find or put back. Tap where it belongs on your phone, drag to adjust, then press Lock in. The closer and quicker, the more points. The first teammate to lock in sets the team's pin, so agree first!"
      : s.mode !== "agree" ? "The first tap in each team locks in the team's answer, so talk it through before anyone taps! Everyone answers for their own score too."
      : "Each team's answer locks in when everyone picks the same option. If time runs out, the captain's pick counts for half points.";
    main.appendChild(h("div", { class: "center" }, [
      h("h2", { text: "Round " + s.round }),
      h("h1", { style: { fontSize: "4em" }, text: s.roundTopic }),
      h("p", null, [h("span", { class: "pill", style: { fontSize: "1em" }, text: s.type === "pin" ? "📍 " + WQ.TYPE_LABEL.pin + " · " + WQ.MODE_LABEL.first : WQ.MODE_LABEL[s.mode] })]),
      h("p", { class: "muted", style: { maxWidth: "40em", margin: "2vh auto 0" }, text: help }),
      s.practice ? h("p", { class: "gold-text", style: { fontSize: "1.2em", marginTop: "2vh" }, text: "First, a practice with a donkey. It doesn't count!" }) : null
    ]));
  }

  function questionTimer(s) {
    if (timer.qid !== s.qid || timer.start !== s.startAt) {
      if (timer.stop) timer.stop();
      timer.qid = s.qid;
      timer.start = s.startAt;
      timer.bar = WQ.timerBar();
      timer.stop = typeof s.startAt === "number" ? WQ.countdown(s.startAt, s.seconds, timer.bar.update) : null;
    }
    return timer.bar;
  }

  // After studying: everyone answers Ready? on their phone.
  function drawReady(main, s) {
    var yes = s.readyYes || 0, no = s.readyNo || 0, of = s.readyOf || 0, waiting = Math.max(0, of - yes - no);
    main.appendChild(h("div", { class: "center" }, [
      h("div", { class: "muted", text: s.roundTopic + " · Question " + s.qNum + " of " + s.qCount }),
      h("h1", { style: { fontSize: "5em", margin: ".2em 0" }, text: "Ready?" }),
      h("h2", { text: "Answer Yes or No on your phone" }),
      h("div", { class: "ready-tally" }, [
        h("span", { class: "ready-chip yes", text: "✓ " + yes + " ready" }),
        h("span", { class: "ready-chip no", text: "✗ " + no + " not ready" }),
        h("span", { class: "ready-chip", text: waiting + " still to answer" })
      ]),
      h("p", { class: "muted", style: { marginTop: "3vh" }, text: "If more than half say no, the picture can be shown again." })
    ]));
  }

  function drawPinQuestion(main, s) {
    var q = s.question, live = s.phase === "question", reveal = s.phase === "reveal";
    var looking = s.phase === "preview";
    if (s.phase === "ready") return drawReady(main, s);
    var left = h("div", null, [
      h("div", { class: "muted", style: { marginBottom: "1vh" }, text: s.roundTopic + " · " + (s.practice ? "Practice (doesn't count)" : "Question " + s.qNum + " of " + s.qCount) }),
      h("div", { class: "question-text", text: q.text })
    ]);
    if (looking) {
      var key = s.qid + ":" + s.studyRound;
      if (ptimer.key !== key) {
        if (ptimer.stop) ptimer.stop();
        ptimer.key = key;
        ptimer.bar = WQ.timerBar();
        ptimer.bar.classList.add("look");
        ptimer.stop = typeof s.startAt === "number" ? WQ.countdown(s.startAt, q.showFor || WQ.SHOW_FOR, ptimer.bar.update) : null;
      }
      left.appendChild(h("div", { class: "look-banner", text: s.studyRound > 1 ? "👀 Here it is again. Study it carefully!" : "👀 Study the picture! Something is about to disappear…" }));
      left.appendChild(ptimer.bar);
    } else if (live) {
      left.appendChild(questionTimer(s));
      left.appendChild(h("div", { class: "locked", text: "Teams locked in: " + (s.lockedCount || 0) + " of " + (s.teamCount || 0) }));
      left.appendChild(h("p", { class: "muted", style: { marginTop: "2vh" }, text: "Place your pin on your phone, then press Lock in." }));

    } else if (s.phase === "closed") {
      left.appendChild(h("div", { class: "locked", text: "Time's up!" }));
    } else if (reveal) {
      var dots = WQ.arr(s.dots), bulls = s.bulls || 0;
      left.appendChild(h("div", { class: "pin-stats", text: dots.length + (dots.length === 1 ? " pin" : " pins") + (bulls ? " · 🎯 " + bulls + (bulls === 1 ? " bullseye" : " bullseyes") : "") }));
      left.appendChild(h("p", { class: "muted", text: "The gold ring is the right spot. Check your phone for your points." }));
    }
    var board;
    if (looking) {
      if (fullCache.key !== s.qid) fullCache = { key: s.qid, board: WQ.pinBoard({ pic: picSource(q.full),
        maxH: function () { return window.innerHeight * 0.74; }, maxW: function () { return window.innerWidth * 0.58; } }) };
      board = fullCache.board;
      var fsrc = picSource(q.full);
      if (fsrc) board.setSrc(fsrc.data || fsrc.src);
    } else {
      board = boardFor(s);
      var src = picSource(reveal && q.full ? q.full : q.pic);
      if (src) board.setSrc(src.data || src.src);
      if (reveal && s.correctPin) board.setReveal({ target: s.correctPin, dots: WQ.arr(s.dots), level: q.level, markerAtTarget: !q.full });
    }
    main.appendChild(h("div", { class: "pin-layout" }, [left, h("div", null, [board.el])]));
    board.refresh();
  }

  function drawQuestion(main, s) {
    var q = s.question || { text: "", options: [] };
    if (q.kind === "pin") return drawPinQuestion(main, s);
    var live = s.phase === "question", reveal = s.phase === "reveal";
    main.appendChild(h("div", { class: "muted", style: { marginBottom: "1vh" },
      text: s.roundTopic + " · Question " + s.qNum + " of " + s.qCount + " · " + WQ.MODE_LABEL[s.mode] }));
    main.appendChild(h("div", { class: "question-text", text: q.text }));
    if (live) main.appendChild(questionTimer(s));
    if (q.pic) {
      var board = boardFor(s), src = picSource(q.pic);
      if (src) board.setSrc(src.data || src.src);
      main.appendChild(h("div", { class: "pic-above" }, [board.el]));
      board.refresh();
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

  // ---------- Doubles, poison and steals ----------
  function activeTeamIds() { return teamIds().filter(function (t) { return membersOf(t).length > 0; }); }
  function statusGrid(s) {
    var sub = s.submitted || {};
    return h("div", { class: "status-chips" }, activeTeamIds().map(function (t) {
      return h("span", { class: "status-chip" + (sub[t] ? " done" : "") }, [(sub[t] ? "✓ " : "⏳ ") + teamName(t)]);
    }));
  }
  function ruleCard(icon, title, text) {
    return h("div", { class: "rule-card" }, [h("div", { class: "rule-icon", text: icon }), h("h3", { text: title }), h("p", { text: text })]);
  }
  function halfTableEl(st) {
    return h("div", { class: "half-table" }, [
      h("div", { class: "label", text: "Top half" }),
      h("div", { class: "half" }, WQ.arr(st.top).map(function (n) { return h("span", { class: "team-chip", text: n }); })),
      h("div", { class: "divider" }),
      h("div", { class: "half" }, WQ.arr(st.bottom).map(function (n) { return h("span", { class: "team-chip", text: n }); })),
      h("div", { class: "label", text: "Bottom half" })
    ]);
  }

  function drawPicks(main, s) {
    main.appendChild(h("h1", { class: "center", text: "Captains: choose your rounds" }));
    main.appendChild(h("div", { class: "rules-row" }, [
      ruleCard("×2", "Double", "One round that counts twice at the end. It can still be stolen!"),
      ruleCard("☠", "Poison", "Five rounds that bite back: a team that tries to steal one loses those points."),
      ruleCard("🎁", "Steal", "After round 9, every team must steal one round from another team.")
    ]));
    main.appendChild(h("div", { class: "topics compact" }, roundsList().filter(function (rd) { return rd.num <= WQ.DPS_ROUNDS; }).map(function (rd) {
      return h("div", null, [h("span", { class: "num", text: rd.num }), rd.topic]);
    })));
    main.appendChild(statusGrid(s));
  }

  function drawSteal(main, s) {
    main.appendChild(h("h1", { class: "center", text: "🎁 Steal time!" }));
    main.appendChild(h("p", { class: "center muted", style: { maxWidth: "46em", margin: "0 auto 2vh", fontSize: "1.1em" },
      text: "Captains: pick another team and one of their rounds (1–9). If it was poisoned, you lose those points. If not, you take them, doubled if it was their double round!" }));
    if (s.standings) main.appendChild(halfTableEl(s.standings));
    main.appendChild(statusGrid(s));
  }

  function drawStealReveal(main, s) {
    var shown = s.shown || {}, n = s.count || 0, cur = shown["s" + (s.last || 0)];
    if (!cur) {
      main.appendChild(h("div", { class: "center" }, [
        h("h1", { style: { fontSize: "4em" }, text: "The steals" }),
        h("h2", { class: "muted", text: n + (n === 1 ? " steal" : " steals") + " to reveal. Who chose wisely?" })
      ]));
      return;
    }
    var outcome = cur.outcome === "poison" ? h("div", { class: "outcome poison", text: "☠ POISONED!" })
      : cur.outcome === "stolen" ? h("div", { class: "outcome stolen", text: "💰 STOLEN!" })
      : h("div", { class: "outcome waiting", text: "…" });
    main.appendChild(h("div", { class: "center steal-card" }, [
      h("div", { class: "muted", text: "Steal " + cur.n + " of " + n }),
      h("h1", { text: cur.thief }),
      h("p", { class: "muted", style: { fontSize: "1.3em", margin: ".2em 0" }, text: "are stealing from" }),
      h("h1", { text: cur.target }),
      h("p", { style: { fontSize: "1.5em", fontWeight: "800" }, text: "Round " + cur.round + ": " + cur.topic }),
      outcome
    ]));
    var past = [];
    for (var k = 1; k <= n; k++) {
      var x = shown["s" + k];
      if (x && k !== s.last && x.outcome) past.push(h("div", { class: "past-steal" }, [
        x.thief + " → " + x.target + ", R" + x.round + ": ", h("strong", { text: x.outcome === "poison" ? "☠ poisoned" : "💰 stolen" })
      ]));
    }
    if (past.length) main.appendChild(h("div", { class: "past-steals" }, past));
  }

  function drawDoublesSummary(main, s) {
    var d = (s.shown && s.shown.doubles) || {};
    main.appendChild(h("h1", { class: "center", text: "×2 Double rounds revealed" }));
    main.appendChild(h("div", { class: "teams-grid", style: { marginTop: "3vh" } }, Object.keys(d).filter(function (k) { return k !== "none"; }).map(function (k) {
      var x = d[k];
      return h("div", { class: "team-card summary-card" }, [
        h("h3", { text: x.team }),
        h("div", { class: "names", text: x.round ? "Round " + x.round + ": " + x.topic : "No double round" }),
        h("div", { class: "summary-pts gain", text: "+" + WQ.fmt(x.bonus) })
      ]);
    })));
  }

  function drawStealsSummary(main, s) {
    var d = (s.shown && s.shown.steals) || {};
    var rows = Object.keys(d).filter(function (k) { return k !== "none"; }).map(function (k) { return d[k]; })
      .sort(function (a, b) { return a.n - b.n; });
    main.appendChild(h("h1", { class: "center", text: "🎁 The steals: points won and lost" }));
    main.appendChild(h("div", { class: "reveal-list" }, rows.map(function (x) {
      var poison = x.outcome === "poison";
      return h("div", { class: "reveal-row shown steal-row" }, [
        h("span", { class: "place", text: poison ? "☠" : "💰" }),
        h("span", { class: "who", text: x.thief + " → " + x.target + " · R" + x.round + " (" + x.topic + ")" }),
        h("span", { class: "pts " + (poison ? "loss" : "gain"), text: (poison ? "−" : "+") + WQ.fmt(x.points) })
      ]);
    })));
    if (rows.some(function (x) { return x.outcome === "stolen"; })) {
      main.appendChild(h("p", { class: "center muted", style: { marginTop: "2vh" }, text: "Teams that were robbed lose those points (only once, even if more than one team stole the same round)." }));
    }
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

    if (!nP && !nT && last.kind === "steals" && shown.steals) return drawStealsSummary(main, s);
    if (!nP && !nT && last.kind === "doubles" && shown.doubles) return drawDoublesSummary(main, s);
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
