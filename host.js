// Work Quiz – quiz master (host) screen.
(function () {
  "use strict";
  var L = window.QuizLib, $ = WQ.$, h = WQ.h;

  var quiz = null;      // the full quiz, including answers. Only ever kept on this computer.
  var pendingCheck = null;
  var game = { meta: null, state: null, players: {}, presence: {}, assign: {}, answers: {}, locks: {}, results: {}, pscores: {}, picks: {}, steals: {}, picsLoaded: {} };
  var curQid = null, unsubAnswers = null, unsubLocks = null, unsubVotes = null, phaseTimer = null;
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
  $("version").textContent = "Version " + (WQ.VERSION || "1 (old files still loaded: press Ctrl+F5)");
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
    PicStore.get(saved.code).then(function (map) {
      Object.keys(map || {}).forEach(function (k) { if (!picData[k]) picData[k] = map[k]; });
      openGame(saved.code);
    });
  });
  $("forget").addEventListener("click", function () {
    WQ.store.del("wq-host");
    showStart();
  });

  $("file").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var title = f.name.replace(/\.[^.]+$/, "");
    picData = {};
    f.arrayBuffer().then(function (buf) {
      var res;
      try { res = parseQuizFile(buf, title); }
      catch (err) { res = { quiz: null, errors: ["Couldn't read that file: " + err.message], warnings: [] }; }
      showCheck(res);
    });
    e.target.value = "";
  });

  // Helper for writing pin questions: click a picture to read off Target X % and Target Y %.
  $("spot-file").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    var url = URL.createObjectURL(f), img = new Image();
    img.onload = function () {
      var box = WQ.clear($("spot-box"));
      $("spot-name").textContent = f.name;
      $("spot-out").textContent = "Click the right spot on the picture.";
      var board = WQ.pinBoard({ pic: { src: url, w: img.naturalWidth || 1000, h: img.naturalHeight || 750 }, interactive: true, zoom: true,
        maxH: function () { return Math.min(560, window.innerHeight * 0.7); },
        onChange: function (p) {
          if (!p) return;
          $("spot-out").textContent = "Target X %: " + (Math.round(p.x * 10) / 10) + "    Target Y %: " + (Math.round(p.y * 10) / 10);
        } });
      box.appendChild(board.el);
      board.refresh();
    };
    img.src = url;
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
    // Columns are found by their headings, so older quiz files (without the newer columns) still load.
    var norm = function (v) { return str(v).toLowerCase().replace(/[^a-z0-9]/g, ""); };
    function columns(header, spec) {
      var heads = (header || []).map(norm), out = {};
      Object.keys(spec).forEach(function (key) {
        var names = spec[key][0], fallback = spec[key][1], idx = -1;
        names.forEach(function (n) { if (idx < 0) idx = heads.indexOf(n); });
        names.forEach(function (n) { if (idx < 0) heads.forEach(function (hd, i) { if (idx < 0 && hd && hd.indexOf(n) === 0) idx = i; }); });
        out[key] = idx >= 0 ? idx : fallback;
      });
      return out;
    }
    var cell = function (r, i) { return i === null || i < 0 ? "" : str(r[i]); };
    var num01 = function (v) {
      var t = str(v).replace("%", "").replace(",", ".");
      if (!t) return null;
      var n = parseFloat(t);
      return isFinite(n) ? n : null;
    };

    var teams = [];
    teamRows.slice(1).forEach(function (r) {
      var n = WQ.cleanName(r[0]);
      if (n && !teams.some(function (t) { return WQ.sameName(t, n); })) teams.push(n);
    });
    if (!teams.length) warnings.push("No team names on the Teams sheet. You can add teams on the next screen.");

    var rc = columns(roundRows[0], { round: [["round"], 0], topic: [["topic"], 1], type: [["roundtype", "type"], null], mode: [["howteamsanswer", "mode"], 2] });
    var rounds = {};
    roundRows.slice(1).forEach(function (r) {
      var num = parseInt(cell(r, rc.round), 10);
      if (!(num >= 1 && num <= 10)) return;
      var type = /pin/i.test(cell(r, rc.type)) ? "pin" : "mc";
      var mode = /agree/i.test(cell(r, rc.mode)) ? "agree" : "first";
      if (type === "pin" && mode === "agree") {
        warnings.push("Round " + num + " is a pin round, so it will use First answer counts (teammates can't all tap exactly the same spot).");
        mode = "first";
      }
      rounds[num] = { num: num, topic: cell(r, rc.topic), type: type, mode: mode, questions: [] };
    });

    var qc = columns(qRows[0], {
      round: [["round"], 0], question: [["question"], 1], a: [["optiona"], 2], b: [["optionb"], 3], c: [["optionc"], 4], d: [["optiond"], 5],
      answer: [["correctanswer", "answer"], 6], seconds: [["seconds"], 7], picture: [["picture"], 8],
      tx: [["targetx"], null], ty: [["targety"], null], level: [["difficulty"], null], marker: [["marker"], null],
      full: [["showfirst"], null], showFor: [["showfor"], null]
    });
    qRows.slice(1).forEach(function (r, i) {
      var rowNo = i + 2;
      var text = cell(r, qc.question);
      if (!text) return;
      var num = parseInt(cell(r, qc.round), 10);
      if (!(num >= 1 && num <= 10)) { errors.push("Questions row " + rowNo + ": the round must be a number from 1 to 10."); return; }
      if (!rounds[num]) rounds[num] = { num: num, topic: "", type: "mc", mode: "first", questions: [] };
      var isPin = rounds[num].type === "pin";
      var picture = cell(r, qc.picture);
      var secsText = cell(r, qc.seconds);
      var defSecs = isPin ? WQ.PIN_SECONDS : 20;
      var seconds = secsText ? parseInt(secsText, 10) : defSecs;
      if (!(seconds >= 5 && seconds <= 120)) {
        warnings.push("Questions row " + rowNo + ": seconds should be between 5 and 120, so " + defSecs + " will be used.");
        seconds = defSecs;
      }
      if (isPin) {
        if (!picture) { errors.push("Questions row " + rowNo + ": a pin question needs a picture file name in the Picture column."); return; }
        var tx = num01(cell(r, qc.tx)), ty = num01(cell(r, qc.ty));
        if (tx === null || ty === null || tx < 0 || tx > 100 || ty < 0 || ty > 100) {
          errors.push("Questions row " + rowNo + ": a pin question needs Target X % and Target Y % (numbers from 0 to 100, measured from the top-left corner).");
          return;
        }
        var lvText = cell(r, qc.level).toLowerCase(), level = "medium";
        if (/^e/.test(lvText)) level = "easy"; else if (/^h/.test(lvText)) level = "hard";
        else if (lvText && !/^m/.test(lvText)) warnings.push("Questions row " + rowNo + ": difficulty should be Easy, Medium or Hard, so Medium will be used.");
        var mkText = cell(r, qc.marker), marker = WQ.markerName(mkText) || "pin";
        if (mkText && !WQ.markerName(mkText)) warnings.push("Questions row " + rowNo + ": the marker should be Pin, Tail, Carrot or Earth, so Pin will be used.");
        if ([qc.a, qc.b, qc.c, qc.d, qc.answer].some(function (k) { return cell(r, k); })) warnings.push("Questions row " + rowNo + ": the options and correct answer are ignored in pin rounds.");
        var pq = { kind: "pin", text: text, picture: picture, target: { x: tx, y: ty }, level: level, marker: marker, seconds: seconds };
        var full = cell(r, qc.full);
        if (full) {
          var sfText = cell(r, qc.showFor), showFor = sfText ? parseInt(sfText, 10) : WQ.SHOW_FOR;
          if (!(showFor >= 2 && showFor <= 15)) {
            warnings.push("Questions row " + rowNo + ": Show for should be 2 to 15 seconds, so " + WQ.SHOW_FOR + " will be used.");
            showFor = WQ.SHOW_FOR;
          }
          pq.full = full; pq.showFor = showFor;
        }
        rounds[num].questions.push(pq);
        return;
      }
      var raw = [cell(r, qc.a), cell(r, qc.b), cell(r, qc.c), cell(r, qc.d)];
      var count = 0;
      while (count < 4 && raw[count]) count++;
      if (raw.slice(count).some(Boolean)) { errors.push("Questions row " + rowNo + ": fill in the options in order from A, without gaps."); return; }
      if (count < 2) { errors.push("Questions row " + rowNo + ": needs at least options A and B."); return; }
      var ans = cell(r, qc.answer).toUpperCase();
      var idx = WQ.LETTERS.indexOf(ans);
      if (idx < 0) { errors.push("Questions row " + rowNo + ": the correct answer must be A, B, C or D."); return; }
      if (idx >= count) { errors.push("Questions row " + rowNo + ": the correct answer is " + ans + ", but option " + ans + " is empty."); return; }
      if (cell(r, qc.full)) warnings.push("Questions row " + rowNo + ": Show first is only used in pin rounds, so it will be ignored.");
      rounds[num].questions.push({ text: text, options: raw.slice(0, count), answer: ans, seconds: seconds, picture: picture });
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
    return { quiz: { title: title, teams: teams, rounds: list }, errors: errors, warnings: warnings };
  }

  // ======================================================================
  // Pictures: read from the quiz folder on this computer, shrunk, and only sent out just before their question.
  // ======================================================================
  var picData = {};    // picture file name (lower case) → { data, w, h }
  var picsSent = {};   // question id → true, for pictures already sent to phones this session
  var lastSentPic = null;
  function picKey(name) { return String(name || "").trim().toLowerCase(); }
  function localPic(name) { return picData[picKey(name)] || null; }
  function picDims(name) { var d = localPic(name) || WQ.builtinPic(name); return d ? { w: d.w, h: d.h } : { w: 4, h: 3 }; }
  function neededPics(qz) {
    var out = [];
    ((qz || quiz) ? (qz || quiz).rounds : []).forEach(function (rd) {
      rd.questions.forEach(function (q) {
        [q.picture, q.full].forEach(function (nm) { if (nm && out.indexOf(picKey(nm)) < 0) out.push(picKey(nm)); });
      });
    });
    return out;
  }
  function missingPics(qz) {
    return neededPics(qz).filter(function (k) { return !picData[k] && !WQ.builtinPic(k); });
  }
  // What a phone needs to show a question's picture: a website file, or the id of a picture sent through Firebase.
  function questionPic(q, qid, which) {
    var name = which === "full" ? q && q.full : q && q.picture;
    if (!name) return null;
    var id = which === "full" ? qid + "f" : qid;
    var d = localPic(name);
    if (d) return { id: id, w: d.w, h: d.h };
    var b = WQ.builtinPic(name);
    return b ? { src: b.src, w: b.w, h: b.h } : { id: id, w: 4, h: 3 };
  }

  function processPicture(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || 1200, ht = img.naturalHeight || 900;
        var sc = Math.min(1, 1280 / Math.max(w, ht));
        var cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(ht * sc));
        var c = document.createElement("canvas");
        c.width = cw; c.height = ch;
        var ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        var quality = 0.82, data = c.toDataURL("image/jpeg", quality);
        while (data.length > 420000 && quality > 0.5) { quality -= 0.1; data = c.toDataURL("image/jpeg", quality); }
        URL.revokeObjectURL(url);
        resolve({ data: data, w: cw, h: ch });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Couldn't open " + file.name + " as a picture.")); };
      img.src = url;
    });
  }
  // Match chosen files to the picture names in the quiz (case doesn't matter; the extension can be left off in the quiz file).
  function loadPictureFiles(files, qz) {
    var wanted = neededPics(qz), jobs = [], found = [];
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|svg|bmp)$/i.test(f.name); });
    wanted.forEach(function (k) {
      var stem = k.replace(/\.[^.]+$/, "");
      var f = list.filter(function (x) { return x.name.toLowerCase() === k; })[0] ||
        list.filter(function (x) { return x.name.toLowerCase().replace(/\.[^.]+$/, "") === stem; })[0];
      if (!f) return;
      found.push(k);
      jobs.push(processPicture(f).then(function (d) { picData[k] = d; }));
    });
    return Promise.all(jobs.map(function (j) { return j.catch(function (e) { return e; }); })).then(function (res) {
      return { found: found, problems: res.filter(function (x) { return x instanceof Error; }).map(function (e) { return e.message; }) };
    });
  }

  // Pictures are kept in this browser's storage for the game, so "Carry on" after a refresh still has them.
  var PicStore = {
    open: function () {
      if (this.p) return this.p;
      this.p = new Promise(function (res, rej) {
        if (!window.indexedDB) return rej(new Error("no storage"));
        var r = indexedDB.open("wq-pictures", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("games"); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
      return this.p;
    },
    put: function (code, map) {
      return this.open().then(function (db) {
        return new Promise(function (res, rej) {
          var tx = db.transaction("games", "readwrite"), st = tx.objectStore("games");
          st.clear(); st.put(map, code);
          tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); };
        });
      }).catch(warn);
    },
    get: function (code) {
      return this.open().then(function (db) {
        return new Promise(function (res) {
          var r = db.transaction("games").objectStore("games").get(code);
          r.onsuccess = function () { res(r.result || {}); }; r.onerror = function () { res({}); };
        });
      }).catch(function () { return {}; });
    }
  };

  // Sends a question's picture (and its "show first" full picture, if it has one) to phones.
  function sendPic(r, n) {
    var rd = roundOf(r), q = rd && rd.questions[n - 1];
    if (!q || !q.picture) return Promise.resolve();
    var qid = "r" + r + "q" + n, d = localPic(q.picture), f = q.full ? localPic(q.full) : null;
    if ((!d && !f) || picsSent[qid]) return Promise.resolve();
    picsSent[qid] = true;
    lastSentPic = qid;
    var upd = {};
    if (f) upd["pics/" + qid + "f"] = { data: f.data, w: f.w, h: f.h };
    if (d) upd["pics/" + qid] = { data: d.data, w: d.w, h: d.h };
    return L.update(WQ.ref(""), upd).catch(function (e) { delete picsSent[qid]; warn(e); });
  }
  // The picture ids a phone needs before a question can be shown (only pictures sent through Firebase).
  function picIdsFor(qid) {
    var m = /^r(\d+)q(\d+)$/.exec(qid || ""), rd = m && roundOf(+m[1]), q = rd && rd.questions[+m[2] - 1], ids = [];
    if (q && q.picture && localPic(q.picture)) ids.push(qid);
    if (q && q.full && localPic(q.full)) ids.push(qid + "f");
    return ids;
  }
  function nextQuestionAfter(r, n) {
    var rd = roundOf(r);
    if (rd && n < rd.questions.length) return [r, n + 1];
    if (r < quiz.rounds.length) return [r + 1, 1];
    return null;
  }
  // Remove pictures phones no longer need, keeping the ones listed.
  function prunePics(keep) {
    var upd = {};
    Object.keys(picsSent).forEach(function (qid) {
      if (keep.indexOf(qid) < 0) { upd["pics/" + qid] = null; upd["pics/" + qid + "f"] = null; delete picsSent[qid]; }
    });
    if (Object.keys(upd).length) L.update(WQ.ref(""), upd).catch(warn);
  }

  // ---------- The practice (built-in donkey) ----------
  function practiceQuestion() {
    var p = WQ.PRACTICE;
    return { kind: "pin", text: p.text, picture: p.picture, target: p.target, level: p.level, marker: p.marker, seconds: p.seconds, practice: true };
  }
  function practiceDone() { var s = WQ.store.get("wq-host") || {}; return s.code === WQ.code && !!s.practiceDone; }
  function setPracticeDone() { var s = WQ.store.get("wq-host") || {}; s.practiceDone = true; WQ.store.set("wq-host", s); }
  function firstPinRound() {
    for (var i = 0; i < quiz.rounds.length; i++) if (quiz.rounds[i].type === "pin") return quiz.rounds[i].num;
    return 0;
  }
  function startPractice() {
    var s = game.state, rd = roundOf(s.round), p = practiceQuestion();
    var b = WQ.builtinPic(p.picture);
    return L.set(WQ.ref("state"), {
      phase: "question", round: s.round, roundTopic: rd.topic, mode: "first", type: "pin", totalRounds: quiz.rounds.length,
      practice: true, qNum: 0, qCount: rd.questions.length, qid: "practice",
      question: { kind: "pin", text: p.text, pic: { src: b.src, w: b.w, h: b.h }, marker: p.marker, level: p.level },
      seconds: p.seconds, startAt: L.serverTimestamp(), lockedCount: 0, teamCount: activeTeams().length
    });
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
        h("tr", null, [h("th", { text: "Round" }), h("th", { text: "Topic" }), h("th", { text: "Type" }), h("th", { text: "How teams answer" }), h("th", { text: "Questions" })])
      ].concat(q.rounds.map(function (rd) {
        return h("tr", null, [h("td", { text: rd.num }), h("td", { text: rd.topic }), h("td", { text: WQ.TYPE_LABEL[rd.type || "mc"] }),
          h("td", { text: WQ.MODE_LABEL[rd.mode] }), h("td", { class: "num", text: rd.questions.length })]);
      }))));
      body.appendChild(picturesSection(q));
    }
    if (q && q.rounds.length) {
      var ten = q.rounds.length === 10;
      body.appendChild(h("label", { class: "row", style: { marginTop: "14px", fontWeight: "600" } }, [
        h("input", { type: "checkbox", id: "dps-toggle", checked: ten, disabled: !ten }),
        "Play doubles, poison and steals",
        h("span", { class: "muted small", style: { fontWeight: "400" }, text: ten ? "(captains choose a double round and five poisoned rounds, and every team steals after round 9)" : "(needs exactly 10 rounds)" })
      ]));
    }
    if (res.warnings.length) {
      body.appendChild(h("p", { class: "small", style: { marginTop: "12px", fontWeight: "600" }, text: "Worth knowing:" }));
      body.appendChild(h("ul", { class: "issues small" }, res.warnings.map(function (w) { return h("li", { text: w }); })));
    }
    $("create").disabled = !!res.errors.length || !q || !q.rounds.length || missingPics(q).length > 0;
    if (!res.keepScroll) box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // The pictures part of the quiz check: what's needed, what's missing, and each pin question's answer spot.
  function picturesSection(q) {
    var wrap = h("div", { style: { marginTop: "14px" } });
    var needed = neededPics(q);
    if (!needed.length) return wrap;
    var missing = missingPics(q);
    var own = needed.filter(function (k) { return !WQ.builtinPic(k) || picData[k]; });
    wrap.appendChild(h("h3", { style: { marginTop: "6px" }, text: "Pictures" }));
    if (own.length) {
      wrap.appendChild(h("p", { class: missing.length ? "error" : "status ok", style: { marginTop: "4px" },
        text: missing.length ? (own.length - missing.length) + " of " + own.length + " pictures found. Choose the folder with your pictures to carry on."
          : "All " + own.length + (own.length === 1 ? " picture" : " pictures") + " found and ready." }));
      if (missing.length) wrap.appendChild(h("ul", { class: "issues small" }, missing.map(function (k) { return h("li", { class: "error", text: "Missing: " + k }); })));
      wrap.appendChild(h("div", { class: "row", style: { marginTop: "8px" } }, [
        h("label", { class: "btn" + (missing.length ? " btn-primary" : ""), for: "pics-folder", text: "Choose pictures folder…" }),
        h("label", { class: "btn-link", for: "pics-files", text: "or choose picture files" })
      ]));
      wrap.appendChild(h("p", { class: "muted small", style: { marginTop: "6px" },
        text: "Pictures stay on this computer. Each one is shrunk and sent to phones just before its question." }));
    }
    var pins = [];
    q.rounds.forEach(function (rd) { rd.questions.forEach(function (qq, i) { if (qq.kind === "pin") pins.push({ rd: rd, q: qq, n: i + 1 }); }); });
    if (pins.length) {
      wrap.appendChild(h("p", { class: "small", style: { marginTop: "10px", fontWeight: "600" }, text: "Pin questions: the gold spot is the answer. Check each one looks right." }));
      var grid = h("div", { class: "pic-check" });
      var boards = [];
      pins.forEach(function (x) {
        var d = localPic(x.q.picture), b = WQ.builtinPic(x.q.picture);
        var pic = d ? { data: d.data, w: d.w, h: d.h } : b ? b : null;
        var fig = h("figure");
        if (pic) {
          var board = WQ.pinBoard({ pic: pic, marker: x.q.marker, maxH: function () { return 170; } });
          board.setReveal({ target: x.q.target, dots: [], level: x.q.level, markerAtTarget: true });
          fig.appendChild(board.el);
          boards.push(board);
        } else fig.appendChild(h("div", { class: "pin-loading", style: { position: "static", height: "120px", background: "#eef0f5", borderRadius: "10px" }, text: "Missing picture" }));
        fig.appendChild(h("figcaption", { title: x.q.text, text: "R" + x.rd.num + " Q" + x.n + " · " + (WQ.PIN_LEVELS[x.q.level] || {}).label + " · " + x.q.picture + (x.q.full ? " · shows " + x.q.full + " first" : "") }));
        // The full picture must be the same shape, or pins won't line up
        if (x.q.full && pic) {
          var fd = localPic(x.q.full) || WQ.builtinPic(x.q.full);
          if (fd && Math.abs(fd.w / fd.h - pic.w / pic.h) > 0.02) fig.appendChild(h("div", { class: "error small", text: x.q.full + " is a different shape from " + x.q.picture + ", so the pins won't line up." }));
        }
        grid.appendChild(fig);
      });
      wrap.appendChild(grid);
      setTimeout(function () { boards.forEach(function (b) { b.refresh(); }); }, 0);
    }
    return wrap;
  }
  function onPictureFiles(files) {
    var qz = (pendingCheck && pendingCheck.quiz) || quiz;
    if (!qz) return;
    loadPictureFiles(files, qz).then(function (res) {
      if (WQ.code && quiz) PicStore.put(WQ.code, picData);
      if (pendingCheck && $("s-start") && !$("s-start").hidden) {
        pendingCheck.keepScroll = true;
        if (res.problems.length) pendingCheck.warnings = pendingCheck.warnings.concat(res.problems);
        showCheck(pendingCheck);
      }
      if (WQ.code && quiz) render();
    });
  }
  ["pics-folder", "pics-files", "pics-again"].forEach(function (id) {
    var inp = $(id);
    if (inp) inp.addEventListener("change", function (e) { onPictureFiles(e.target.files); e.target.value = ""; });
  });

  $("create").addEventListener("click", function () {
    if (!pendingCheck || !pendingCheck.quiz) return;
    quiz = pendingCheck.quiz;
    quiz.dps = !!($("dps-toggle") && $("dps-toggle").checked);
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
    quiz.rounds.forEach(function (rd) { rounds["r" + rd.num] = { num: rd.num, topic: rd.topic, mode: rd.mode, type: rd.type || "mc", count: rd.questions.length }; });
    var meta = { hostUid: WQ.uid, created: L.serverTimestamp(), title: quiz.title, teams: teams, rounds: rounds, totalRounds: quiz.rounds.length, theme: "festive", dps: !!quiz.dps };
    L.set(L.ref(WQ.db, "games/" + code + "/meta"), meta)
      .then(function () { return L.set(L.ref(WQ.db, "games/" + code + "/state"), { phase: "lobby" }); })
      .then(function () {
        WQ.store.set("wq-host", { code: code, quiz: quiz });
        if (neededPics().length) PicStore.put(code, picData);
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
      if (v && document.activeElement !== $("g-theme")) $("g-theme").value = v.theme || "festive";
      if (v && v.hostUid !== WQ.uid) fatal(new Error("Game " + code + " was created on a different browser or computer, so it can't be controlled from here. Start a new game instead."));
      render();
    });
    WQ.listen("state", function (v) { game.state = v || { phase: "lobby" }; onState(); render(); });
    WQ.listen("players", function (v) { game.players = v || {}; handleTakeovers(); render(); });
    WQ.listen("presence", function (v) { game.presence = v || {}; checkLocks(); syncReady(); render(); });
    WQ.listen("assign", function (v) { game.assign = v || {}; render(); });
    WQ.listen("results", function (v) { game.results = v || {}; render(); });
    WQ.listen("pscores", function (v) { game.pscores = v || {}; render(); });
    WQ.listen("picks", function (v) { game.picks = v || {}; syncSubmitted(); render(); });
    WQ.listen("steals", function (v) { game.steals = v || {}; syncSubmitted(); render(); });
    WQ.listen("picsLoaded", function (v) { game.picsLoaded = v || {}; render(); });
  }

  $("g-theme").addEventListener("change", function () {
    var p = {}; p["meta/theme"] = $("g-theme").value;
    L.update(WQ.ref(""), p).catch(warn);
    $("g-theme").blur();
  });

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
      if (a && typeof a.at === "number" && (!best || a.at < best.at)) best = { uid: uid, opt: a.opt, x: a.x, y: a.y, at: a.at };
    });
    return best;
  }
  // A team's locked answer: a letter for multiple choice, or a spot (x, y) for a pin question.
  function lockFrom(a, how) {
    var lock = { at: a.at, how: how };
    if (a.uid) lock.by = a.uid;
    if (typeof a.x === "number") { lock.x = a.x; lock.y = a.y; } else lock.opt = a.opt;
    return lock;
  }
  function currentQuestion() {
    var s = game.state;
    if (s && s.practice) return practiceQuestion();
    var rd = s && roundOf(s.round);
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
      if (unsubVotes) unsubVotes();
      unsubAnswers = unsubLocks = unsubVotes = null;
      curQid = s.qid || null;
      game.answers = {}; game.locks = {}; game.votes = {};
      if (curQid) {
        unsubAnswers = WQ.listen("answers/" + curQid, function (v) { game.answers = v || {}; checkLocks(); render(); });
        unsubLocks = WQ.listen("locks/" + curQid, function (v) { game.locks = v || {}; updateLockedCount(); checkLocks(); render(); });
        unsubVotes = WQ.listen("ready/" + curQid, function (v) { game.votes = v || {}; syncReady(); render(); });
      }
    }
    // Players study the full picture for a few seconds, then the Ready? screen comes up (also after a refresh mid-way).
    if (phaseTimer) { clearTimeout(phaseTimer); phaseTimer = null; }
    var showMs = s.question && s.question.showFor ? s.question.showFor * 1000 : 0;
    if (s.phase === "preview" && typeof s.startAt === "number") {
      var pq = s.qid, pr = s.studyRound;
      phaseTimer = setTimeout(function () {
        if (game.state.phase === "preview" && game.state.qid === pq && game.state.studyRound === pr) toReady();
      }, Math.max(0, s.startAt + showMs - WQ.now()));
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
        if (first) upd[key] = lockFrom(first, "first");
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

  function beginAnswering() {
    return L.update(WQ.ref("state"), { phase: "question", startAt: L.serverTimestamp() }).catch(warn);
  }
  // Look-first questions: study the full picture → Ready? Yes/No → (study again if most say No) → the question.
  function toReady() {
    return L.update(WQ.ref("state"), { phase: "ready", readyYes: 0, readyNo: 0, readyOf: readyOf() }).catch(warn);
  }
  function studyAgain() {
    var s = game.state;
    return L.update(WQ.ref("state"), { phase: "preview", startAt: L.serverTimestamp(), studyRound: (s.studyRound || 1) + 1, readyYes: 0, readyNo: 0 });
  }
  function readyOf() { return Object.keys(game.players).filter(function (uid) { return teamOf(uid) && isOnline(uid); }).length; }
  // Yes and No answers for this study round, from players in a team.
  function readyCounts() {
    var s = game.state || {}, yes = 0, no = 0;
    Object.keys(game.votes || {}).forEach(function (uid) {
      var v = game.votes[uid];
      if (!v || v.r !== s.studyRound || !teamOf(uid)) return;
      if (v.v === "yes") yes++; else if (v.v === "no") no++;
    });
    return { yes: yes, no: no, of: readyOf() };
  }
  function mostSayNo(c) { return c.no * 2 > c.of; }
  function syncReady() {
    var s = game.state;
    if (!s || s.phase !== "ready") return;
    var c = readyCounts();
    if (s.readyYes !== c.yes || s.readyNo !== c.no || s.readyOf !== c.of) L.update(WQ.ref("state"), { readyYes: c.yes, readyNo: c.no, readyOf: c.of }).catch(warn);
  }

  function closeQuestion() {
    if (game.state.phase !== "question") return;
    L.update(WQ.ref("state"), { phase: "closed" }).catch(warn);
  }

  // ---------- Moving through the quiz ----------
  function startQuestion(r, n) {
    var rd = roundOf(r), q = rd.questions[n - 1], qid = "r" + r + "q" + n;
    var question = q.kind === "pin"
      ? { kind: "pin", text: q.text, pic: questionPic(q, qid), marker: q.marker || "pin", level: q.level || "medium" }
      : { text: q.text, options: q.options };
    var preview = q.kind === "pin" && q.full;
    if (preview) { question.full = questionPic(q, qid, "full"); question.showFor = q.showFor || WQ.SHOW_FOR; }
    if (q.kind !== "pin" && q.picture) question.pic = questionPic(q, qid);
    var nx = nextQuestionAfter(r, n);
    return sendPic(r, n).then(function () {
      prunePics([qid].concat(nx ? ["r" + nx[0] + "q" + nx[1]] : []));
      // With a "show first" picture, the full picture shows for a few seconds before the clock starts.
      return L.set(WQ.ref("state"), {
        phase: preview ? "preview" : "question", studyRound: preview ? 1 : null, round: r, roundTopic: rd.topic, mode: rd.mode, type: rd.type || "mc", totalRounds: quiz.rounds.length,
        qNum: n, qCount: rd.questions.length, qid: qid,
        question: question, seconds: q.seconds,
        startAt: L.serverTimestamp(), lockedCount: 0, teamCount: activeTeams().length
      });
    });
  }

  function roundIntro(r) {
    var rd = roundOf(r);
    return L.set(WQ.ref("state"), {
      phase: "roundIntro", round: r, roundTopic: rd.topic, mode: rd.mode, type: rd.type || "mc", qCount: rd.questions.length, totalRounds: quiz.rounds.length,
      practice: rd.type === "pin" && r === firstPinRound() && !practiceDone()
    }).then(function () { sendPic(r, 1); });
  }

  function revealAnswer() {
    var s = game.state, q = currentQuestion();
    if (!q || s.phase !== "closed") return;
    if (q.kind === "pin") return revealPin(s, q);
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
    }).then(sendNextPic).catch(function (e) { alertBox("Couldn't reveal the answer: " + ((e && e.message) || e)); });
  }
  // While everyone looks at the answer, quietly send the next question's picture to phones.
  function sendNextPic() {
    var s = game.state;
    if (!s || s.practice) return;
    var nx = nextQuestionAfter(s.round, s.qNum);
    if (nx) sendPic(nx[0], nx[1]);
  }

  // Pin questions: accuracy (from how far the pin is from the right spot) times the usual speed points.
  function revealPin(s, q) {
    var total = s.seconds * 1000, practice = !!s.practice;
    var dims = picDims(q.picture), aspect = dims.w / dims.h;
    function score(a) {
      var dist = WQ.pinDistance(a, q.target, aspect), acc = WQ.pinAccuracy(dist, q.level);
      return { dist: Math.round(dist * 10) / 10, acc: Math.round(acc * 1000) / 1000, points: practice ? 0 : WQ.pinPoints(acc, WQ.elapsed(s, a.at), total) };
    }
    return Promise.all([L.get(WQ.ref("answers/" + s.qid)), L.get(WQ.ref("locks/" + s.qid))]).then(function (snaps) {
      var answers = snaps[0].val() || {}, locks = snaps[1].val() || {};
      var upd = {}, dots = [], bulls = 0;
      activeTeams().forEach(function (tid) {
        var lock = locks[tid], fa = firstAnswer(answers[tid] || {}), res;
        var a = lock && typeof lock.x === "number" ? lock : (fa && typeof fa.x === "number" ? lockFrom(fa, "first") : null);
        if (a) {
          var sc = score(a);
          res = { x: a.x, y: a.y, how: a.how || "first", acc: sc.acc, dist: sc.dist, correct: sc.acc > 0, points: sc.points };
          if (a.by) res.by = a.by;
        } else res = { how: "none", correct: false, points: 0 };
        res.round = s.round; res.q = s.qNum;
        if (!practice) upd["results/" + tid + "/q/" + s.qid] = res;
      });
      Object.keys(answers).forEach(function (tid) {
        Object.keys(answers[tid] || {}).forEach(function (uid) {
          var a = answers[tid][uid];
          if (!a || typeof a.x !== "number") return;
          var sc = score(a);
          if (sc.acc >= 1) bulls++;
          dots.push({ x: a.x, y: a.y });
          if (!practice) upd["pscores/" + uid + "/q/" + s.qid] = { round: s.round, x: a.x, y: a.y, acc: sc.acc, dist: sc.dist, correct: sc.acc > 0, points: sc.points };
        });
      });
      shuffleArr(dots);
      upd["state/phase"] = "reveal";
      upd["state/correctPin"] = { x: q.target.x, y: q.target.y };
      upd["state/dots"] = dots.length ? dots : null;
      upd["state/bulls"] = bulls;
      return L.update(WQ.ref(""), upd);
    }).then(function () {
      if (practice) setPracticeDone();
      sendNextPic();
    }).catch(function (e) { alertBox("Couldn't reveal the answer: " + ((e && e.message) || e)); });
  }

  function showStandings() {
    var s = game.state;
    var table = WQ.halfTable(activeTeams().map(function (tid) { return { name: teamName(tid), points: teamTotal(tid) }; }));
    return L.set(WQ.ref("state"), { phase: "standings", round: s.round, totalRounds: quiz.rounds.length, standings: table });
  }

  // ---------- Doubles, poison and steals ----------
  function dpsOn() { return !!(game.meta && game.meta.dps); }
  function picksOf(tid) { return WQ.readPicks(game.picks[tid]); }
  function stealOf(tid) {
    var v = game.steals[tid];
    return v && v.target && v.round ? { target: v.target, round: parseInt(v.round, 10) } : null;
  }
  function roundPoints(tid) {
    var q = (game.results[tid] || {}).q || {}, out = {};
    Object.keys(q).forEach(function (k) { var x = q[k]; if (x) out[x.round] = (out[x.round] || 0) + (x.points || 0); });
    return out;
  }
  function shuffleArr(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function randomPicks() {
    var r = [];
    for (var i = 1; i <= WQ.DPS_ROUNDS; i++) r.push(i);
    shuffleArr(r);
    return { double: r[0], poison: r.slice(1, 1 + WQ.DPS_POISON).sort(function (a, b) { return a - b; }) };
  }
  function randomSteal(tid) {
    var others = activeTeams().filter(function (t) { return t !== tid; });
    if (!others.length) return null;
    return { target: others[Math.floor(Math.random() * others.length)], round: 1 + Math.floor(Math.random() * WQ.DPS_ROUNDS) };
  }
  function picksText(p) {
    if (!p) return "not chosen";
    return (p.double ? "×2 round " + p.double : "no double") + " · ☠ " + (p.poison.length ? p.poison.join(", ") : "none");
  }

  // Every team's score including doubles and steals. Each steal is settled on its own, using round
  // scores from before any steals. A team can lose a round's points only once, but every team that
  // steals it gets the full amount.
  function breakdown() {
    var teams = activeTeams(), rp = {}, out = {}, steals = [], lost = {};
    teams.forEach(function (t) {
      rp[t] = roundPoints(t);
      var base = Object.keys(rp[t]).reduce(function (sum, r) { return sum + rp[t][r]; }, 0);
      var pk = dpsOn() ? picksOf(t) : null;
      out[t] = { base: base, doubleRound: pk && pk.double ? pk.double : null,
        doubleBonus: pk && pk.double ? (rp[t][pk.double] || 0) : 0, stealGain: 0, stealLoss: 0, robbed: 0 };
    });
    if (dpsOn()) teams.forEach(function (thief) {
      var st = stealOf(thief);
      if (!st || !out[st.target] || st.target === thief) return;
      var T = st.target, r = st.round, pk = picksOf(T) || { double: null, poison: [] };
      var poisoned = pk.poison.indexOf(r) >= 0, isDouble = pk.double === r;
      var pts = (rp[T][r] || 0) * (isDouble ? 2 : 1);
      if (poisoned) out[thief].stealLoss -= pts;
      else {
        out[thief].stealGain += pts;
        if (!lost[T + "|" + r]) { lost[T + "|" + r] = true; out[T].robbed -= pts; }
      }
      steals.push({ thief: thief, target: T, round: r, outcome: poisoned ? "poison" : "stolen", points: pts });
    });
    teams.forEach(function (t) { var o = out[t]; o.total = o.base + o.doubleBonus + o.stealGain + o.stealLoss + o.robbed; });
    return { teams: out, steals: steals };
  }

  function submittedMap(kind) {
    var m = {};
    activeTeams().forEach(function (t) { m[t] = kind === "picks" ? WQ.picksValid(picksOf(t)) : !!stealOf(t); });
    return m;
  }
  function syncSubmitted() {
    var s = game.state;
    if (!s || (s.phase !== "picks" && s.phase !== "steal")) return;
    var m = submittedMap(s.phase === "picks" ? "picks" : "steals");
    if (JSON.stringify(m) !== JSON.stringify(s.submitted || {})) L.update(WQ.ref("state"), { submitted: m }).catch(warn);
  }
  function missingCount(kind) {
    var m = submittedMap(kind);
    return Object.keys(m).filter(function (t) { return !m[t]; }).length;
  }
  function openPicks() {
    return L.set(WQ.ref("state"), { phase: "picks", totalRounds: quiz.rounds.length, submitted: submittedMap("picks") });
  }
  function startAfterPicks() {
    var upd = {};
    activeTeams().forEach(function (t) { if (!WQ.picksValid(picksOf(t))) upd["picks/" + t] = WQ.writePicks(randomPicks()); });
    return (Object.keys(upd).length ? L.update(WQ.ref(""), upd) : Promise.resolve()).then(function () { return roundIntro(1); });
  }
  function openSteals() {
    var s = game.state;
    return L.set(WQ.ref("state"), { phase: "steal", round: s.round, totalRounds: quiz.rounds.length,
      submitted: submittedMap("steals"), standings: s.standings || null });
  }
  function stealOrderList() {
    var saved = WQ.store.get("wq-host") || {};
    return saved.code === WQ.code && saved.stealOrder ? saved.stealOrder : [];
  }
  function startStealReveal() {
    var s = game.state, upd = {}, merged = {};
    activeTeams().forEach(function (t) {
      var st = stealOf(t);
      if (!st) { st = randomSteal(t); if (st) upd["steals/" + t] = st; }
      if (st) merged[t] = st;
    });
    var order = shuffleArr(Object.keys(merged));
    var saved = WQ.store.get("wq-host") || {};
    saved.stealOrder = order;
    WQ.store.set("wq-host", saved);
    upd["state"] = { phase: "stealReveal", round: s.round, totalRounds: quiz.rounds.length, step: 0, count: order.length };
    return L.update(WQ.ref(""), upd);
  }
  function stealRevealNext() {
    var s = game.state, order = stealOrderList(), step = s.step || 0, i = Math.floor(step / 2), tid = order[i];
    var st = tid && stealOf(tid);
    if (!st) return;
    var upd = {}, key = "state/shown/s" + (i + 1);
    upd["state/step"] = step + 1;
    upd["state/last"] = i + 1;
    if (step % 2 === 0) {
      upd[key] = { n: i + 1, thief: teamName(tid), target: teamName(st.target), round: st.round, topic: roundOf(st.round).topic };
    } else {
      var pk = picksOf(st.target) || { poison: [] };
      upd[key + "/outcome"] = pk.poison.indexOf(st.round) >= 0 ? "poison" : "stolen";
    }
    return L.update(WQ.ref(""), upd);
  }

  // ---------- Final reveal ----------
  // The full order is worked out once and kept on this computer. Only what's been revealed goes online.
  var MAX_PLAYERS = 5, MAX_TEAMS = 3;
  function ordinal(n) { return n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]); }
  function buildFinalSequence() {
    var b = breakdown();
    var teams = activeTeams().map(function (tid) { return { name: teamName(tid), points: b.teams[tid].total }; })
      .sort(function (a, b2) { return b2.points - a.points; }).slice(0, MAX_TEAMS);
    var players = Object.keys(game.players).map(function (uid) { return { name: playerName(uid), points: playerTotal(uid) }; })
      .sort(function (a, b2) { return b2.points - a.points; }).slice(0, MAX_PLAYERS);
    var seq = [], i;
    if (dpsOn()) {
      var doubles = {};
      activeTeams().forEach(function (tid) {
        var t = b.teams[tid];
        doubles[tid] = { team: teamName(tid), round: t.doubleRound || 0, topic: t.doubleRound ? roundOf(t.doubleRound).topic : "", bonus: t.doubleBonus };
      });
      seq.push({ kind: "doubles", data: doubles });
      var steals = {};
      b.steals.forEach(function (st, k) {
        steals["s" + (k + 1)] = { n: k + 1, thief: teamName(st.thief), target: teamName(st.target), round: st.round,
          topic: roundOf(st.round).topic, outcome: st.outcome, points: st.points };
      });
      seq.push({ kind: "steals", data: steals });
    }
    for (i = players.length - 1; i >= 0; i--) seq.push({ kind: "players", place: i + 1, name: players[i].name, points: players[i].points });
    for (i = teams.length - 1; i >= 0; i--) seq.push({ kind: "teams", place: i + 1, name: teams[i].name, points: teams[i].points });
    return { seq: seq, players: players.length, teams: teams.length };
  }
  function finalSequence() {
    var saved = WQ.store.get("wq-host") || {};
    if (saved.code === WQ.code && saved.finalSeq) return saved.finalSeq;
    var built = buildFinalSequence();
    saved.finalSeq = built;
    WQ.store.set("wq-host", saved);
    return built;
  }
  function finish() {
    var saved = WQ.store.get("wq-host") || {};
    delete saved.finalSeq;
    WQ.store.set("wq-host", saved);
    var f = finalSequence();
    var b = breakdown(), upd = {};
    // Each team's own final total (only that team can read it), shown on their phones after the reveal.
    activeTeams().forEach(function (tid) {
      var t = b.teams[tid];
      upd["results/" + tid + "/final"] = { base: t.base, doubleBonus: t.doubleBonus, steals: t.stealGain + t.stealLoss + t.robbed, total: t.total };
    });
    upd["state"] = { phase: "final", totalRounds: quiz.rounds.length, step: 0, dps: dpsOn(),
      counts: { players: f.players, teams: f.teams } };
    upd["pics"] = null;
    picsSent = {};
    return L.update(WQ.ref(""), upd);
  }
  function revealNext() {
    var s = game.state, f = finalSequence(), item = f.seq[s.step || 0];
    if (!item) return;
    var upd = {};
    upd["state/step"] = (s.step || 0) + 1;
    if (item.kind === "doubles" || item.kind === "steals") {
      upd["state/last"] = { kind: item.kind };
      upd["state/shown/" + item.kind] = Object.keys(item.data).length ? item.data : { none: true };
    } else {
      upd["state/last"] = { kind: item.kind, place: item.place };
      upd["state/shown/" + item.kind + "/p" + item.place] = { place: item.place, name: item.name, points: item.points };
    }
    return L.update(WQ.ref(""), upd);
  }
  function finalLabel(item) {
    if (item.kind === "doubles") return "Reveal everyone's double round";
    if (item.kind === "steals") return "Reveal the steal points";
    return "Reveal " + ordinal(item.place) + " place " + (item.kind === "players" ? "player" : "team") +
      (item.place === 1 ? (item.kind === "teams" ? " 🏆" : " ⭐") : "");
  }

  function nextStep() {
    var s = game.state || { phase: "lobby" };
    var total = quiz.rounds.length;
    var plural = function (n, one, many) { return n + " " + (n === 1 ? one : many); };
    switch (s.phase) {
      case "lobby": return { label: "Start quiz (show the round topics)", run: function () { return L.set(WQ.ref("state"), { phase: "topics", totalRounds: total }); } };
      case "topics":
        if (dpsOn()) return { label: "Open the double and poison picks", run: openPicks };
        return { label: "Start round 1", run: function () { return roundIntro(1); } };
      case "picks":
        var mp = missingCount("picks");
        return { label: "Start round 1" + (mp ? " (" + plural(mp, "team hasn't", "teams haven't") + " chosen: random picks)" : ""), run: startAfterPicks };
      case "roundIntro":
        if (roundOf(s.round).type === "pin" && s.round === firstPinRound() && !practiceDone()) {
          return { label: "Start the practice: pin the tail on the donkey (not scored)", run: startPractice,
            alt: { label: "Skip the practice", run: function () { setPracticeDone(); return L.update(WQ.ref("state"), { practice: false }); } } };
        }
        return { label: "Start question 1", run: function () { return startQuestion(s.round, 1); } };
      case "preview": return { label: "Players are studying the picture…", disabled: true };
      case "ready":
        var rc = readyCounts(), tally = rc.yes + " ready, " + rc.no + " not ready";
        if (mostSayNo(rc)) return { label: "Show the picture again (" + rc.no + " of " + rc.of + " said not ready)", run: studyAgain,
          alt: { label: "Start the question anyway", run: beginAnswering } };
        return { label: "Start the question (" + tally + ")", run: beginAnswering };
      case "question": return { label: "Waiting for answers…", disabled: true };
      case "closed": return { label: "Reveal the answer", run: revealAnswer };
      case "reveal":
        if (s.practice) return { label: "Start question 1 (this one counts)", run: function () { return startQuestion(s.round, 1); } };
        if (s.qNum < s.qCount) return { label: "Next question (" + (s.qNum + 1) + " of " + s.qCount + ")", run: function () { return startQuestion(s.round, s.qNum + 1); } };
        return { label: "End round " + s.round, run: function () { return L.update(WQ.ref("state"), { phase: "roundEnd" }); } };
      case "roundEnd":
        if (WQ.STANDINGS_AFTER.indexOf(s.round) >= 0 && s.round < total) return { label: "Show the standings", run: showStandings };
        if (s.round < total) return { label: "Start round " + (s.round + 1), run: function () { return roundIntro(s.round + 1); } };
        return { label: "Finish the quiz", run: finish };
      case "standings":
        if (dpsOn() && s.round === WQ.DPS_STEAL_AFTER) return { label: "Open the steals", run: openSteals };
        return { label: "Start round " + (s.round + 1), run: function () { return roundIntro(s.round + 1); } };
      case "steal":
        var ms = missingCount("steals");
        return { label: "Reveal the steals" + (ms ? " (" + plural(ms, "team hasn't", "teams haven't") + " chosen: random steals)" : ""), run: startStealReveal };
      case "stealReveal":
        var step = s.step || 0, n = s.count || 0;
        if (step < n * 2) {
          var idx = Math.floor(step / 2), tid = stealOrderList()[idx];
          if (step % 2 === 0) return { label: "Reveal steal " + (idx + 1) + " of " + n + (tid ? ": " + teamName(tid) : ""), run: stealRevealNext };
          return { label: "Reveal the result", run: stealRevealNext };
        }
        return { label: "Start round " + (s.round + 1), run: function () { return roundIntro(s.round + 1); } };
      case "final":
        var f = finalSequence(), item = f.seq[s.step || 0];
        if (item) return { label: (s.step ? "" : "Start the reveal: ") + finalLabel(item), run: revealNext };
        return { label: "Quiz finished 🎉", disabled: true };
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

  $("c-alt").addEventListener("click", function () {
    var step = nextStep();
    if (!step.alt || busy) return;
    busy = true;
    Promise.resolve(step.alt.run()).catch(function (e) { alertBox((e && e.message) || String(e)); })
      .then(function () { busy = false; render(); });
  });

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
    setTimeout(function () { renderQueued = false; renderTeams(); renderControl(); renderScores(); }, 16);
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

  // The quiz master's own view of a picture: the answer spot, and each team's pin as it comes in.
  var hostBoard = { key: null, board: null };
  var TEAM_COLOURS = ["#d6453d", "#2f6fd6", "#c98a00", "#2c9a55", "#8e44ad", "#138d8a", "#e0711d", "#34495e", "#c2185b", "#5d7c16"];
  function hostBoardFor(q, key) {
    if (hostBoard.key === key && hostBoard.board) return hostBoard.board;
    var d = localPic(q.picture), b = WQ.builtinPic(q.picture);
    var pic = d ? { data: d.data, w: d.w, h: d.h } : b;
    if (!pic) return null;
    var board = WQ.pinBoard({ pic: pic, marker: q.marker || "pin", maxH: function () { return 300; }, maxW: function () { return 460; } });
    if (q.kind === "pin") board.setReveal({ target: q.target, dots: [], level: q.level, markerAtTarget: true });
    hostBoard = { key: key, board: board };
    return board;
  }
  function teamPins(s) {
    var out = [];
    teamIds().forEach(function (tid, i) {
      var src = s.phase === "reveal" && !s.practice ? ((game.results[tid] || {}).q || {})[s.qid] : game.locks[tid];
      if (src && typeof src.x === "number" && activeTeams().indexOf(tid) >= 0) {
        out.push({ x: src.x, y: src.y, label: teamName(tid), color: TEAM_COLOURS[i % TEAM_COLOURS.length] });
      }
    });
    return out;
  }
  // How many phones have the next picture ready.
  function picturesLine(s) {
    if (missingPics().length) {
      return h("div", { class: "status bad" }, [
        "Some pictures need loading again on this computer. ",
        h("label", { class: "btn", for: "pics-again", style: { marginLeft: "6px" }, text: "Choose pictures folder…" })
      ]);
    }
    if (!lastSentPic || ["roundIntro", "preview", "question", "closed", "reveal", "roundEnd"].indexOf(s.phase) < 0) return null;
    var people = Object.keys(game.players).filter(function (uid) { return teamOf(uid) && isOnline(uid); });
    if (!people.length) return null;
    var need = picIdsFor(lastSentPic);
    var ready = people.filter(function (uid) {
      var have = String(game.picsLoaded[uid] || "").split(",");
      return need.every(function (id) { return have.indexOf(id) >= 0; });
    }).length;
    var m = /^r(\d+)q(\d+)$/.exec(lastSentPic);
    return h("p", { class: "small " + (ready === people.length ? "muted" : ""), style: { marginTop: "8px", fontWeight: ready === people.length ? "400" : "700" },
      text: "Picture for round " + (m ? m[1] + " question " + m[2] : "") + ": ready on " + ready + " of " + people.length + " phones" + (ready === people.length ? " ✓" : "…") });
  }

  function renderControl() {
    var s = game.state || { phase: "lobby" };
    var total = quiz.rounds.length;
    var phaseText = {
      lobby: "Lobby: people are joining",
      topics: "Showing the round topics",
      roundIntro: "Round " + s.round + " intro",
      question: s.practice ? "Practice live (not scored)" : "Question live",
      preview: (s.studyRound > 1 ? "Showing the picture again" : "Players are studying the full picture") + " (" + ((s.question && s.question.showFor) || WQ.SHOW_FOR) + " seconds)",
      ready: "Ready? Players are answering Yes or No",
      closed: "Time's up",
      reveal: "Answer revealed",
      roundEnd: "End of round " + s.round,
      standings: "Standings after round " + s.round,
      picks: "Captains are choosing their double and poisoned rounds",
      steal: "Captains are choosing their steals",
      stealReveal: "Revealing the steals",
      final: "Final results"
    }[s.phase] || s.phase;
    $("c-phase").textContent = phaseText;
    var where = "";
    if (s.round) {
      where = "Round " + s.round + " of " + total + " · " + (s.roundTopic || "") + " · " + (WQ.MODE_LABEL[s.mode] || "");
      if (s.practice && ["question", "closed", "reveal"].indexOf(s.phase) >= 0) where += " · Practice";
      else if (s.qNum && ["preview", "ready", "question", "closed", "reveal"].indexOf(s.phase) >= 0) where += " · Question " + s.qNum + " of " + s.qCount;
    }
    $("c-where").textContent = where;

    // Question preview, for reading out
    var qbox = WQ.clear($("c-question"));
    var q = currentQuestion();
    var showQ = q && ["preview", "ready", "question", "closed", "reveal"].indexOf(s.phase) >= 0;
    var upcoming = false;
    if (!showQ && s.phase === "roundIntro") { q = s.practice ? practiceQuestion() : roundOf(s.round).questions[0]; showQ = !!q; upcoming = true; }
    if (showQ) {
      var card = h("div", { class: "card", style: { background: "#f6f7fb", marginTop: "10px" } }, [
        h("div", { class: "muted small", text: (upcoming ? "Up next" : "Question") + (q.practice ? " · practice, not scored" : "") }),
        h("div", { style: { fontWeight: "700", fontSize: "1.1rem", margin: "4px 0 8px" }, text: q.text })
      ]);
      if (q.kind === "pin") {
        card.appendChild(h("div", { class: "small muted", text: (WQ.PIN_LEVELS[q.level] || WQ.PIN_LEVELS.medium).label + " · " + q.seconds + " seconds · " + q.picture + " · the gold spot is the answer" +
          (q.full ? " · " + q.full + " shows first for " + (q.showFor || WQ.SHOW_FOR) + " s" : "") }));
      } else {
        card.appendChild(h("div", { class: "small" }, q.options.map(function (o, i) {
          var isAns = WQ.LETTERS[i] === q.answer;
          return h("div", { style: isAns ? { fontWeight: "800", color: "var(--ok)" } : null, text: WQ.LETTERS[i] + ". " + o + (isAns ? "  ✓ answer" : "") });
        })));
      }
      var hb = q.picture ? hostBoardFor(q, (upcoming ? "next:" : "") + (q.practice ? "practice" : s.qid || ("r" + s.round + "q1"))) : null;
      if (hb) {
        card.appendChild(hb.el);
        if (q.kind === "pin" && !upcoming) hb.setOthers(teamPins(s));
      }
      qbox.appendChild(card);
      if (hb) hb.refresh();
    }
    if (s.phase === "ready") {
      var c2 = readyCounts(), waiting = Math.max(0, c2.of - c2.yes - c2.no);
      qbox.appendChild(h("div", { class: "status" + (mostSayNo(c2) ? " warn" : " ok") }, [
        "Ready? ✓ " + c2.yes + " yes · ✗ " + c2.no + " no · " + waiting + " still to answer. ",
        mostSayNo(c2) ? "More than half said not ready, so you can show the picture again." : "Start the question when you're happy."
      ]));
    }
    var picLine = picturesLine(s);
    if (picLine) qbox.appendChild(picLine);

    var privateBox = function (title, rows) {
      qbox.appendChild(h("div", { class: "card", style: { background: "#f6f7fb", marginTop: "10px" } },
        [h("div", { class: "muted small", text: title })].concat(rows)));
    };
    if (s.phase === "final") {
      var fs = finalSequence(), nextItem = fs.seq[s.step || 0];
      var nextText = !nextItem ? "Everything has been revealed."
        : nextItem.kind === "doubles" ? "Everyone's double round and bonus points"
        : nextItem.kind === "steals" ? "The points won and lost in the steals"
        : ordinal(nextItem.place) + " place " + (nextItem.kind === "players" ? "player" : "team") + ": " + nextItem.name + " (" + WQ.fmt(nextItem.points) + ")";
      privateBox("Revealed " + (s.step || 0) + " of " + fs.seq.length + (nextItem ? " · up next (only you can see this):" : ""),
        [h("div", { style: { fontWeight: "700", fontSize: "1.1rem", marginTop: "4px" }, text: nextText })]);
    }
    if (s.phase === "picks") {
      privateBox("Picks so far (only you can see these)", [h("table", { class: "live-table" }, activeTeams().map(function (tid) {
        var p = picksOf(tid), ok = WQ.picksValid(p);
        return h("tr", null, [h("td", { text: teamName(tid) }), h("td", null, [h("span", { class: "pill " + (ok ? "pill-ok" : "pill-warn"), text: ok ? "Chosen" : "Choosing…" })]),
          h("td", { class: "small", text: p ? picksText(p) : "" })]);
      }))]);
    }
    if (s.phase === "steal") {
      privateBox("Steals so far (only you can see these)", [h("table", { class: "live-table" }, activeTeams().map(function (tid) {
        var st = stealOf(tid);
        return h("tr", null, [h("td", { text: teamName(tid) }), h("td", null, [h("span", { class: "pill " + (st ? "pill-ok" : "pill-warn"), text: st ? "Chosen" : "Choosing…" })]),
          h("td", { class: "small", text: st ? teamName(st.target) + ", round " + st.round + " (" + roundOf(st.round).topic + ")" : "" })]);
      }))]);
    }
    if (s.phase === "stealReveal") {
      var stepN = s.step || 0, idxN = Math.floor(stepN / 2), tidN = stealOrderList()[idxN], stN = tidN && stealOf(tidN);
      if (stN) {
        var pkN = picksOf(stN.target) || { poison: [], double: null };
        var res = pkN.poison.indexOf(stN.round) >= 0 ? "☠ poisoned" : (pkN.double === stN.round ? "stolen (it's their double round)" : "stolen");
        privateBox("Steal " + (idxN + 1) + " of " + (s.count || 0) + " (only you can see the result):",
          [h("div", { style: { fontWeight: "700", fontSize: "1.1rem", marginTop: "4px" },
            text: teamName(tidN) + " → " + teamName(stN.target) + ", round " + stN.round + " (" + roundOf(stN.round).topic + "): " + res })]);
      }
    }

    // Issues to sort out before starting
    var issues = WQ.clear($("c-issues"));
    if (s.phase === "lobby" || s.phase === "topics" || s.phase === "picks") {
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
    $("c-alt").hidden = !step.alt;
    if (step.alt) { $("c-alt").textContent = step.alt.label; $("c-alt").disabled = busy; }

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
        var isPin = s.question && s.question.kind === "pin";
        var teamAns;
        if (isPin) {
          var pr = s.practice ? null : res;
          teamAns = pr ? (pr.how === "none" ? "No pin" : WQ.pct(pr.acc) + " accurate (" + howText(pr) + ")")
            : lock ? "📍 pinned (" + howText(lock) + ")" : (s.phase === "question" ? "…" : "no pin");
        } else {
          teamAns = res ? (res.opt ? res.opt + " (" + howText(res) + ")" : "No answer")
            : lock ? lock.opt + " (" + howText(lock) + ")" : (s.phase === "question" ? "…" : "not locked");
        }
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
    var b = breakdown();
    var teams = activeTeams().map(function (tid) { return { tid: tid, name: teamName(tid), b: b.teams[tid] }; })
      .sort(function (x, y) { return y.b.total - x.b.total; });
    var signed = function (n) { return n ? (n > 0 ? "+" : "−") + WQ.fmt(Math.abs(n)) : "–"; };
    if (dpsOn()) {
      body.appendChild(h("table", { class: "live-table" }, [h("tr", null, [h("th", { text: "Team" }), h("th", { class: "num", text: "Questions" }),
        h("th", { class: "num", text: "Double" }), h("th", { class: "num", text: "Steals" }), h("th", { class: "num", text: "Total" })])]
        .concat(teams.map(function (t) {
          return h("tr", null, [h("td", { text: t.name }), h("td", { class: "num", text: WQ.fmt(t.b.base) }),
            h("td", { class: "num", text: signed(t.b.doubleBonus) + (t.b.doubleRound ? " (R" + t.b.doubleRound + ")" : "") }),
            h("td", { class: "num", text: signed(t.b.stealGain + t.b.stealLoss + t.b.robbed) }),
            h("td", { class: "num", style: { fontWeight: "800" }, text: WQ.fmt(t.b.total) })]);
        }))));
      body.appendChild(h("p", { class: "muted small", style: { marginTop: "6px" }, text: "Steals count once the steals have been chosen. The standings use question points only." }));
    } else {
      body.appendChild(h("table", { class: "live-table" }, [h("tr", null, [h("th", { text: "Team" }), h("th", { class: "num", text: "Points" })])]
        .concat(teams.map(function (t) { return h("tr", null, [h("td", { text: t.name }), h("td", { class: "num", text: WQ.fmt(t.b.total) })]); }))));
    }
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
