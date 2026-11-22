// Work Quiz – player screen (phones and laptops).
(function () {
  "use strict";
  var L = window.QuizLib, $ = WQ.$, h = WQ.h;

  var g = { meta: null, state: null, players: {}, assign: {}, teamAnswers: {}, lock: null, results: null, pscores: null, picks: null, steal: null };
  var draft = null, draftDirty = false;          // captain's unsaved picks
  var stealDraft = null, stealDirty = false;     // captain's unsaved steal
  var me = { team: null, captain: false };
  var subs = { answers: null, lock: null, results: null, picks: null, steal: null };
  var subKeys = { answers: null, lock: null, results: null };
  var timer = { qid: null, bar: null, stop: null };
  var flashMsg = "";
  var picCache = {}, picLoading = {};            // pictures sent through Firebase, by question id
  var boardCache = { key: null, board: null };   // the picture board for the current question
  var pinDraft = { qid: null, pin: null };       // where you've put your pin before locking it in
  var fullCache = { key: null, board: null };    // the full picture shown first (look-first questions)
  var ptimer = { key: null, bar: null, stop: null };
  var myVote = {};                                // your Ready? answer, by question and study round

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
      WQ.setRounds(meta.totalRounds);
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
    WQ.listen("meta", function (v) { g.meta = v; if (v) WQ.setRounds(v.totalRounds); render(); });
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
    WQ.listen("pics", onPics);
  }

  // Pictures arrive a little before their question. Once one has loaded, tell the quiz master's screen.
  function onPics(v) {
    v = v || {};
    Object.keys(v).forEach(function (id) {
      var p = v[id];
      if (!p || !p.data || picCache[id] || picLoading[id]) return;
      picLoading[id] = true;
      var im = new Image();
      im.onload = function () {
        delete picLoading[id];
        picCache[id] = { data: p.data, w: p.w, h: p.h };
        reportLoaded();
        render();
      };
      im.onerror = function () { delete picLoading[id]; };
      im.src = p.data;
    });
    Object.keys(picCache).forEach(function (id) { if (!v[id] && !(g.state && (g.state.qid === id || g.state.qid + "f" === id || g.state.qid + "m" === id))) delete picCache[id]; });
  }
  // Tells the quiz master's screen which pictures this phone has ready.
  var lastReported = null;
  function reportLoaded() {
    var list = Object.keys(picCache).sort().join(",").slice(0, 60);
    if (list === lastReported) return;
    lastReported = list;
    L.set(WQ.ref("picsLoaded/" + WQ.uid), list).catch(function () {});
  }
  function picSource(pic) {
    if (!pic) return null;
    if (pic.src) return { src: pic.src, w: pic.w, h: pic.h };
    var c = picCache[pic.id];
    return { data: c ? c.data : null, w: pic.w, h: pic.h };
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
      if (subs.picks) subs.picks();
      if (subs.steal) subs.steal();
      subs.picks = subs.steal = null; g.picks = null; g.steal = null;
      draft = null; draftDirty = false; stealDraft = null; stealDirty = false;
      if (rKey && g.meta && g.meta.dps) {
        subs.picks = WQ.listen("picks/" + rKey, function (v) { g.picks = WQ.readPicks(v); if (!draftDirty) draft = null; render(); });
        subs.steal = WQ.listen("steals/" + rKey, function (v) { g.steal = v; if (!stealDirty) stealDraft = null; render(); });
      }
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
    if (WQ.pinBusy) return WQ.whenPinIdle(render);
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
      preview: drawQuestion, ready: drawQuestion, listen: drawQuestion,
      reveal: drawQuestion, roundEnd: drawRoundEnd, standings: drawStandings, final: drawFinal,
      picks: drawPicks, steal: drawSteal, stealReveal: drawStealReveal
    }[s.phase] || drawLobby;
    fn(body, s);
    if (s.phase !== "question" && timer.stop) { timer.stop(); timer.stop = null; timer.qid = null; }
    if (s.phase !== "preview" && ptimer.stop) { ptimer.stop(); ptimer.stop = null; ptimer.key = null; }
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
        return h("li", null, [h("strong", { text: rd.num + "." }), h("span", { style: { flex: "1" }, text: rd.topic }),
          h("span", { class: "pill", text: WQ.typePill(rd) })]);
      }))
    ]));
    if (!me.team) body.appendChild(teamCard());
  }

  function modeHelp(mode, type) {
    if (type === "pin") {
      return "Pin the tail: a picture appears with something to find or put back. Tap where it belongs, drag your pin to adjust, then press Lock in. The closer and quicker, the more points. The first teammate to lock in sets the team's pin, so agree on the spot first!";
    }
    if (type === "year") {
      return "Guess the year: listen to the song, then turn the wheel to the year it came out and press Lock in. The right year scores full points and one year out scores half, and quicker is better. The first teammate to lock in sets the team's year, so agree on it first!";
    }
    if (type === "order") {
      return "Ordering: tap the four things in the right order, then press Lock in. Each one in its right place scores a quarter of the points, and quicker is better. The first teammate to lock in sets the team's order, so agree on it first!";
    }
    if (type === "resize") {
      return "Resize: make the red picture the right size next to the blue one with the slider, then press Lock in. Use Zoom for a closer look. The closer and quicker, the more points. The first teammate to lock in sets the team's answer, so agree on it first!";
    }
    if (mode !== "agree") {
      return "First answer counts: the first tap from anyone in your team locks in the team's answer, so talk it through before anyone taps! Everyone still answers for their own score.";
    }
    return "Team agreement: your team's answer locks in when everyone picks the same option. If time runs out, the captain's pick counts for half points.";
  }

  function drawRoundIntro(body, s) {
    body.appendChild(h("div", { class: "card center" }, [
      h("div", { class: "muted", text: "Round " + s.round + " of " + s.totalRounds }),
      h("div", { class: "big-number", style: { margin: "8px 0" }, text: s.roundTopic }),
      h("span", { class: "pill", text: WQ.typePill(s) }),
      h("p", { style: { marginTop: "14px" }, text: modeHelp(s.mode, s.type) }),
      s.practice ? h("p", { class: "status", text: WQ.PRACTICE_INTRO[s.practiceType || "pin"] || WQ.PRACTICE_INTRO.pin }) : null,
      h("p", { class: "muted small", text: s.qCount + (s.qCount === 1 ? " question" : " questions") }),
      roundFlag(s.round)
    ]));
    if (!me.team) body.appendChild(teamCard());
  }

  // The picture board for this question, kept between redraws so pins, zoom and scrolling stay put.
  function boardFor(s) {
    var q = s.question || {};
    if (boardCache.key === s.qid && boardCache.board) return boardCache.board;
    var isPin = q.kind === "pin";
    var board = WQ.pinBoard({
      pic: picSource(q.pic), marker: q.marker || "pin", interactive: isPin, zoom: true,
      maxH: function () { return window.innerHeight * (isPin ? 0.56 : 0.34); },
      onChange: function (p) { pinDraft = { qid: s.qid, pin: p }; render(); }
    });
    boardCache = { key: s.qid, board: board };
    return board;
  }

  function teamFirstPin() {
    if (g.lock && typeof g.lock.x === "number") return { uid: g.lock.by, x: g.lock.x, y: g.lock.y };
    var first = null;
    Object.keys(g.teamAnswers).forEach(function (uid) {
      var a = g.teamAnswers[uid];
      if (a && typeof a.x === "number" && (!first || a.at < first.at)) first = { uid: uid, x: a.x, y: a.y, at: a.at };
    });
    return first;
  }

  // Look-first questions: the full picture shows for a few seconds before the item is taken away.
  function drawFullPicture(body, s) {
    var q = s.question, again = s.studyRound > 1;
    var key = s.qid + ":" + s.studyRound;
    if (ptimer.key !== key) {
      if (ptimer.stop) ptimer.stop();
      ptimer.key = key;
      ptimer.bar = WQ.timerBar();
      ptimer.bar.classList.add("look");
      ptimer.stop = typeof s.startAt === "number" ? WQ.countdown(s.startAt, q.showFor || WQ.SHOW_FOR, ptimer.bar.update) : null;
    }
    body.appendChild(h("div", { class: "look-banner", text: again ? "👀 Here it is again. Study it carefully!" : "👀 Study the picture! Something is about to disappear." }));
    body.appendChild(ptimer.bar);
    if (fullCache.key !== s.qid) {
      fullCache = { key: s.qid, board: WQ.pinBoard({ pic: picSource(q.full), maxH: function () { return window.innerHeight * 0.56; } }) };
    }
    var fs = picSource(q.full);
    if (fs) fullCache.board.setSrc(fs.data || fs.src);
    body.appendChild(fullCache.board.el);
    fullCache.board.refresh();
  }

  // Ready? Yes/No after studying the picture. You can change your answer until the quiz master moves on.
  function vote(s, v) {
    if (!me.team) return;
    var key = s.qid + ":" + s.studyRound;
    myVote[key] = v;
    L.set(WQ.ref("ready/" + s.qid + "/" + WQ.uid), { v: v, r: s.studyRound }).catch(function () { delete myVote[key]; render(); });
    render();
  }
  function drawReady(body, s) {
    var mine = myVote[s.qid + ":" + s.studyRound];
    var card = h("div", { class: "card center ready-card" }, [
      h("div", { class: "big-number", text: "Ready?" }),
      h("p", { class: "muted", text: "The picture is gone. Are you ready to pin where the missing thing was?" })
    ]);
    if (me.team) {
      card.appendChild(h("div", { class: "ready-btns" }, [
        h("button", { class: "ready-btn yes" + (mine === "yes" ? " on" : ""), type: "button", onclick: function () { vote(s, "yes"); } }, ["✓ Yes"]),
        h("button", { class: "ready-btn no" + (mine === "no" ? " on" : ""), type: "button", onclick: function () { vote(s, "no"); } }, ["✗ No, show it again"])
      ]));
      card.appendChild(h("p", { class: "muted small", style: { marginTop: "10px" },
        text: (mine ? "You said " + (mine === "yes" ? "yes" : "no") + ". You can change your mind until the quiz master moves on. " : "") +
          "If more than half say no, the quiz master can show the picture again." }));
    } else card.appendChild(h("p", { class: "status warn", text: "You're not in a team yet." }));
    card.appendChild(h("p", { class: "small", style: { fontWeight: "700" }, text: "✓ " + (s.readyYes || 0) + " ready · ✗ " + (s.readyNo || 0) + " not ready · " + (s.readyOf || 0) + " players" }));
    body.appendChild(card);
  }

  function drawPinQuestion(body, s) {
    var q = s.question;
    var mine = g.teamAnswers[WQ.uid];
    var live = s.phase === "question", reveal = s.phase === "reveal";
    var first = teamFirstPin();
    body.appendChild(h("div", { class: "muted small", style: { marginTop: "12px" } }, [
      "Round " + s.round + " · " + s.roundTopic + " · ",
      s.practice ? h("span", { class: "practice-tag", text: "Practice: doesn't count" }) : "Question " + s.qNum + " of " + s.qCount + roundFlagShort(s.round)
    ]));
    body.appendChild(h("h2", { style: { marginTop: "6px" }, text: q.text }));
    if (s.phase === "preview") return drawFullPicture(body, s);
    if (s.phase === "ready") return drawReady(body, s);
    if (live) {
      if (timer.qid !== s.qid || timer.start !== s.startAt) {
        if (timer.stop) timer.stop();
        timer.qid = s.qid;
        timer.start = s.startAt;
        timer.bar = WQ.timerBar();
        timer.stop = typeof s.startAt === "number" ? WQ.countdown(s.startAt, s.seconds, timer.bar.update) : null;
      }
      body.appendChild(timer.bar);
    }
    var board = boardFor(s), src = picSource(reveal && q.full ? q.full : q.pic);
    if (src) board.setSrc(src.data || src.src);
    if (mine) { board.setPin(mine); board.setLocked(true); }
    else { board.setLocked(false); board.setPin(pinDraft.qid === s.qid ? pinDraft.pin : null); }
    board.setInteractive(live && !!me.team && !mine);
    var others = [];
    if (first && first.uid !== WQ.uid) others.push({ x: first.x, y: first.y, label: "Team: " + firstName(first.uid), marker: q.marker });
    board.setOthers(others);
    if (reveal && s.correctPin) board.setReveal({ target: s.correctPin, dots: WQ.arr(s.dots), level: q.level, markerAtTarget: !q.full });
    body.appendChild(board.el);
    board.refresh();

    var draft = pinDraft.qid === s.qid ? pinDraft.pin : null;
    if (live && me.team && !mine) {
      body.appendChild(h("div", { class: "pin-actions" }, [
        h("button", { class: "btn btn-primary btn-big btn-block", type: "button", disabled: !draft, onclick: function () { lockInPin(s); } },
          [draft ? "Lock in" : "Tap the picture to place your pin"]),
        h("p", { class: "pin-help", text: draft ? "Drag your pin to adjust it, or tap somewhere else. Use + to zoom in." : "Use + to zoom in for a closer look." })
      ]));
    }


    var status = null;
    if (!me.team) status = h("div", { class: "status warn", text: "You're not in a team yet, so you can't answer. The quiz master will put you in one." });
    else if (reveal) status = drawPinRevealStatus(s, mine);
    else if (s.phase === "closed") status = h("div", { class: "status", text: "Time's up! Waiting for the answer…" });
    else if (first) {
      status = h("div", { class: "status ok", text: first.uid === WQ.uid
        ? "You locked in first, so your pin is the team's pin."
        : nameOf(first.uid) + " locked in first, so the pin marked “Team: " + firstName(first.uid) + "” is your team's pin. " + (mine ? "Your own pin is locked in too." : "Place your own pin for personal points.") });
    } else status = h("div", { class: "status", text: "The first teammate to lock in sets the team's pin, so agree on the spot before anyone locks in!" });
    if (status) body.appendChild(status);
    if (flashMsg) body.appendChild(h("div", { class: "status bad", text: flashMsg }));
  }

  function lockInPin(s) {
    var p = pinDraft.qid === s.qid ? pinDraft.pin : null;
    if (!p || !me.team || g.teamAnswers[WQ.uid]) return;
    flashMsg = "";
    L.set(WQ.ref("answers/" + s.qid + "/" + me.team + "/" + WQ.uid), { x: p.x, y: p.y, at: L.serverTimestamp() })
      .catch(function () { flashMsg = "Your pin didn't go through. Time may have run out."; render(); });
  }

  function pinText(r) {
    if (!r || r.how === "none") return "No pin";
    if (r.acc >= 1) return "🎯 Bullseye! +" + WQ.fmt(r.points);
    if (r.acc > 0) return WQ.pct(r.acc) + " accurate · +" + WQ.fmt(r.points);
    return "Too far away · 0";
  }
  function drawPinRevealStatus(s, mine) {
    var wrap = h("div");
    if (s.practice) {
      var txt = "You didn't place a pin in time.";
      if (mine && s.correctPin) {
        var pic = s.question.pic || { w: 4, h: 3 };
        var acc = WQ.pinAccuracy(WQ.pinDistance(mine, s.correctPin, pic.w / pic.h), s.question.level);
        txt = acc >= 1 ? "🎯 Bullseye! Spot on." : acc > 0 ? "Your pin was " + WQ.pct(acc) + " accurate." : "Too far away this time.";
      }
      wrap.appendChild(h("div", { class: "status" }, [h("strong", { text: txt }), " That was just practice. The glowing tail shows where it goes, and the dots are everyone's pins. The real questions are next!"]));
      return wrap;
    }
    var mineRes = g.pscores && g.pscores.q && g.pscores.q[s.qid];
    var teamRes = g.results && g.results.q && g.results.q[s.qid];
    var youTxt = mineRes ? pinText(mineRes) : (mine ? "Working it out…" : "You didn't place a pin");
    var by = teamRes && teamRes.by ? (teamRes.by === WQ.uid ? "you" : nameOf(teamRes.by)) : "";
    wrap.appendChild(h("div", { class: "score-grid" }, [
      h("div", { class: "score-box" }, [h("div", { class: "label", text: "You" }), h("div", { class: "val", style: { fontSize: "1.1rem" }, text: youTxt })]),
      h("div", { class: "score-box" }, [h("div", { class: "label", text: "Your team" }), h("div", { class: "val", style: { fontSize: "1.1rem" }, text: teamRes ? pinText(teamRes) : "…" }),
        by ? h("div", { class: "small muted", text: "Team pin: " + by }) : null])
    ]));
    wrap.appendChild(h("p", { class: "muted small", style: { marginTop: "8px" }, text: "Gold ring: the right spot. Dots: everyone's pins." }));
    if (s.note) wrap.appendChild(h("p", { class: "reveal-note", text: s.note }));
    return wrap;
  }


  // ---------- Guess the year, ordering and resize ----------
  var widget = { key: null, w: null, btn: null };   // the wheel, tiles or stage for the current question
  function questionHead(body, s) {
    body.appendChild(h("div", { class: "muted small", style: { marginTop: "12px" } }, [
      "Round " + s.round + " · " + s.roundTopic + " · ",
      s.practice ? h("span", { class: "practice-tag", text: "Practice: doesn't count" }) : "Question " + s.qNum + " of " + s.qCount + roundFlagShort(s.round)
    ]));
    body.appendChild(h("h2", { style: { marginTop: "6px" }, text: s.question.text }));
  }
  function questionClock(body, s) {
    if (timer.qid !== s.qid || timer.start !== s.startAt) {
      if (timer.stop) timer.stop();
      timer.qid = s.qid;
      timer.start = s.startAt;
      timer.bar = WQ.timerBar();
      timer.stop = typeof s.startAt === "number" ? WQ.countdown(s.startAt, s.seconds, timer.bar.update) : null;
    }
    body.appendChild(timer.bar);
  }
  // The earliest answer in the team that has the given part (the team's answer in first-answer rounds).
  function teamFirstAnswer(field) {
    if (g.lock && g.lock[field] !== undefined) return { uid: g.lock.by, a: g.lock };
    var first = null;
    Object.keys(g.teamAnswers).forEach(function (uid) {
      var a = g.teamAnswers[uid];
      if (a && a[field] !== undefined && typeof a.at === "number" && (!first || a.at < first.a.at)) first = { uid: uid, a: a };
    });
    return first;
  }
  var FIELD = { year: "yr", order: "o", resize: "s" };
  function widgetFor(s) {
    var q = s.question, key = s.qid;
    if (widget.key === key && widget.w) return widget.w;
    var w;
    if (q.kind === "year") {
      w = WQ.yearWheel({ min: q.min, max: q.max, start: q.start, onChange: function (y) { if (widget.btn && !widget.btn.disabled) widget.btn.textContent = "Lock in " + y; } });
    } else if (q.kind === "order") {
      w = WQ.orderBoard({ items: WQ.arr(q.items), top: q.top, bottom: q.bottom, onChange: function () { render(); } });
    } else {
      w = WQ.resizeStage({ fixed: picSource(q.fixed), moving: picSource(q.moving), interactive: true,
        maxH: function () { return Math.min(window.innerHeight * 0.4, 400); } });
    }
    widget = { key: key, w: w, btn: null };
    return w;
  }
  function draftAnswer(kind, w) {
    if (kind === "year") return { yr: w.value() };
    if (kind === "order") { var o = w.getOrder(); return o ? { o: o } : null; }
    return { s: Math.round(w.getScale() * 10000) / 10000 };
  }
  function lockInNew(s) {
    var kind = s.question.kind, w = widget.key === s.qid ? widget.w : null;
    if (!w || !me.team || g.teamAnswers[WQ.uid] || s.phase !== "question") return;
    var a = draftAnswer(kind, w);
    if (!a) return;
    a.at = L.serverTimestamp();
    flashMsg = "";
    L.set(WQ.ref("answers/" + s.qid + "/" + me.team + "/" + WQ.uid), a)
      .catch(function () { flashMsg = "Your answer didn't go through. Time may have run out."; render(); });
  }
  function valueText(kind, a, q) {
    if (kind === "year") return String(a.yr);
    if (kind === "order") return a.o.split("").map(function (d, k) { return (k + 1) + ". " + WQ.arr(q.items)[+d]; }).join("  ");
    return "";
  }
  function resultText(kind, r, s) {
    if (!r || r.how === "none") return kind === "year" ? "No year" : kind === "order" ? "No order" : "No answer";
    var pts = r.points ? "  +" + WQ.fmt(r.points) : "  0";
    if (kind === "year") return (r.diff === 0 ? "🎯 " + r.yr + ", spot on!" : r.yr + ", " + WQ.yearOffText(r.yr, s.correctYear)) + pts;
    if (kind === "order") return (r.right === WQ.ORDER_ITEMS ? "✓ All " + WQ.ORDER_ITEMS + " right!" : r.right + " of " + WQ.ORDER_ITEMS + " in the right place") + pts;
    var dir = s.correctScale && r.s ? (r.s > s.correctScale ? " too big" : " too small") : "";
    return (r.acc >= 1 ? "🎯 Spot on!" : r.acc > 0 ? Math.round(r.off) + "%" + dir + " · " + WQ.pct(r.acc) + " accurate" : "Too far out (" + Math.round(r.off) + "%" + dir + ")") + pts;
  }
  function drawNewQuestion(body, s) {
    var q = s.question, kind = q.kind, field = FIELD[kind];
    var mine = g.teamAnswers[WQ.uid], live = s.phase === "question", reveal = s.phase === "reveal";
    questionHead(body, s);
    if (s.phase === "listen") {
      body.appendChild(h("div", { class: "card listen-card" }, [
        h("div", { class: "listen-icon", text: "🎵" }),
        h("div", { class: "big-number", text: "Listen!" }),
        h("p", { class: "muted", text: "The wheel appears when the song finishes. Talk about the year with your team while you listen." })
      ]));
      if (!me.team) body.appendChild(h("div", { class: "status warn", text: "You're not in a team yet, so you can't answer. The quiz master will put you in one." }));
      return;
    }
    if (live) questionClock(body, s);
    var w = widgetFor(s);
    if (kind === "resize") w.setPics(picSource(q.fixed), picSource(q.moving));

    if (reveal && kind === "year") {
      body.appendChild(h("div", { class: "card center" }, [
        h("div", { class: "muted small", text: "The answer" }),
        h("div", { class: "year-answer", text: String(s.correctYear || "") }),
        s.note ? h("p", { class: "reveal-note", text: s.note }) : null
      ]));
    } else {
      if (mine && mine[field] !== undefined) {
        if (kind === "year") w.setValue(mine.yr);
        else if (kind === "order") { if (w.getOrder() !== mine.o) w.setOrder(mine.o); }
        else if (Math.abs(w.getScale() - mine.s) > 1e-6) w.setScale(mine.s);
      }
      w.setLocked(!!mine);
      if (w.setEnabled) w.setEnabled(live && !!me.team);
      if (w.setInteractive) w.setInteractive(live && !!me.team && !mine);
      if (reveal && kind === "order" && mine) w.setMarks(WQ.arr(s.correctOrder));
      if (reveal && kind === "resize") w.setGhost(s.correctScale);
      body.appendChild(w.el);
      w.refresh && w.refresh();
      if (kind === "resize" && reveal) {
        body.appendChild(h("div", { class: "rs-key" }, [h("span", { class: "k-fixed", text: "Stays put" }), mine ? h("span", { class: "k-moving", text: "Yours" }) : null,
          h("span", { class: "k-ghost", text: "The right size" })]));
      }
      if (reveal && kind === "order") {
        body.appendChild(h("div", { class: "card" }, [h("div", { class: "muted small", text: "The right order" }), WQ.orderList(WQ.arr(q.items), WQ.arr(s.correctOrder), q.top, q.bottom)]));
      }
    }

    if (live && me.team && !mine) {
      var ready = kind !== "order" || !!w.getOrder();
      var label = kind === "year" ? "Lock in " + w.value() : ready ? "Lock in" : "Tap all four in order";
      var btn = h("button", { class: "btn btn-primary btn-big btn-block", type: "button", disabled: !ready, style: { marginTop: "12px" }, onclick: function () { lockInNew(s); } }, [label]);
      widget.btn = btn;
      body.appendChild(btn);
    } else widget.btn = null;

    var first = teamFirstAnswer(field), status = null;
    if (!me.team) status = h("div", { class: "status warn", text: "You're not in a team yet, so you can't answer. The quiz master will put you in one." });
    else if (reveal) status = newRevealStatus(s, kind, mine);
    else if (s.phase === "closed") status = h("div", { class: "status", text: "Time's up! Waiting for the answer…" });
    else if (first) {
      var shown = kind === "resize" ? "" : " (" + valueText(kind, first.a, q) + ")";
      status = h("div", { class: "status ok", text: first.uid === WQ.uid
        ? "You locked in first, so yours is the team's answer" + shown + "."
        : nameOf(first.uid) + " locked in first, so that's your team's answer" + shown + ". " + (mine ? "Yours is locked in too." : "Lock in your own for personal points.") });
    } else status = h("div", { class: "status", text: "The first teammate to lock in sets the team's answer, so agree on it before anyone locks in!" });
    if (status) body.appendChild(status);
    if (flashMsg) body.appendChild(h("div", { class: "status bad", text: flashMsg }));
  }
  function newRevealStatus(s, kind, mine) {
    var wrap = h("div");
    if (s.practice) {
      var txt = "You didn't lock in an answer in time.";
      if (mine && kind === "resize" && s.correctScale) {
        var off = WQ.resizeOff(mine.s, s.correctScale), acc = WQ.resizeAccuracy(off, s.question.level);
        txt = acc >= 1 ? "🎯 Spot on!" : "You were " + Math.round(off) + "% too " + (mine.s > s.correctScale ? "big" : "small") + " (" + WQ.pct(acc) + " accurate).";
      }
      wrap.appendChild(h("div", { class: "status" }, [h("strong", { text: txt }), " That was just practice. The gold Santa shows the right size. The real questions are next!"]));
      if (s.note) wrap.appendChild(h("p", { class: "reveal-note", text: s.note }));
      return wrap;
    }
    var mineRes = g.pscores && g.pscores.q && g.pscores.q[s.qid];
    var teamRes = g.results && g.results.q && g.results.q[s.qid];
    var by = teamRes && teamRes.by ? (teamRes.by === WQ.uid ? "you" : nameOf(teamRes.by)) : "";
    wrap.appendChild(h("div", { class: "score-grid" }, [
      h("div", { class: "score-box" }, [h("div", { class: "label", text: "You" }), h("div", { class: "val", style: { fontSize: "1.05rem" }, text: mineRes ? resultText(kind, mineRes, s) : (mine ? "Working it out…" : "You didn't lock in") })]),
      h("div", { class: "score-box" }, [h("div", { class: "label", text: "Your team" }), h("div", { class: "val", style: { fontSize: "1.05rem" }, text: teamRes ? resultText(kind, teamRes, s) : "…" }),
        by ? h("div", { class: "small muted", text: "Team answer: " + by }) : null])
    ]));
    if (s.note && kind !== "year") wrap.appendChild(h("p", { class: "reveal-note", text: s.note }));
    return wrap;
  }

  function drawQuestion(body, s) {
    var q = s.question || { text: "", options: [] };
    if (q.kind === "pin") return drawPinQuestion(body, s);
    if (q.kind === "year" || q.kind === "order" || q.kind === "resize") return drawNewQuestion(body, s);
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
      text: "Round " + s.round + " · " + s.roundTopic + " · Question " + s.qNum + " of " + s.qCount + roundFlagShort(s.round) }));
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

    if (q.pic) {
      var pboard = boardFor(s), psrc = picSource(q.pic);
      if (psrc) pboard.setSrc(psrc.data || psrc.src);
      body.appendChild(pboard.el);
      pboard.refresh();
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
    if (s.note) wrap.appendChild(h("p", { class: "reveal-note", text: s.note }));
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
      roundFlag(s.round),
      h("p", { class: "muted small", style: { marginTop: "12px" }, text: "Only your team can see your team's score." + (g.meta && g.meta.dps ? " Doubles and steals are added at the end." : "") })
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
    var teamFinal = g.results && g.results.final;
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
        h("div", { class: "score-box" }, [h("div", { class: "label", text: "Your team" }), h("div", { class: "val", text: WQ.fmt(teamFinal ? teamFinal.total : WQ.sumPoints(tq)) }),
          teamFinal && g.meta && g.meta.dps ? h("div", { class: "small muted", text: WQ.fmt(teamFinal.base) + " from questions, " + signed(teamFinal.doubleBonus) + " double, " + signed(teamFinal.steals) + " steals" }) : null]),
        h("div", { class: "score-box" }, [h("div", { class: "label", text: "You" }), h("div", { class: "val", text: WQ.fmt(WQ.sumPoints(pq)) })])
      ]) : null
    ].concat(dpsLists(shown)).concat(list("Top players", counts.players, sp)).concat(list("Top teams", counts.teams, st))));
  }

  function signed(n) { n = n || 0; return (n < 0 ? "−" : "+") + WQ.fmt(Math.abs(n)); }

  function dpsLists(shown) {
    var out = [];
    var d = shown.doubles, st = shown.steals;
    if (d) {
      out.push(h("h3", { style: { marginTop: "16px" }, text: "×2 Double rounds" }));
      out.push(h("ul", { class: "list" }, Object.keys(d).filter(function (k) { return k !== "none"; }).map(function (k) {
        var x = d[k];
        return h("li", null, [h("span", { style: { flex: "1" }, text: x.team + (x.round ? ": R" + x.round + " " + x.topic : "") }), h("strong", { text: "+" + WQ.fmt(x.bonus) })]);
      })));
    }
    if (st) {
      var rows = Object.keys(st).filter(function (k) { return k !== "none"; }).map(function (k) { return st[k]; }).sort(function (a, b) { return a.n - b.n; });
      out.push(h("h3", { style: { marginTop: "16px" }, text: "Steals" }));
      out.push(h("ul", { class: "list" }, rows.map(function (x) {
        var poison = x.outcome === "poison";
        return h("li", null, [h("span", { style: { flex: "1" }, text: (poison ? "☠ " : "💰 ") + x.thief + " → " + x.target + " R" + x.round }),
          h("strong", { style: { color: poison ? "var(--bad)" : "var(--ok)" }, text: (poison ? "−" : "+") + WQ.fmt(x.points) })]);
      })));
    }
    return out;
  }

  // ---------- Doubles, poison and steals ----------
  function roundStatus(n) {
    if (!(g.meta && g.meta.dps) || !g.picks || !n) return null;
    if (g.picks.double === n) return "dbl";
    if (g.picks.poison.indexOf(n) >= 0) return "psn";
    return null;
  }
  function roundFlag(n) {
    var st = roundStatus(n);
    if (st === "dbl") return h("div", { class: "round-flag dbl", text: "×2 This is your team's double round: it counts twice at the end." });
    if (st === "psn") return h("div", { class: "round-flag psn", text: "☠ This is one of your team's poisoned rounds: anyone who steals it loses the points." });
    return null;
  }
  function roundFlagShort(n) {
    var st = roundStatus(n);
    return st === "dbl" ? " · ×2 your double" : st === "psn" ? " · ☠ your poison" : "";
  }
  function dpsRounds() {
    return roundsList().filter(function (rd) { return rd.num <= WQ.DPS_ROUNDS; });
  }

  function drawPicks(body) {
    if (!me.team) return body.appendChild(teamCard());
    var saved = g.picks;
    if (!draft) draft = saved ? { double: saved.double, poison: saved.poison.slice() } : { double: null, poison: [] };
    var cap = captainUid();
    var card = h("div", { class: "card" }, [
      h("h2", { text: me.captain ? "Choose your team's rounds" : "Your team's rounds" }),
      h("p", { class: "small", text: "×2 Double: one round that counts twice at the end. It can still be stolen." }),
      h("p", { class: "small", text: "☠ Poison: " + WQ.NUM_WORD[WQ.DPS_POISON] + " rounds that bite back. Any team that tries to steal one loses those points." }),
      me.captain ? h("p", { class: "muted small", text: "Talk it over with your team, then save. You can change your picks until round 1 starts." })
        : h("p", { class: "muted small", text: (cap ? nameOf(cap) : "Your captain") + " is choosing. Help them decide!" })
    ]);
    var list = h("div", { style: { marginTop: "8px" } });
    dpsRounds().forEach(function (rd) {
      var n = rd.num, isD = draft.double === n, isP = draft.poison.indexOf(n) >= 0;
      var row = h("div", { class: "pick-row" }, [h("span", { class: "topic" }, [h("span", { class: "num", text: n + "." }), rd.topic])]);
      if (me.captain) {
        row.appendChild(h("button", { class: "pick-btn dbl" + (isD ? " on" : ""), type: "button", onclick: function () {
          draftDirty = true;
          draft.double = isD ? null : n;
          draft.poison = draft.poison.filter(function (x) { return x !== n; });
          render();
        } }, ["×2"]));
        row.appendChild(h("button", { class: "pick-btn psn" + (isP ? " on" : ""), type: "button",
          disabled: !isP && draft.poison.length >= WQ.DPS_POISON, onclick: function () {
            draftDirty = true;
            if (isP) draft.poison = draft.poison.filter(function (x) { return x !== n; });
            else { draft.poison.push(n); draft.poison.sort(function (a, b) { return a - b; }); if (draft.double === n) draft.double = null; }
            render();
          } }, ["☠"]));
      } else if (saved) {
        if (saved.double === n) row.appendChild(h("span", { class: "pick-badge dbl", text: "×2 Double" }));
        if (saved.poison.indexOf(n) >= 0) row.appendChild(h("span", { class: "pick-badge psn", text: "☠ Poison" }));
      }
      list.appendChild(row);
    });
    card.appendChild(list);
    if (me.captain) {
      var ok = WQ.picksValid(draft);
      var savedSame = saved && WQ.picksValid(saved) && saved.double === draft.double && saved.poison.join() === draft.poison.join();
      card.appendChild(h("p", { class: "small", style: { marginTop: "10px", fontWeight: "700" },
        text: "Double: " + (draft.double ? 1 : 0) + " of 1 · Poison: " + draft.poison.length + " of " + WQ.DPS_POISON }));
      card.appendChild(h("button", { class: "btn btn-primary btn-big btn-block", type: "button", disabled: !ok || savedSame, onclick: function () {
        L.set(WQ.ref("picks/" + me.team), WQ.writePicks(draft)).then(function () { draftDirty = false; flashMsg = ""; render(); })
          .catch(function () { flashMsg = "Couldn't save your picks. Round 1 may have started."; render(); });
      } }, [savedSame ? "Saved ✓" : "Save picks"]));
      if (savedSame) card.appendChild(h("p", { class: "muted small center", style: { marginTop: "8px" }, text: "Saved. You can still change them until round 1 starts." }));
    } else if (!saved) {
      card.appendChild(h("p", { class: "muted", style: { marginTop: "10px" }, text: "Nothing saved yet." }));
    }
    body.appendChild(card);
    if (flashMsg) body.appendChild(h("div", { class: "status bad", text: flashMsg }));
  }

  function drawSteal(body) {
    if (!me.team) return body.appendChild(teamCard());
    var saved = g.steal;
    if (!stealDraft) stealDraft = saved ? { target: saved.target, round: saved.round } : { target: null, round: null };
    var teams = Object.keys((g.meta && g.meta.teams) || {}).filter(function (t) {
      return t !== me.team && Object.keys(g.assign).some(function (uid) { return g.assign[uid] && g.assign[uid].team === t && g.players[uid]; });
    }).sort(function (a, b) { return teamName(a).localeCompare(teamName(b)); });
    var cap = captainUid();
    var card = h("div", { class: "card" }, [
      h("h2", { text: "🎁 Steal time!" }),
      h("p", { class: "small", text: "Pick another team and one of their rounds. If it was poisoned, your team loses those points. If not, you take them, doubled if it was their double round." }),
      me.captain ? null : h("p", { class: "muted small", text: (cap ? nameOf(cap) : "Your captain") + " is choosing. Help them decide!" })
    ]);
    if (me.captain) {
      card.appendChild(h("h3", { style: { marginTop: "10px" }, text: "1. Which team?" }));
      card.appendChild(h("div", { class: "choice-grid" }, teams.map(function (t) {
        return h("button", { class: "choice" + (stealDraft.target === t ? " on" : ""), type: "button", onclick: function () { stealDirty = true; stealDraft.target = t; render(); } }, [teamName(t)]);
      })));
      card.appendChild(h("h3", { style: { marginTop: "14px" }, text: "2. Which round?" }));
      card.appendChild(h("div", { class: "choice-grid" }, dpsRounds().map(function (rd) {
        return h("button", { class: "choice" + (stealDraft.round === rd.num ? " on" : ""), type: "button", onclick: function () { stealDirty = true; stealDraft.round = rd.num; render(); } },
          [rd.num + ". " + rd.topic]);
      })));
      var ok = stealDraft.target && stealDraft.round;
      var same = saved && saved.target === stealDraft.target && saved.round === stealDraft.round;
      card.appendChild(h("button", { class: "btn btn-primary btn-big btn-block", style: { marginTop: "14px" }, type: "button", disabled: !ok || same, onclick: function () {
        L.set(WQ.ref("steals/" + me.team), { target: stealDraft.target, round: stealDraft.round })
          .then(function () { stealDirty = false; flashMsg = ""; render(); })
          .catch(function () { flashMsg = "Couldn't save your steal. The reveal may have started."; render(); });
      } }, [same ? "Steal locked in ✓" : "Lock in our steal"]));
      if (same) card.appendChild(h("p", { class: "muted small center", style: { marginTop: "8px" }, text: "You can change it until the quiz master starts the reveal." }));
    } else {
      card.appendChild(h("div", { class: "status" + (saved ? " ok" : ""), text: saved
        ? "Your team is stealing round " + saved.round + " (" + topicOf(saved.round) + ") from " + teamName(saved.target) + "."
        : "No steal chosen yet." }));
    }
    body.appendChild(card);
    if (flashMsg) body.appendChild(h("div", { class: "status bad", text: flashMsg }));
  }

  function topicOf(n) {
    var rd = roundsList().filter(function (r) { return r.num === n; })[0];
    return rd ? rd.topic : "Round " + n;
  }

  function drawStealReveal(body, s) {
    var shown = s.shown || {}, n = s.count || 0, rows = [];
    for (var k = 1; k <= n; k++) {
      var x = shown["s" + k];
      if (!x) continue;
      rows.push(h("li", null, [
        h("span", { style: { flex: "1" }, text: x.thief + " → " + x.target + ", R" + x.round + " (" + x.topic + ")" }),
        h("strong", { text: x.outcome === "poison" ? "☠ Poisoned" : x.outcome === "stolen" ? "💰 Stolen" : "…" })
      ]));
    }
    body.appendChild(h("div", { class: "card" }, [
      h("h2", { text: "The steals" }),
      h("p", { class: "muted small", text: "Watch the big screen! The points come out in the final reveal." }),
      rows.length ? h("ul", { class: "list" }, rows) : h("p", { class: "muted", text: "Starting soon…" })
    ]));
  }

  // ---------- Go ----------
  WQ.init().then(start).catch(fatal);
})();
