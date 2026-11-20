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
    requestAnimationFrame(function () { queued = false; draw(); });
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
    $("d-top-right").textContent = s.round && s.phase !== "end" ? "Round " + s.round + " of " + (s.totalRounds || g.meta.totalRounds) : "Game " + WQ.code;
    var main = WQ.clear($("d-main"));
    var fn = {
      lobby: drawLobby, topics: drawTopics, roundIntro: drawRoundIntro, question: drawQuestion, closed: drawQuestion,
      reveal: drawQuestion, roundEnd: drawRoundEnd, standings: drawStandings, end: drawEnd
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

  function drawEnd(main, s) {
    var f = s.final || { teams: [], players: [] };
    main.appendChild(h("h1", { class: "center", text: "Final results" }));
    main.appendChild(h("div", { style: { display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "4vw", marginTop: "2vh" } }, [
      h("div", null, [
        h("h2", { text: "Teams" }),
        h("table", { class: "final-table" }, WQ.arr(f.teams).map(function (t, i) {
          return h("tr", null, [h("td", { text: (i + 1) + ". " + t.name + (i === 0 ? "  🏆" : "") }), h("td", { class: "num", text: WQ.fmt(t.points) })]);
        }))
      ]),
      h("div", null, [
        h("h2", { text: "Top 5 players" }),
        h("table", { class: "final-table" }, WQ.arr(f.players).map(function (p, i) {
          return h("tr", null, [h("td", { text: (i + 1) + ". " + p.name }), h("td", { class: "num", text: WQ.fmt(p.points) })]);
        }))
      ])
    ]));
  }

  WQ.init().then(start).catch(function (e) { message((e && e.message) || String(e)); });
})();
