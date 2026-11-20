// Work Quiz – quiz master (host) screen.
(function () {
  "use strict";
  var L = window.QuizLib, $ = WQ.$, h = WQ.h;

  var quiz = null;      // the full quiz, including answers. Only ever kept on this computer.
  var pendingCheck = null;
  var game = { meta: null, state: null, players: {}, presence: {}, assign: {}, answers: {}, locks: {}, results: {}, pscores: {} };
  var curQid = null, unsubAnswers = null, unsubLocks = null;
  var closeTimer = null, stopCountdown = null;
  var pendingLocks = {};
  var takeoversInHand = {};
  var scoresVisible = false;

  function warn(e) { console.warn(e); }
  function fatal(e) {
    $("fatal-msg").textContent = (e && e.message) || String(e);
    WQ.show("s-error");
  }

  // Two-click confirmation for anything destructive.
  function confirmClick(btn, action) {
    btn.addEventListener("click", function () {
      if (btn.classList.contains("confirming")) {
        btn.classList.remove("confirming");
        btn.textContent = btn.dataset.label;
        action();
        return;
      }
      btn.dataset.label = btn.textContent;
      btn.textContent = "Click again to confirm";
      btn.classList.add("confirming");
      setTimeout(function () {
        if (btn.classList.contains("confirming")) {
          btn.classList.remove("confirming");
          btn.textContent = btn.dataset.label;
        }
      }, 3500);
    });
  }

  // ======================================================================
  // Starting screen
  // ======================================================================
  function showStart() {
    WQ.show("s-start");
    var saved = WQ.store.get("wq-host");
    $("resume-box").hidden = !(saved && saved.code && saved.quiz);
    if (saved && saved.code) $("resume-code").textContent = saved.code;
  }

  $("resume").addEventListener("click", function () {
    var saved = WQ.store.get("wq-host");
    if (!saved) return showStart();
    quiz = saved.quiz;
    openGame(saved.code);
  });
  $("forget").addEventListener("click", function () {
    WQ.store.del("wq-host");
    showStart();
  });

  $("file").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var title = f.name.replace(/\.[^.]+$/, "");
    f.arrayBuffer().then(function (buf) {
      var res;
      try { res = parseQuizFile(buf, title); }
      catch (err) { res = { quiz: null, errors: ["Couldn't read that file: " + err.message], warnings: [] }; }
      showCheck(res);
    });
    e.target.value = "";
  });

  $("use-sample").addEventListener("click", function () {
    showCheck({ quiz: JSON.parse(JSON.stringify(window.WQ_SAMPLE_QUIZ)), errors: [], warnings: [] });
  });

  function parseQuizFile(buf, title) {
    var X = window.XLSXLib;
    var wb = X.read(buf, { type: "array" });
    var errors = [], warnings = [];
    function sheet(name) {
      var key = wb.SheetNames.filter(function (n) { return n.trim().toLowerCase() === name.toLowerCase(); })[0];
      if (!key) { errors.push("The \"" + name + "\" sheet is missing."); return []; }
      return X.utils.sheet_to_json(wb.Sheets[key], { header: 1, defval: "", raw: false });
    }
    var teamRows = sheet("Teams"), roundRows = sheet("Rounds"), qRows = sheet("Questions");
    var str = function (v) { return String(v === null || v === undefined ? "" : v).trim(); };

    var teams = [];
    teamRows.slice(1).forEach(function (r) {
      var n = WQ.cleanName(r[0]);
      if (n && !teams.some(function (t) { return WQ.sameName(t, n); })) teams.push(n);
    });
    if (!teams.length) warnings.push("No team names on the Teams sheet. You can add teams on the next screen.");

    var rounds = {};
    roundRows.slice(1).forEach(function (r) {
      var num = parseInt(r[0], 10);
      if (!(num >= 1 && num <= 10)) return;
      rounds[num] = { num: num, topic: str(r[1]), mode: /agree/i.test(str(r[2])) ? "agree" : "first", questions: [] };
    });

    qRows.slice(1).forEach(function (r, i) {
      var rowNo = i + 2;
      var text = str(r[1]);
      if (!text) return;
      var num = parseInt(r[0], 10);
      if (!(num >= 1 && num <= 10)) { errors.push("Questions row " + rowNo + ": the round must be a number from 1 to 10."); return; }
      var raw = [str(r[2]), str(r[3]), str(r[4]), str(r[5])];
      var count = 0;
      while (count < 4 && raw[count]) count++;
      if (raw.slice(count).some(Boolean)) { errors.push("Questions row " + rowNo + ": fill in the options in order from A, without gaps."); return; }
      if (count < 2) { errors.push("Questions row " + rowNo + ": needs at least options A and B."); return; }
      var ans = str(r[6]).toUpperCase();
      var idx = WQ.LETTERS.indexOf(ans);
      if (idx < 0) { errors.push("Questions row " + rowNo + ": the correct answer must be A, B, C or D."); return; }
      if (idx >= count) { errors.push("Questions row " + rowNo + ": the correct answer is " + ans + ", but option " + ans + " is empty."); return; }
      var secsText = str(r[7]);
      var seconds = secsText ? parseInt(secsText, 10) : 20;
      if (!(seconds >= 5 && seconds <= 120)) {
        warnings.push("Questions row " + rowNo + ": seconds should be between 5 and 120, so 20 will be used.");
        seconds = 20;
      }
      if (!rounds[num]) rounds[num] = { num: num, topic: "", mode: "first", questions: [] };
      rounds[num].questions.push({ text: text, options: raw.slice(0, count), answer: ans, seconds: seconds, picture: str(r[8]) });
    });

    var list = Object.keys(rounds).map(Number).sort(function (a, b) { return a - b; }).map(function (n) { return rounds[n]; })
      .filter(function (rd) {
        if (!rd.questions.length) {
          if (rd.topic) warnings.push("Round " + rd.num + " (" + rd.topic + ") has no questions, so it will be skipped.");
          return false;
        }
        return true;
      });
    var renumbered = false;
    list.forEach(function (rd, i) {
      if (!rd.topic) { warnings.push("Round " + rd.num + " has no topic, so it will be shown as \"Round " + (i + 1) + "\"."); rd.topic = "Round " + (i + 1); }
      if (rd.num !== i + 1) renumbered = true;
      rd.num = i + 1;
    });
    if (renumbered) warnings.push("Some round numbers were skipped, so the rounds have been numbered 1 to " + list.length + " in order.");
    if (!list.length) errors.push("No questions found on the Questions sheet.");
    else if (list.length !== 10) warnings.push("There are " + list.length + " rounds with questions. Standings appear after rounds 4 and 9, and the doubles and steals game expects 10 rounds.");
    if (list.some(function (rd) { return rd.questions.some(function (q) { return q.picture; }); })) {
      warnings.push("Pictures aren't supported yet, so picture file names will be ignored for now.");
    }
    return { quiz: { title: title, teams: teams, rounds: list }, errors: errors, warnings: warnings };
  }

  function showCheck(res) {
    pendingCheck = res;
    var box = $("check-box"), body = WQ.clear($("check-body"));
    box.hidden = false;
    var q = res.quiz;
    $("check-title").textContent = q ? "Quiz check: " + q.title : "Quiz check";
    if (res.errors.length) {
      body.appendChild(h("p", { class: "error", text: "Please fix these in the quiz file, save it, then choose it again:" }));
      body.appendChild(h("ul", { class: "issues" }, res.errors.map(function (e) { return h("li", { class: "error", text: e }); })));
    }
    if (q && q.rounds.length) {
      var nq = q.rounds.reduce(function (s, rd) { return s + rd.questions.length; }, 0);
      body.appendChild(h("p", null, [h("strong", { text: q.rounds.length + " rounds, " + nq + " questions. " }),
        q.teams.length ? "Teams: " + q.teams.join(", ") + "." : "No teams yet."]));
      body.appendChild(h("table", { class: "live-table" }, [
        h("tr", null, [h("th", { text: "Round" }), h("th", { text: "Topic" }), h("th", { text: "How teams answer" }), h("th", { text: "Questions" })])
      ].concat(q.rounds.map(function (rd) {
        return h("tr", null, [h("td", { text: rd.num }), h("td", { text: rd.topic }), h("td", { text: WQ.MODE_LABEL[rd.mode] }), h("td", { class: "num", text: rd.questions.length })]);
      }))));
    }
    if (res.warnings.length) {
      body.appendChild(h("p", { class: "small", style: { marginTop: "12px", fontWeight: "600" }, text: "Worth knowing:" }));
      body.appendChild(h("ul", { class: "issues small" }, res.warnings.map(function (w) { return h("li", { text: w }); })));
    }
    $("create").disabled = !!res.errors.length || !q || !q.rounds.length;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("create").addEventListener("click", function () {
    if (!pendingCheck || !pendingCheck.quiz) return;
    quiz = pendingCheck.quiz;
    $("create").disabled = true;
    createGame(0);
  });

  function randomCode() {
    var abc = "ABCDEFGHJKMNPQRSTUVWXYZ", s = "";
    for (var i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }

  function createGame(tries) {
    var code = randomCode();
    var teams = {};
    quiz.teams.forEach(function (name, i) { teams["t" + (i + 1)] = { name: name, order: i + 1 }; });
    var rounds = {};
    quiz.rounds.forEach(function (rd) { rounds["r" + rd.num] = { num: rd.num, topic: rd.topic, mode: rd.mode, count: rd.questions.length }; });
    var meta = { hostUid: WQ.uid, created: L.serverTimestamp(), title: quiz.title, teams: teams, rounds: rounds, totalRounds: quiz.rounds.length };
    L.set(L.ref(WQ.db, "games/" + code + "/meta"), meta)
      .then(function () { return L.set(L.ref(WQ.db, "games/" + code + "/state"), { phase: "lobby" }); })
      .then(function () {
        WQ.store.set("wq-host", { code: code, quiz: quiz });
        openGame(code);
      })
      .catch(function (err) {
        if (tries < 5 && /permission/i.test(String(err && (err.code || err.message)))) return createGame(tries + 1);
        $("start-error").textContent = "Couldn't create the game: " + ((err && err.message) || err);
        $("create").disabled = false;
      });
  }

  // ======================================================================
  // Game screen
  // ======================================================================
  function openGame(code) {
    WQ.code = code;
    WQ.show("s-game");
    $("g-code").textContent = code;
    $("g-title").textContent = quiz.title || "Quiz";
    var join = WQ.joinUrl(code);
    $("g-join").href = join; $("g-join").textContent = join.replace(/^https?:\/\//, "");
    $("g-display").href = WQ.displayUrl(code);
    WQ.drawQr($("g-qr"), join);

    WQ.listen("meta", function (v) {
      game.meta = v;
      if (v && v.hostUid !== WQ.uid) fatal(new Error("Game " + code + " was created on a different browser or computer, so it can't be controlled from here. Start a new game instead."));
      render();
    });
    WQ.listen("state", function (v) { game.state = v || { phase: "lobby" }; onState(); render(); });
    WQ.listen("players", function (v) { game.players = v || {}; handleTakeovers(); render(); });
    WQ.listen("presence", function (v) { game.presence = v || {}; checkLocks(); render(); });
    WQ.listen("assign", function (v) { game.assign = v || {}; render(); });
    WQ.listen("results", function (v) { game.results = v || {}; render(); });
    WQ.listen("pscores", function (v) { game.pscores = v || {}; render(); });
  }

  confirmClick($("g-new"), function () {
    WQ.store.del("wq-host");
    location.href = location.pathname;
  });

  // ---------- Lookups ----------
  function teamsMeta() { return (game.meta && game.meta.teams) || {}; }
  function teamIds() {
    var t = teamsMeta();
    return Object.keys(t).sort(function (a, b) { return (t[a].order || 0) - (t[b].order || 0); });
  }
  function teamName(tid) { var t = teamsMeta()[tid]; return t ? t.name : "?"; }
  function playerName(uid) { var p = game.players[uid]; return p ? p.name : "Someone"; }
  function isOnline(uid) { var p = game.presence[uid]; return !!(p && p.online); }
  function teamOf(uid) { var a = game.assign[uid]; return a && teamsMeta()[a.team] ? a.team : null; }
  function membersOf(tid) {
    return Object.keys(game.players).filter(function (uid) { return teamOf(uid) === tid; })
      .sort(function (a, b) { return playerName(a).localeCompare(playerName(b)); });
  }
  function captainOf(tid) {
    return membersOf(tid).filter(function (uid) { return game.assign[uid].captain; })[0] || null;
  }
  function activeTeams() { return teamIds().filter(function (tid) { return membersOf(tid).length > 0; }); }
  function unassigned() {
    return Object.keys(game.players).filter(function (uid) { return !teamOf(uid); })
      .sort(function (a, b) { return playerName(a).localeCompare(playerName(b)); });
  }
  function roundOf(n) { return quiz.rounds[n - 1]; }
  // Earliest answer in a team (answers arrive in the order the database received them).
  function firstAnswer(ans) {
    var best = null;
    Object.keys(ans || {}).forEach(function (uid) {
      var a = ans[uid];
      if (a && typeof a.at === "number" && (!best || a.at < best.at)) best = { uid: uid, opt: a.opt, at: a.at };
    });
    return best;
  }
  function currentQuestion() {
    var s = game.state; var rd = s && roundOf(s.round);
    return rd && s.qNum ? rd.questions[s.qNum - 1] : null;
  }
  function teamTotal(tid, round) { var r = game.results[tid]; return WQ.sumPoints(r && r.q, round); }
  function playerTotal(uid, round) { var p = game.pscores[uid]; return WQ.sumPoints(p && p.q, round); }

  // ---------- Reacting to state ----------
  function onState() {
    var s = game.state;
    if (s.qid !== curQid) {
      if (unsubAnswers) unsubAnswers();
      if (unsubLocks) unsubLocks();
      unsubAnswers = unsubLocks = null;
      curQid = s.qid || null;
      game.answers = {}; game.locks = {};
      if (curQid) {
        unsubAnswers = WQ.listen("answers/" + curQid, function (v) { game.answers = v || {}; checkLocks(); render(); });
        unsubLocks = WQ.listen("locks/" + curQid, function (v) { game.locks = v || {}; updateLockedCount(); checkLocks(); render(); });
      }
    }
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    if (stopCountdown) { stopCountdown(); stopCountdown = null; }
    WQ.clear($("c-timer"));
    if (s.phase === "question" && typeof s.startAt === "number") {
      var ms = s.startAt + s.seconds * 1000 + WQ.GRACE_MS - WQ.now();
      var qid = s.qid;
      closeTimer = setTimeout(function () {
        if (game.state.phase === "question" && game.state.qid === qid) closeQuestion();
      }, Math.max(0, ms));
      var bar = WQ.timerBar();
      $("c-timer").appendChild(bar);
      stopCountdown = WQ.countdown(s.startAt, s.seconds, bar.update);
    }
  }

  // Lock in team answers as they happen (the first tap in a team, or everyone agreeing).
  function checkLocks() {
    var s = game.state;
    if (!s || s.phase !== "question" || !s.qid) return;
    var upd = {};
    activeTeams().forEach(function (tid) {
      var key = "locks/" + s.qid + "/" + tid;
      if (game.locks[tid] || pendingLocks[key]) return;
      var ans = game.answers[tid] || {};
      if (s.mode !== "agree") {
        var first = firstAnswer(ans);
        if (first) upd[key] = { opt: first.opt, at: first.at, how: "first", by: first.uid };
      } else {
        var online = membersOf(tid).filter(isOnline);
        if (!online.length) return;
        var picks = online.map(function (uid) { return ans[uid]; });
        if (picks.every(Boolean) && picks.every(function (p) { return p.opt === picks[0].opt; })) {
          upd[key] = { opt: picks[0].opt, at: Math.max.apply(null, picks.map(function (p) { return p.at; })), how: "agreed" };
        }
      }
    });
    var keys = Object.keys(upd);
    if (keys.length) {
      keys.forEach(function (k) { pendingLocks[k] = true; });
      L.update(WQ.ref(""), upd).catch(warn);
    }
    maybeCloseEarly();
  }

  function updateLockedCount() {
    var s = game.state;
    if (!s || s.phase !== "question") return;
    var n = Object.keys(game.locks).length;
    if (s.lockedCount !== n) L.update(WQ.ref("state"), { lockedCount: n }).catch(warn);
  }

  function maybeCloseEarly() {
    var s = game.state;
    if (!s || s.phase !== "question") return;
    var teams = activeTeams();
    if (!teams.length) return;
    var allDone = teams.every(function (tid) {
      if (!game.locks[tid]) return false;
      var ans = game.answers[tid] || {};
      return membersOf(tid).filter(isOnline).every(function (uid) { return ans[uid]; });
    });
    if (allDone) closeQuestion();
  }

  function closeQuestion() {
    if (game.state.phase !== "question") return;
    L.update(WQ.ref("state"), { phase: "closed" }).catch(warn);
  }

  // ---------- Moving through the quiz ----------
  function startQuestion(r, n) {
    var rd = roundOf(r), q = rd.questions[n - 1];
    return L.set(WQ.ref("state"), {
      phase: "question", round: r, roundTopic: rd.topic, mode: rd.mode, totalRounds: quiz.rounds.length,
      qNum: n, qCount: rd.questions.length, qid: "r" + r + "q" + n,
      question: { text: q.text, options: q.options }, seconds: q.seconds,
      startAt: L.serverTimestamp(), lockedCount: 0, teamCount: activeTeams().length
    });
  }

  function roundIntro(r) {
    var rd = roundOf(r);
    return L.set(WQ.ref("state"), {
      phase: "roundIntro", round: r, roundTopic: rd.topic, mode: rd.mode, qCount: rd.questions.length, totalRounds: quiz.rounds.length
    });
  }

  function revealAnswer() {
    var s = game.state, q = currentQuestion();
    if (!q || s.phase !== "closed") return;
    var correct = q.answer, total = s.seconds * 1000;
    Promise.all([L.get(WQ.ref("answers/" + s.qid)), L.get(WQ.ref("locks/" + s.qid))]).then(function (snaps) {
      var answers = snaps[0].val() || {}, locks = snaps[1].val() || {};
      var upd = {};
      activeTeams().forEach(function (tid) {
        var ans = answers[tid] || {}, lock = locks[tid], cap = captainOf(tid), res;
        if (lock) {
          res = { opt: lock.opt, how: lock.how, correct: lock.opt === correct,
                  points: lock.opt === correct ? WQ.speedPoints(lock.at - s.startAt, total) : 0 };
          if (lock.by) res.by = lock.by;
        } else if (cap && ans[cap] && s.mode === "agree") {
          res = { opt: ans[cap].opt, how: "timeout", correct: ans[cap].opt === correct,
                  points: ans[cap].opt === correct ? WQ.POINTS_TIMEOUT : 0 };
        } else if (s.mode !== "agree" && firstAnswer(ans)) {
          var fa = firstAnswer(ans);
          res = { opt: fa.opt, how: "first", by: fa.uid, correct: fa.opt === correct,
                  points: fa.opt === correct ? WQ.speedPoints(fa.at - s.startAt, total) : 0 };
        } else {
          res = { opt: "", how: "none", correct: false, points: 0 };
        }
        res.round = s.round; res.q = s.qNum;
        upd["results/" + tid + "/q/" + s.qid] = res;
      });
      Object.keys(answers).forEach(function (tid) {
        Object.keys(answers[tid] || {}).forEach(function (uid) {
          var a = answers[tid][uid], ok = a.opt === correct;
          upd["pscores/" + uid + "/q/" + s.qid] = { round: s.round, opt: a.opt, correct: ok,
            points: ok ? WQ.speedPoints(a.at - s.startAt, total) : 0 };
        });
      });
      upd["state/phase"] = "reveal";
      upd["state/correct"] = correct;
      return L.update(WQ.ref(""), upd);
    }).catch(function (e) { alertBox("Couldn't reveal the answer: " + ((e && e.message) || e)); });
  }

  function showStandings() {
    var s = game.state;
    var table = WQ.halfTable(activeTeams().map(function (tid) { return { name: teamName(tid), points: teamTotal(tid) }; }));
    return L.set(WQ.ref("state"), { phase: "standings", round: s.round, totalRounds: quiz.rounds.length, standings: table });
  }

  function finish() {
    var teams = activeTeams().map(function (tid) { return { name: teamName(tid), points: teamTotal(tid) }; })
      .sort(function (a, b) { return b.points - a.points; });
    var players = Object.keys(game.players).map(function (uid) { return { name: playerName(uid), points: playerTotal(uid) }; })
      .sort(function (a, b) { return b.points - a.points; }).slice(0, 5);
    return L.set(WQ.ref("state"), { phase: "end", totalRounds: quiz.rounds.length, final: { teams: teams, players: players } });
  }

  function nextStep() {
    var s = game.state || { phase: "lobby" };
    var total = quiz.rounds.length;
    switch (s.phase) {
      case "lobby": return { label: "Start quiz (show the round topics)", run: function () { return L.set(WQ.ref("state"), { phase: "topics", totalRounds: total }); } };
      case "topics": return { label: "Start round 1", run: function () { return roundIntro(1); } };
      case "roundIntro": return { label: "Start question 1", run: function () { return startQuestion(s.round, 1); } };
      case "question": return { label: "Waiting for answers…", disabled: true };
      case "closed": return { label: "Reveal the answer", run: revealAnswer };
      case "reveal":
        if (s.qNum < s.qCount) return { label: "Next question (" + (s.qNum + 1) + " of " + s.qCount + ")", run: function () { return startQuestion(s.round, s.qNum + 1); } };
        return { label: "End round " + s.round, run: function () { return L.update(WQ.ref("state"), { phase: "roundEnd" }); } };
      case "roundEnd":
        if (WQ.STANDINGS_AFTER.indexOf(s.round) >= 0 && s.round < total) return { label: "Show the standings", run: showStandings };
        if (s.round < total) return { label: "Start round " + (s.round + 1), run: function () { return roundIntro(s.round + 1); } };
        return { label: "Finish the quiz", run: finish };
      case "standings": return { label: "Start round " + (s.round + 1), run: function () { return roundIntro(s.round + 1); } };
      case "end": return { label: "Quiz finished", disabled: true };
    }
    return { label: "…", disabled: true };
  }

  var busy = false;
  $("c-next").addEventListener("click", function () {
    var step = nextStep();
    if (!step.run || busy) return;
    busy = true; $("c-next").disabled = true;
    Promise.resolve(step.run()).catch(function (e) { alertBox((e && e.message) || String(e)); })
      .then(function () { busy = false; render(); });
  });
  $("c-end-q").addEventListener("click", closeQuestion);

  function alertBox(msg) {
    var issues = $("c-issues");
    issues.insertBefore(h("li", { class: "error", text: msg }), issues.firstChild);
  }

  // ---------- Teams ----------
  function update(paths) { return L.update(WQ.ref(""), paths).catch(function (e) { alertBox((e && e.message) || String(e)); }); }

  function moveTo(uid, tid) {
    var p = {};
    p["assign/" + uid] = tid ? { team: tid, captain: false } : null;
    update(p);
  }
  function toggleCaptain(uid) {
    var tid = teamOf(uid); if (!tid) return;
    var makeCaptain = !game.assign[uid].captain;
    var p = {};
    membersOf(tid).forEach(function (m) { p["assign/" + m + "/captain"] = makeCaptain && m === uid; });
    update(p);
  }
  function removePlayer(uid) {
    var p = {};
    p["players/" + uid] = null; p["presence/" + uid] = null; p["assign/" + uid] = null;
    update(p);
  }
  function shuffle(everyone) {
    var tids = teamIds();
    if (!tids.length) return alertBox("Add a team first.");
    var counts = {};
    tids.forEach(function (t) { counts[t] = everyone ? 0 : membersOf(t).length; });
    var pool = everyone ? Object.keys(game.players) : unassigned();
    for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp; }
    var p = {};
    pool.forEach(function (uid) {
      var min = Math.min.apply(null, tids.map(function (t) { return counts[t]; }));
      var choices = tids.filter(function (t) { return counts[t] === min; });
      var t = choices[Math.floor(Math.random() * choices.length)];
      counts[t]++;
      p["assign/" + uid] = { team: t, captain: false };
    });
    update(p);
  }
  function pickCaptains() {
    var p = {};
    activeTeams().forEach(function (tid) {
      if (captainOf(tid)) return;
      var m = membersOf(tid), online = m.filter(isOnline), pool = online.length ? online : m;
      p["assign/" + pool[Math.floor(Math.random() * pool.length)] + "/captain"] = true;
    });
    if (Object.keys(p).length) update(p);
  }
  function addTeam() {
    var ids = teamIds();
    var n = ids.reduce(function (mx, id) { return Math.max(mx, parseInt(id.slice(1), 10) || 0); }, 0) + 1;
    var order = ids.reduce(function (mx, id) { return Math.max(mx, teamsMeta()[id].order || 0); }, 0) + 1;
    var p = {};
    p["meta/teams/t" + n] = { name: "Team " + n, order: order };
    update(p);
  }

  $("t-shuffle").addEventListener("click", function () { shuffle(false); });
  confirmClick($("t-reshuffle"), function () { shuffle(true); });
  $("t-captains").addEventListener("click", pickCaptains);
  $("t-add").addEventListener("click", addTeam);

  // Someone rejoined on a new device with the same name: give them their old place.
  function handleTakeovers() {
    Object.keys(game.players).forEach(function (uid) {
      var pl = game.players[uid];
      if (!pl || !pl.takeover || takeoversInHand[uid]) return;
      takeoversInHand[uid] = true;
      var old = pl.takeover, op = game.players[old], p = {};
      if (op && old !== uid && WQ.sameName(op.name, pl.name) && !isOnline(old)) {
        if (game.assign[old]) p["assign/" + uid] = game.assign[old];
        if (game.pscores[old]) p["pscores/" + uid] = game.pscores[old];
        p["players/" + old] = null; p["presence/" + old] = null; p["assign/" + old] = null; p["pscores/" + old] = null;
      }
      p["players/" + uid + "/takeover"] = null;
      L.update(WQ.ref(""), p).catch(warn).then(function () { delete takeoversInHand[uid]; });
    });
  }

  // ======================================================================
  // Rendering
  // ======================================================================
  var renderQueued = false;
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; renderTeams(); renderControl(); renderScores(); });
  }

  var teamsRenderPending = false;
  function renderTeams() {
    var active = document.activeElement;
    if (active && $("teams-panel").contains(active) && (active.tagName === "INPUT" || active.tagName === "SELECT")) {
      teamsRenderPending = true;
      return;
    }
    teamsRenderPending = false;
    var cols = WQ.clear($("t-cols"));
    var tids = teamIds();
    var nPlayers = Object.keys(game.players).length;
    var nOnline = Object.keys(game.players).filter(isOnline).length;
    $("t-count").textContent = nPlayers + " joined, " + nOnline + " connected";

    function memberRow(uid) {
      var tid = teamOf(uid), a = game.assign[uid];
      var sel = h("select", { "aria-label": "Team for " + playerName(uid) },
        [h("option", { value: "", text: "Unassigned" })].concat(tids.map(function (t) {
          return h("option", { value: t, text: teamName(t), selected: t === tid });
        })));
      sel.addEventListener("change", function () { var v = sel.value; sel.blur(); moveTo(uid, v); });
      var star = tid ? h("button", { class: "icon-btn" + (a && a.captain ? " star-on" : ""), title: "Captain", text: a && a.captain ? "★" : "☆",
        onclick: function () { toggleCaptain(uid); } }) : null;
      var del = h("button", { class: "icon-btn", title: "Remove " + playerName(uid), text: "✕" });
      confirmClick(del, function () { removePlayer(uid); });
      return h("div", { class: "member" }, [
        h("span", { class: "dot" + (isOnline(uid) ? " on" : "") }),
        h("span", { class: "name", text: playerName(uid) }), star, sel, del
      ]);
    }

    var un = unassigned();
    if (un.length || !tids.length) {
      cols.appendChild(h("div", { class: "team-col unassigned" }, [
        h("h3", { text: "Not in a team yet (" + un.length + ")" })
      ].concat(un.length ? un.map(memberRow) : [h("p", { class: "muted small", text: "Nobody waiting." })])));
    }
    tids.forEach(function (tid) {
      var members = membersOf(tid);
      var nameInput = h("input", { type: "text", value: teamName(tid), "data-tid": tid, "aria-label": "Team name" });
      nameInput.addEventListener("change", function () {
        var v = WQ.cleanName(nameInput.value);
        if (v) { var p = {}; p["meta/teams/" + tid + "/name"] = v; update(p); }
        nameInput.blur();
      });
      nameInput.addEventListener("blur", function () { if (teamsRenderPending) render(); });
      nameInput.addEventListener("keydown", function (e) { if (e.key === "Enter") nameInput.blur(); });
      var head = [nameInput];
      if (!members.length) {
        var delT = h("button", { class: "icon-btn", title: "Remove empty team", text: "✕" });
        confirmClick(delT, function () { var p = {}; p["meta/teams/" + tid] = null; update(p); });
        head.push(delT);
      }
      var badge = members.length && !captainOf(tid) ? h("span", { class: "pill pill-warn", text: "No captain" }) : null;
      cols.appendChild(h("div", { class: "team-col" }, [
        h("h3", null, head),
        h("div", { class: "row small muted", style: { marginBottom: "4px" } }, [members.length + (members.length === 1 ? " person" : " people"), badge])
      ].concat(members.map(memberRow))));
    });
  }

  function renderControl() {
    var s = game.state || { phase: "lobby" };
    var total = quiz.rounds.length;
    var phaseText = {
      lobby: "Lobby: people are joining",
      topics: "Showing the round topics",
      roundIntro: "Round " + s.round + " intro",
      question: "Question live",
      closed: "Time's up",
      reveal: "Answer revealed",
      roundEnd: "End of round " + s.round,
      standings: "Standings after round " + s.round,
      end: "Quiz finished"
    }[s.phase] || s.phase;
    $("c-phase").textContent = phaseText;
    var where = "";
    if (s.round) {
      where = "Round " + s.round + " of " + total + " · " + (s.roundTopic || "") + " · " + (WQ.MODE_LABEL[s.mode] || "");
      if (s.qNum && ["question", "closed", "reveal"].indexOf(s.phase) >= 0) where += " · Question " + s.qNum + " of " + s.qCount;
    }
    $("c-where").textContent = where;

    // Question preview, for reading out
    var qbox = WQ.clear($("c-question"));
    var q = currentQuestion();
    var showQ = q && ["question", "closed", "reveal"].indexOf(s.phase) >= 0;
    if (!showQ && s.phase === "roundIntro") { q = roundOf(s.round).questions[0]; showQ = !!q; }
    if (!showQ && s.phase === "reveal") showQ = false;
    if (showQ) {
      var upcoming = s.phase === "roundIntro";
      qbox.appendChild(h("div", { class: "card", style: { background: "#f6f7fb", marginTop: "10px" } }, [
        h("div", { class: "muted small", text: upcoming ? "Up next" : "Question" }),
        h("div", { style: { fontWeight: "700", fontSize: "1.1rem", margin: "4px 0 8px" }, text: q.text }),
        h("div", { class: "small" }, q.options.map(function (o, i) {
          var isAns = WQ.LETTERS[i] === q.answer;
          return h("div", { style: isAns ? { fontWeight: "800", color: "var(--ok)" } : null, text: WQ.LETTERS[i] + ". " + o + (isAns ? "  ✓ answer" : "") });
        }))
      ]));
    }

    // Issues to sort out before starting
    var issues = WQ.clear($("c-issues"));
    if (s.phase === "lobby" || s.phase === "topics") {
      var list = [];
      var un = unassigned().length;
      if (!Object.keys(game.players).length) list.push("Nobody has joined yet.");
      if (un) list.push(un + (un === 1 ? " person isn't" : " people aren't") + " in a team yet.");
      activeTeams().forEach(function (tid) { if (!captainOf(tid)) list.push(teamName(tid) + " has no captain."); });
      list.forEach(function (t) { issues.appendChild(h("li", { class: "pill-warn", style: { padding: "4px 8px", borderRadius: "8px", marginTop: "4px" }, text: t })); });
    } else if (["roundIntro", "question"].indexOf(s.phase) >= 0 && s.mode === "agree") {
      activeTeams().forEach(function (tid) {
        var cap = captainOf(tid);
        if (!cap) issues.appendChild(h("li", { class: "error", text: teamName(tid) + " has no captain." }));
        else if (!isOnline(cap)) issues.appendChild(h("li", { class: "error", text: teamName(tid) + "'s captain (" + playerName(cap) + ") isn't connected. You can make someone else captain." }));
      });
      var un2 = unassigned().length;
      if (un2) issues.appendChild(h("li", { class: "error", text: un2 + " waiting to be put in a team." }));
    }

    var step = nextStep();
    var btn = $("c-next");
    btn.textContent = step.label;
    btn.disabled = !!step.disabled || busy;
    $("c-end-q").hidden = s.phase !== "question";

    // Live table
    var live = $("c-live");
    var showLive = ["question", "closed", "reveal"].indexOf(s.phase) >= 0;
    live.hidden = !showLive;
    WQ.clear(live);
    if (showLive) {
      live.appendChild(h("tr", null, [h("th", { text: "Team" }), h("th", { text: "Answered" }), h("th", { text: "Team answer" }), h("th", { class: "num", text: s.phase === "reveal" ? "Points" : "" })]));
      activeTeams().forEach(function (tid) {
        var members = membersOf(tid), online = members.filter(isOnline), ans = game.answers[tid] || {};
        var answered = members.filter(function (uid) { return ans[uid]; }).length;
        var lock = game.locks[tid];
        var res = s.phase === "reveal" && game.results[tid] && game.results[tid].q ? game.results[tid].q[s.qid] : null;
        var howText = function (x) {
          if (x.how === "first") return "first in: " + playerName(x.by);
          return { agreed: "agreed", timeout: "time ran out: captain's pick", none: "no answer" }[x.how] || x.how;
        };
        var teamAns = res ? (res.opt ? res.opt + " (" + howText(res) + ")" : "No answer")
          : lock ? lock.opt + " (" + howText(lock) + ")" : (s.phase === "question" ? "…" : "not locked");
        live.appendChild(h("tr", null, [
          h("td", { text: teamName(tid) }),
          h("td", { text: answered + " / " + members.length + (online.length < members.length ? " (" + online.length + " connected)" : "") }),
          h("td", { text: teamAns }),
          h("td", { class: "num", text: res ? WQ.fmt(res.points) : "" })
        ]));
      });
    }
  }

  $("sc-toggle").addEventListener("click", function () {
    scoresVisible = !scoresVisible;
    $("sc-toggle").textContent = scoresVisible ? "Hide" : "Show";
    renderScores();
  });

  function renderScores() {
    var body = $("sc-body");
    body.hidden = !scoresVisible;
    if (!scoresVisible) return;
    WQ.clear(body);
    var teams = activeTeams().map(function (tid) { return { name: teamName(tid), points: teamTotal(tid) }; })
      .sort(function (a, b) { return b.points - a.points; });
    body.appendChild(h("table", { class: "live-table" }, [h("tr", null, [h("th", { text: "Team" }), h("th", { class: "num", text: "Points" })])]
      .concat(teams.map(function (t) { return h("tr", null, [h("td", { text: t.name }), h("td", { class: "num", text: WQ.fmt(t.points) })]); }))));
    var players = Object.keys(game.players).map(function (uid) { return { name: playerName(uid), points: playerTotal(uid) }; })
      .sort(function (a, b) { return b.points - a.points; }).slice(0, 10);
    body.appendChild(h("h3", { style: { marginTop: "14px" }, text: "Top players" }));
    body.appendChild(h("table", { class: "live-table" }, players.map(function (p, i) {
      return h("tr", null, [h("td", { text: (i + 1) + ". " + p.name }), h("td", { class: "num", text: WQ.fmt(p.points) })]);
    })));
  }

  // ======================================================================
  WQ.init().then(function () {
    WQ.watchConnection();
    showStart();
  }).catch(fatal);
})();
