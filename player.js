// Work Quiz – player screen (phones and laptops).
(function () {
  "use strict";
  var L = window.QuizLib, $ = WQ.$, h = WQ.h;

  var g = { meta: null, state: null, players: {}, assign: {}, teamAnswers: {}, lock: null, results: null, pscores: null };
  var me = { team: null, captain: false };
  var subs = { answers: null, lock: null, results: null };
  var subKeys = { answers: null, lock: null, results: null };
  var timer = { qid: null, bar: null, stop: null };
  var flashMsg = "";

  function fatal(e) { $("fatal-msg").textContent = (e && e.message) || String(e); WQ.show("s-error"); }

  // ---------- Getting into a game ----------
  function start() {
    var code = (WQ.param("g") || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (!code) code = (WQ.store.get("wq-player-last") || "");
    if (!code) return askCode();
    enterGame(code);
  }

  function askCode(msg) {
    WQ.show("s-code");
    $("code-error").textContent = msg || "";
    $("code-input").focus();
  }
  $("code-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("code-input").value.toUpperCase().replace(/[^A-Z]/g, "");
    if (code.length !== 4) return askCode("The game code is 4 letters.");
    enterGame(code);
  });

  function enterGame(code) {
    WQ.code = code;
    L.get(WQ.ref("meta")).then(function (snap) {
      var meta = snap.val();
      if (!meta) {
        WQ.store.del("wq-player-last");
        return askCode("There's no game with the code " + code + ". Check the code on the big screen.");
      }
      WQ.store.set("wq-player-last", code);
      if (WQ.param("g") !== code) history.replaceState(null, "", "?g=" + code);
      g.meta = meta;
      $("join-title").textContent = meta.title || "Work Quiz";
      keepPresence();
      L.get(WQ.ref("players/" + WQ.uid)).then(function (ps) {
        if (ps.val()) startMain();
        else { WQ.show("s-join"); setTimeout(function () { $("name-input").focus(); }, 50); }
      });
    }).catch(fatal);
  }

  function keepPresence() {
    var pres = WQ.ref("presence/" + WQ.uid);
    L.onValue(L.ref(WQ.db, ".info/connected"), function (s) {
      if (s.val() !== true) return;
      L.onDisconnect(pres).set({ online: false, at: L.serverTimestamp() }).then(function () {
        return L.set(pres, { online: true, at: L.serverTimestamp() });
      }).catch(function () {});
    });
  }

  $("join-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = WQ.cleanName($("name-input").value);
    var err = $("join-error");
    err.textContent = "";
    if (!name) { err.textContent = "Please type your name."; return; }
    $("join-btn").disabled = true;
    Promise.all([L.get(WQ.ref("players")), L.get(WQ.ref("presence"))]).then(function (snaps) {
      var players = snaps[0].val() || {}, presence = snaps[1].val() || {};
      var clash = Object.keys(players).filter(function (uid) { return uid !== WQ.uid && players[uid] && WQ.sameName(players[uid].name, name); })[0];
      var record = { name: name, joinedAt: L.serverTimestamp() };
      if (clash) {
        if (presence[clash] && presence[clash].online) {
          throw new Error("Someone called " + players[clash].name + " is already playing. Please add an initial or surname.");
        }
        record.takeover = clash; // it's probably you on a new device: the quiz master's screen moves your place across
      }
      return L.set(WQ.ref("players/" + WQ.uid), record);
    }).then(function () {
      startMain();
    }).catch(function (e2) {
      err.textContent = (e2 && e2.message) || String(e2);
      $("join-btn").disabled = false;
    });
  });

  // ---------- Main screen ----------
  var mainStarted = false;
  function startMain() {
    if (mainStarted) return;
    mainStarted = true;
    WQ.show("s-main");
    WQ.watchConnection();
    WQ.listen("meta", function (v) { g.meta = v; render(); });
    WQ.listen("players", function (v) {
      g.players = v || {};
      if (!g.players[WQ.uid] && mainStarted) {
        // The quiz master removed us, or our place moved to another device.
        return showRemoved();
      }
      render();
    });
    WQ.listen("assign", function (v) { g.assign = v || {}; onTeamChange(); render(); });
    WQ.listen("state", function (v) { g.state = v || { phase: "lobby" }; onStateChange(); render(); });
    WQ.listen("pscores/" + WQ.uid, function (v) { g.pscores = v; render(); });
  }

  function showRemoved() {
    WQ.show("s-join");
    mainStarted = false;
    $("join-error").textContent = "You're not in this game at the moment. Type your name to join again.";
    $("join-btn").disabled = false;
  }

  function onTeamChange() {
    var a = g.assign[WQ.uid];
    var teams = (g.meta && g.meta.teams) || {};
    me.team = a && teams[a.team] ? a.team : null;
    me.captain = !!(a && a.captain && me.team);
    resubscribe();
  }
  function onStateChange() { resubscribe(); }

  function resubscribe() {
    var s = g.state || {};
    var aKey = me.team && s.qid ? s.qid + "/" + me.team : null;
    if (aKey !== subKeys.answers) {
      if (subs.answers) subs.answers();
      if (subs.lock) subs.lock();
      subs.answers = subs.lock = null;
      g.teamAnswers = {}; g.lock = null;
      subKeys.answers = aKey;
      if (aKey) {
        subs.answers = WQ.listen("answers/" + aKey, function (v) { g.teamAnswers = v || {}; render(); });
        subs.lock = WQ.listen("locks/" + aKey, function (v) { g.lock = v; render(); });
      }
    }
    var rKey = me.team;
    if (rKey !== subKeys.results) {
      if (subs.results) subs.results();
      subs.results = null; g.results = null;
      subKeys.results = rKey;
      if (rKey) subs.results = WQ.listen("results/" + rKey, function (v) { g.results = v; render(); });
    }
  }

  // ---------- Helpers ----------
  function teamName(tid) { var t = g.meta && g.meta.teams && g.meta.teams[tid]; return t ? t.name : ""; }
  function nameOf(uid) { var p = g.players[uid]; return p ? p.name : "Someone"; }
  function teammates() {
    return Object.keys(g.assign).filter(function (uid) { return g.assign[uid] && g.assign[uid].team === me.team && g.players[uid]; })
      .sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b)); });
  }
  function captainUid() {
    return teammates().filter(function (uid) { return g.assign[uid].captain; })[0] || null;
  }
  function firstName(uid) { return nameOf(uid).split(" ")[0]; }

  function choose(letter) {
    var s = g.state;
    if (!s || s.phase !== "question" || !me.team) return;
    var mine = g.teamAnswers[WQ.uid];
    if (s.mode !== "agree" && mine) return;
    if (s.mode === "agree" && g.lock) return;
    if (mine && mine.opt === letter) return;
    flashMsg = "";
    L.set(WQ.ref("answers/" + s.qid + "/" + me.team + "/" + WQ.uid), { opt: letter, at: L.serverTimestamp() })
      .catch(function () {
        flashMsg = "That answer didn't go through. Time may have run out.";
        render();
      });
  }

  // ---------- Rendering ----------
  var queued = false;
  function render() {
    if (queued) return;
    queued = true;
    setTimeout(function () { queued = false; draw(); }, 16);
  }

  function draw() {
    var p = g.players[WQ.uid];
    if (!p) return;
    $("p-name").textContent = p.name;
    $("p-team").textContent = me.team ? teamName(me.team) : "Not in a team yet";
    $("p-cap").hidden = !me.captain;

    var s = g.state || { phase: "lobby" };
    var body = WQ.clear($("p-body"));
    var fn = {
      lobby: drawLobby, topics: drawTopics, roundIntro: drawRoundIntro, question: drawQuestion, closed: drawQuestion,
      reveal: drawQuestion, roundEnd: drawRoundEnd, standings: drawStandings, final: drawFinal
    }[s.phase] || drawLobby;
    fn(body, s);
    if (s.phase !== "question" && timer.stop) { timer.stop(); timer.stop = null; timer.qid = null; }
  }

  function teamCard() {
    if (!me.team) {
      return h("div", { class: "card" }, [
        h("h2", { text: "You're in!" }),
        h("p", { class: "muted", text: "Waiting for the quiz master to put you in a team." })
      ]);
    }
    var mates = teammates(), cap = captainUid();
    return h("div", { class: "card" }, [
      h("div", { class: "muted small", text: "Your team" }),
      h("h2", { text: teamName(me.team) }),
      me.captain ? h("p", { class: "status ok", text: "You're the captain. You'll choose your team's double and poisoned rounds and its steal, and your pick counts if time runs out in a team agreement round." })
        : h("p", { class: "muted", text: cap ? "Captain: " + nameOf(cap) : "The quiz master will choose a captain." }),
      h("ul", { class: "list" }, mates.map(function (uid) {
        return h("li", null, [h("span", { text: nameOf(uid) + (uid === WQ.uid ? " (you)" : "") }), g.assign[uid].captain ? h("span", { class: "captain-star", text: "★" }) : null]);
      }))
    ]);
  }

  function drawLobby(body) {
    body.appendChild(teamCard());
    body.appendChild(h("p", { class: "muted small center", style: { marginTop: "14px" }, text: "The quiz will start soon. Keep this page open." }));
  }

  function roundsList() {
    var r = (g.meta && g.meta.rounds) || {};
    return Object.keys(r).map(function (k) { return r[k]; }).sort(function (a, b) { return a.num - b.num; });
  }

  function drawTopics(body) {
    body.appendChild(h("div", { class: "card" }, [
      h("h2", { text: "Tonight's rounds" }),
      h("ul", { class: "list" }, roundsList().map(function (rd) {
        return h("li", null, [h("strong", { text: rd.num + "." }), h("span", { style: { flex: "1" }, text: rd.topic }), h("span", { class: "pill", text: WQ.MODE_LABEL[rd.mode] })]);
      }))
    ]));
    if (!me.team) body.appendChild(teamCard());
  }

  function modeHelp(mode) {
    if (mode !== "agree") {
      return "First answer counts: the first tap from anyone in your team locks in the team's answer, so talk it through before anyone taps! Everyone still answers for their own score.";
    }
    return "Team agreement: your team's answer locks in when everyone picks the same option. If time runs out, the captain's pick counts for half points.";
  }

  function drawRoundIntro(body, s) {
    body.appendChild(h("div", { class: "card center" }, [
      h("div", { class: "muted", text: "Round " + s.round + " of " + s.totalRounds }),
      h("div", { class: "big-number", style: { margin: "8px 0" }, text: s.roundTopic }),
      h("span", { class: "pill", text: WQ.MODE_LABEL[s.mode] }),
      h("p", { style: { marginTop: "14px" }, text: modeHelp(s.mode) }),
      h("p", { class: "muted small", text: s.qCount + " questions" })
    ]));
    if (!me.team) body.appendChild(teamCard());
  }

  function drawQuestion(body, s) {
    var q = s.question || { text: "", options: [] };
    var mine = g.teamAnswers[WQ.uid];
    var cap = captainUid();
    var capAns = cap ? g.teamAnswers[cap] : null;
    var lock = g.lock;
    // First-answer rounds: the earliest tap in the team is the team's answer (the quiz master's screen confirms it).
    var first = null;
    if (s.mode !== "agree") {
      if (lock) first = { uid: lock.by, opt: lock.opt };
      else Object.keys(g.teamAnswers).forEach(function (uid) {
        var a = g.teamAnswers[uid];
        if (a && typeof a.at === "number" && (!first || a.at < first.at)) first = { uid: uid, opt: a.opt, at: a.at };
      });
    }
    var firstWho = first ? (first.uid === WQ.uid ? "you" : firstName(first.uid)) : "";
    var live = s.phase === "question";
    var reveal = s.phase === "reveal";

    body.appendChild(h("div", { class: "muted small", style: { marginTop: "12px" },
      text: "Round " + s.round + " · " + s.roundTopic + " · Question " + s.qNum + " of " + s.qCount }));
    body.appendChild(h("h2", { style: { marginTop: "6px" }, text: q.text }));

    if (live) {
      if (timer.qid !== s.qid) {
        if (timer.stop) timer.stop();
        timer.qid = s.qid;
        timer.bar = WQ.timerBar();
        timer.stop = typeof s.startAt === "number" ? WQ.countdown(s.startAt, s.seconds, timer.bar.update) : null;
      }
      body.appendChild(timer.bar);
    }

    var canTap = live && me.team && !(s.mode !== "agree" && mine) && !(s.mode === "agree" && lock);
    var opts = h("div", { class: "opts", style: { marginTop: live ? "0" : "14px" } });
    WQ.arr(q.options).forEach(function (text, i) {
      var L_ = WQ.LETTERS[i];
      var cls = "opt opt-" + L_.toLowerCase();
      if (mine && mine.opt === L_) cls += " mine";
      if (reveal) cls += s.correct === L_ ? " correct" : " dim";
      else if (!live && !(mine && mine.opt === L_)) cls += " dim";
      var inner = [h("span", { class: "letter", text: L_ }), h("span", { class: "text" }, [text])];
      // Agreement rounds: show who picked what
      if (s.mode === "agree" && me.team && !reveal) {
        var pickers = teammates().filter(function (uid) { return g.teamAnswers[uid] && g.teamAnswers[uid].opt === L_; });
        if (pickers.length) {
          inner[1].appendChild(h("div", { class: "chips" }, pickers.map(function (uid) {
            return h("span", { class: "chip" + (uid === cap ? " cap" : ""), text: (uid === cap ? "★ " : "") + (uid === WQ.uid ? "You" : firstName(uid)) });
          })));
        }
      }
      var btn = h("button", { class: cls, type: "button", disabled: !canTap, onclick: function () { choose(L_); } }, inner);
      // The team's answer is highlighted for everyone in the team
      var teamPick = s.mode !== "agree" ? (first && first.opt) : (lock ? lock.opt : null);
      if (teamPick === L_) btn.appendChild(h("span", { class: "cap-tag", text: s.mode !== "agree" ? "Team answer (" + firstWho + ")" : "Team answer" }));
      else if (s.mode === "agree" && !lock && capAns && capAns.opt === L_ && cap !== WQ.uid) btn.appendChild(h("span", { class: "cap-tag", text: "★ Captain" }));
      opts.appendChild(btn);
    });
    body.appendChild(opts);

    // Status line
    var status = null;
    if (!me.team) status = h("div", { class: "status warn", text: "You're not in a team yet, so you can't answer. The quiz master will put you in one." });
    else if (reveal) status = drawRevealStatus(s);
    else if (s.phase === "closed") status = h("div", { class: "status", text: "Time's up! Waiting for the answer…" });
    else if (s.mode !== "agree") {
      if (first) {
        status = h("div", { class: "status ok", text: first.uid === WQ.uid
          ? "You were first, so you locked in " + first.opt + " for your team."
          : nameOf(first.uid) + " was first, so the team's answer is " + first.opt + ". " + (mine ? "Your answer: " + mine.opt + "." : "Tap your own answer for personal points.") });
      } else status = h("div", { class: "status", text: "The first tap in your team locks in the team's answer. Talk it through before anyone taps!" });
    } else {
      if (lock) status = h("div", { class: "status ok", text: "Agreed! Your team locked in " + lock.opt + "." });
      else {
        var waiting = teammates().filter(function (uid) {
          var a = g.teamAnswers[uid];
          return !a || !mine || a.opt !== mine.opt;
        }).filter(function (uid) { return uid !== WQ.uid; }).map(firstName);
        var txt = mine ? (waiting.length ? "Not agreed yet. Different or no answer from: " + waiting.join(", ") + "." : "Waiting…")
          : "Tap the answer your team agrees on.";
        status = h("div", { class: "status", text: txt + " You can change your pick until you all agree." });
      }
    }
    if (status) body.appendChild(status);
    if (flashMsg) body.appendChild(h("div", { class: "status bad", text: flashMsg }));
  }

  function drawRevealStatus(s) {
    var wrap = h("div");
    var mineRes = g.pscores && g.pscores.q && g.pscores.q[s.qid];
    var mine = g.teamAnswers[WQ.uid];
    var teamRes = g.results && g.results.q && g.results.q[s.qid];
    var youTxt = mineRes ? (mineRes.correct ? "✓ Right! +" + WQ.fmt(mineRes.points) : "✗ Not this time")
      : (mine ? "Working it out…" : "You didn't answer");
    var how = { first: "First answer in: " + (teamRes && teamRes.by ? (teamRes.by === WQ.uid ? "you" : nameOf(teamRes.by)) : ""), captain: "Captain's pick",
      agreed: "Agreed answer", timeout: "Time ran out, so the captain's pick counted for half points", none: "No team answer" };
    var teamTxt = teamRes ? (teamRes.correct ? "✓ +" + WQ.fmt(teamRes.points) : "✗ 0") : "…";
    wrap.appendChild(h("div", { class: "score-grid" }, [
      h("div", { class: "score-box" }, [h("div", { class: "label", text: "You" }), h("div", { class: "val", style: { fontSize: "1.15rem" }, text: youTxt })]),
      h("div", { class: "score-box" }, [h("div", { class: "label", text: "Your team" }), h("div", { class: "val", style: { fontSize: "1.15rem" }, text: teamTxt }),
        teamRes && teamRes.how ? h("div", { class: "small muted", text: how[teamRes.how] }) : null])
    ]));
    return wrap;
  }

  function drawRoundEnd(body, s) {
    var tq = g.results && g.results.q, pq = g.pscores && g.pscores.q;
    body.appendChild(h("div", { class: "card" }, [
      h("h2", { text: "End of round " + s.round }),
      me.team ? h("div", { class: "score-grid" }, [
        h("div", { class: "score-box" }, [h("div", { class: "label", text: "Your team this round" }), h("div", { class: "val", text: WQ.fmt(WQ.sumPoints(tq, s.round)) })]),
        h("div", { class: "score-box" }, [h("div", { class: "label", text: "Your team in total" }), h("div", { class: "val", text: WQ.fmt(WQ.sumPoints(tq)) })]),
        h("div", { class: "score-box" }, [h("div", { class: "label", text: "You this round" }), h("div", { class: "val", text: WQ.fmt(WQ.sumPoints(pq, s.round)) })]),
        h("div", { class: "score-box" }, [h("div", { class: "label", text: "You in total" }), h("div", { class: "val", text: WQ.fmt(WQ.sumPoints(pq)) })])
      ]) : h("p", { class: "muted", text: "You're not in a team yet." }),
      h("p", { class: "muted small", style: { marginTop: "12px" }, text: "Only your team can see your team's score." })
    ]));
  }

  function halfTable(st) {
    return h("div", { class: "half-table" }, [
      h("div", { class: "label", text: "Top half" }),
      h("div", { class: "half" }, WQ.arr(st.top).map(function (n) { return h("span", { class: "team-chip", text: n }); })),
      h("div", { class: "divider" }),
      h("div", { class: "half" }, WQ.arr(st.bottom).map(function (n) { return h("span", { class: "team-chip", text: n }); })),
      h("div", { class: "label", text: "Bottom half" })
    ]);
  }

  function drawStandings(body, s) {
    body.appendChild(h("div", { class: "card" }, [
      h("h2", { class: "center", text: "Standings after round " + s.round }),
      h("p", { class: "muted small center", text: "In alphabetical order, so nobody knows who's winning." }),
      s.standings ? halfTable(s.standings) : null
    ]));
  }

  function drawFinal(body, s) {
    var tq = g.results && g.results.q, pq = g.pscores && g.pscores.q;
    var counts = s.counts || { players: 0, teams: 0 };
    var shown = s.shown || {}, sp = shown.players || {}, st = shown.teams || {};
    var medal = { 1: "🥇", 2: "🥈", 3: "🥉" };
    var allShown = Object.keys(sp).length >= counts.players && Object.keys(st).length >= counts.teams;
    function list(title, n, map) {
      var items = [];
      for (var place = 1; place <= n; place++) {
        var r = map["p" + place];
        items.push(h("li", { class: r ? "" : "hiddenrow" }, [
          h("strong", { style: { width: "2em" }, text: medal[place] || place + "." }),
          h("span", { style: { flex: "1" }, text: r ? r.name : "?" }),
          h("span", { text: r ? WQ.fmt(r.points) : "" })
        ]));
      }
      return n ? [h("h3", { style: { marginTop: "16px" }, text: title }), h("ul", { class: "list reveal-mini" }, items)] : [];
    }
    body.appendChild(h("div", { class: "card" }, [
      h("h2", { text: allShown ? "That's the end of the quiz!" : "Final results" }),
      allShown ? null : h("p", { class: "muted", text: "Watch the big screen. The results are revealed one at a time, and your own scores appear here at the end." }),
      me.team && allShown ? h("div", { class: "score-grid" }, [
        h("div", { class: "score-box" }, [h("div", { class: "label", text: "Your team" }), h("div", { class: "val", text: WQ.fmt(WQ.sumPoints(tq)) })]),
        h("div", { class: "score-box" }, [h("div", { class: "label", text: "You" }), h("div", { class: "val", text: WQ.fmt(WQ.sumPoints(pq)) })])
      ]) : null
    ].concat(list("Top players", counts.players, sp)).concat(list("Top teams", counts.teams, st))));
  }

  // ---------- Go ----------
  WQ.init().then(start).catch(fatal);
})();
