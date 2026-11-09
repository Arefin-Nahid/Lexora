/* Lexora app: screens, study sessions and wiring. Plain JavaScript, no framework. */
(function () {
  'use strict';
  var L = window.Lexora, srs = L.srs, quiz = L.quiz, Session = L.session.Session;
  var DATA = JSON.parse(document.getElementById('lexora-data').textContent);
  var entries = DATA.entries, index = quiz.buildIndex(entries), byId = index.byId;
  var APP_VERSION = '1.0.0';

  /* ---------- storage, store, sync ---------- */
  function safeStorage() {
    try { var s = window.localStorage; s.setItem('lexora:probe', '1'); s.removeItem('lexora:probe'); return s; }
    catch (e) { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; }
  }
  var store = new L.store.Store({ storage: safeStorage() });
  var adapter = window.__lexoraAdapter || new L.FirebaseAdapter(L.firebaseConfig);
  var engine = new L.sync.SyncEngine(store, adapter);

  /* ---------- helpers ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    today: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.6 2.6L16 9.5"/>',
    practice: '<rect x="3" y="7" width="14" height="13" rx="2"/><path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    plan: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    back: '<path d="M15 5l-7 7 7 7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', chev: '<path d="M6 9l6 6 6-6"/>'
  };
  function ic(n) { return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + ICONS[n] + '</svg>'; }
  function fmtDate(s) { return srs.parseYmd(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function fmtDateLong(s) { return srs.parseYmd(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : (b || a + 's')); }
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 3600);
  }

  var cats = Array.from(new Set(entries.map(function (e) { return e.cat; }))).sort();
  var catTotal = {}; entries.forEach(function (e) { catTotal[e.cat] = (catTotal[e.cat] || 0) + 1; });
  var posSet = Array.from(new Set([].concat.apply([], entries.map(function (e) { return e.pos; })))).sort();
  var hasPosFilter = entries.filter(function (e) { return e.pos.length; }).length >= 5;

  function unseenIds() { return entries.filter(function (e) { var c = store.card(e.id); return !(c && c.first); }).map(function (e) { return e.id; }); }
  function statusOf(id) { return srs.status(store.card(id)); }
  function summary() { return store.todaySummary(unseenIds().length); }
  function weakIds() { return entries.filter(function (e) { return srs.isWeak(store.card(e.id)); }).map(function (e) { return e.id; }); }

  /* ---------- entry pieces ---------- */
  function chipsHtml(list, cls) { return '<div class="chips">' + list.map(function (t) { return '<span class="chip ' + (cls || '') + '">' + esc(t) + '</span>'; }).join('') + '</div>'; }
  function unclearHtml(e) {
    return e.note ? '<div><span class="tag">Unclear in source</span></div><div class="warnline">' + esc(e.note) + '</div>' : '';
  }
  function entryBody(e) {
    return '<div class="bnline">' + esc(e.bn) + '</div>'
      + '<div><div class="label">Synonyms</div>' + chipsHtml(e.syn) + '</div>'
      + '<div><div class="label">Antonyms</div>' + chipsHtml(e.ant, 'ant') + '</div>'
      + unclearHtml(e);
  }
  function entryCard(e) {
    var c = store.card(e.id) || {};
    return '<div class="entry"><div class="row between"><div class="meta"><span class="status ' + statusOf(e.id) + '">' + statusOf(e.id) + '</span></div>'
      + '<button class="iconbtn star" data-act="star" data-id="' + e.id + '" aria-pressed="' + !!c.star + '" aria-label="Star ' + esc(e.word) + '">' + ic('star') + '</button></div>'
      + entryBody(e) + '</div>';
  }

  /* ---------- UI state ---------- */
  var ui = {
    route: 'home', prev: 'home',
    pick: { cats: {}, count: 20 },
    prac: { cats: {}, scope: 'any', count: 20 },
    Q: { q: '', cat: '', pos: '', status: '', letter: '', limit: 40 },
    planAll: false, resetArmed: false, installEvt: null, busy: false
  };
  var TITLES = { home: 'Lexora', today: 'Today', practice: 'Practice', search: 'Search', plan: 'Plan', settings: 'Settings' };

  function go(r) {
    if (r === 'settings') { if (ui.route === 'settings') r = ui.prev; else ui.prev = ui.route; }
    ui.route = r; ui.resetArmed = false;
    render(); window.scrollTo(0, 0);
  }

  /* ---------- shell ---------- */
  function syncDot() {
    if (!engine.user) return '';
    var s = engine.status, cls = s === 'synced' ? 'ok' : (s === 'syncing' ? 'busy' : 'err');
    var label = { synced: 'Synced', syncing: 'Syncing', offline: 'Offline, will sync later', error: 'Sync problem' }[s] || s;
    return '<span class="dot ' + cls + '" role="img" aria-label="' + label + '" title="' + label + '"></span>';
  }
  function renderBar() {
    var inSettings = ui.route === 'settings';
    $('#topbar').innerHTML =
      (inSettings ? '<button class="iconbtn" data-act="settings" aria-label="Back">' + ic('back') + '</button>' : '<span class="logo" aria-hidden="true">L</span>')
      + '<h1>' + TITLES[ui.route] + '</h1>' + syncDot()
      + '<button class="iconbtn" data-act="settings" aria-label="Settings" aria-pressed="' + inSettings + '">' + ic('gear') + '</button>';
  }
  function renderTabs() {
    var sm = summary(), tabs = [['home', 'Home'], ['today', 'Today'], ['practice', 'Practice'], ['search', 'Search'], ['plan', 'Plan']];
    $('#tabs').innerHTML = tabs.map(function (t) {
      var cur = ui.route === t[0] ? ' aria-current="page"' : '';
      var badge = t[0] === 'today' && sm.remaining > 0 ? '<span class="badge">' + (sm.remaining > 99 ? '99+' : sm.remaining) + '</span>' : '';
      return '<button data-act="tab" data-r="' + t[0] + '"' + cur + '>' + ic(t[0]) + badge + '<span>' + t[1] + '</span></button>';
    }).join('');
  }
  function render() {
    renderBar();
    var v = { home: vHome, today: vToday, practice: vPractice, search: vSearch, plan: vPlan, settings: vSettings }[ui.route];
    $('#view').innerHTML = v();
    renderTabs();
    if (ui.route === 'search') drawResults();
  }

  /* ---------- Home ---------- */
  function vHome() {
    var sm = summary(), seen = store.seenCount(), weak = weakIds().length;
    var hero;
    if (sm.remaining > 0) {
      hero = '<section class="card hero"><div class="label">Today\'s study</div><div class="big">' + sm.remaining + '<small>' + (sm.remaining === 1 ? 'word left' : 'words left') + '</small></div>'
        + '<div class="meta">' + sm.remainingNew + ' new · ' + plural(sm.due, 'review') + '</div>'
        + '<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(sm.progress * 100) + '"><i style="width:' + Math.round(sm.progress * 100) + '%"></i></div>'
        + '<button class="btn block" data-act="start">Start</button>'
        + (sm.reduced ? '<div class="note">' + esc(sm.reason) + '</div>' : '') + '</section>';
    } else {
      hero = '<section class="card hero"><div class="label">Today\'s study</div><div class="big">Done<small>for today</small></div>'
        + '<div class="meta">' + (sm.newDone + sm.reviewedToday) + ' words studied today. Come back tomorrow for your next reviews.</div>'
        + '<div class="track"><i style="width:100%"></i></div><button class="btn block" data-act="tab" data-r="today">Read more words</button></section>';
    }
    var tiles = '<div class="tiles"><div class="tile"><b>' + seen + '</b><span>Words learned</span></div>'
      + '<div class="tile"><b>' + store.streak() + '</b><span>Day streak</span></div>'
      + '<button class="tile" data-act="weak"><b>' + weak + '</b><span>Difficult words</span></button></div>';
    var bars = '<section class="card"><h2>Progress by letter</h2><p class="sub" style="margin-bottom:12px">' + seen + ' of ' + entries.length + ' words started</p><div class="cats">'
      + cats.map(function (c) {
        var done = entries.filter(function (e) { return e.cat === c && store.card(e.id) && store.card(e.id).first; }).length;
        return '<div class="cat"><b>' + c + '</b><div class="meter" role="img" aria-label="' + c + ': ' + done + ' of ' + catTotal[c] + '"><i style="width:' + (done / catTotal[c] * 100) + '%"></i></div><span>' + done + '/' + catTotal[c] + '</span></div>';
      }).join('') + '</div></section>';
    return hero + tiles + bars;
  }

  /* ---------- Today ---------- */
  function catPicker(sel, key) {
    var all = !Object.keys(sel).length;
    return '<div class="catpick" role="group" aria-label="Categories"><button data-act="cat" data-k="' + key + '" data-c="" aria-pressed="' + all + '">All</button>'
      + cats.map(function (c) { return '<button data-act="cat" data-k="' + key + '" data-c="' + c + '" aria-pressed="' + !!sel[c] + '">' + c + '</button>'; }).join('') + '</div>'
      + '<p class="sub" style="margin-top:8px">' + (all ? 'All letters (swipe the row for more)' : 'Selected: ' + Object.keys(sel).sort().join(', ')) + '</p>';
  }
  function countSeg(cur, key) {
    return '<div class="seg" role="group" aria-label="Number of words">' + [10, 20, 30, 50].map(function (n) { return '<button data-act="count" data-k="' + key + '" data-n="' + n + '" aria-pressed="' + (cur === n) + '">' + n + '</button>'; }).join('') + '</div>';
  }
  function vToday() {
    var sm = summary();
    var plan = '<section class="card stack"><div><div class="label">Daily plan</div>'
      + '<div class="row between"><span>New words</span><b>' + sm.newDone + ' of ' + sm.quota + ' done</b></div>'
      + '<div class="row between"><span>Reviews waiting</span><b>' + sm.due + '</b></div></div>'
      + (sm.reduced ? '<div class="notice">' + esc(sm.reason) + '</div>' : '')
      + '<div class="stack">'
      + '<button class="btn block" data-act="start"' + (sm.remaining ? '' : ' disabled') + '>' + (sm.remaining ? 'Start today\'s study' : 'Nothing left for today') + '</button>'
      + (sm.due > 0 && sm.remainingNew > 0 ? '<button class="btn ghost block" data-act="reviewsOnly">Reviews only</button>' : '') + '</div>'
      + '<p class="sub">Step 1 is a numbered list of new words to read. Step 2 is a test where you answer Forgot, Hard or Got it.</p></section>';
    var more = '<section class="card stack"><div><h2>Pick more words</h2><p class="sub">Read extra words from any letters. This does not use up today\'s plan.</p></div>'
      + '<div><div class="label">Letters</div>' + catPicker(ui.pick.cats, 'pick') + '</div>'
      + '<div><div class="label">How many</div>' + countSeg(ui.pick.count, 'pick') + '</div>'
      + '<button class="btn soft block" data-act="pickRead">Read as a list</button></section>';
    return plan + more;
  }

  /* ---------- Practice ---------- */
  function practicePool(forceScope) {
    var P = ui.prac, sel = Object.keys(P.cats), today = store.today();
    return entries.filter(function (e) {
      if (sel.length && !P.cats[e.cat]) return false;
      var c = store.card(e.id), sc = forceScope || P.scope;
      if (sc === 'due') return srs.isDue(c, today);
      if (sc === 'new') return !(c && c.first);
      if (sc === 'seen') return !!(c && c.first);
      return true;
    }).map(function (e) { return e.id; });
  }
  function vPractice() {
    var P = ui.prac, n = practicePool().length;
    var scopes = [['any', 'Any'], ['due', 'Due'], ['new', 'New'], ['seen', 'Seen']];
    var modes = [['flash', 'Flashcards', 'Word to meaning'], ['rev', 'Reverse cards', 'Meaning to word'], ['mcq', 'Multiple choice', 'Pick from 4'],
      ['type', 'Type the answer', 'Synonym or antonym'], ['weak', 'Weak words', weakIds().length + ' to work on'], ['list', 'Read as a list', 'In book order']];
    return '<section class="card stack"><div><div class="label">Letters</div>' + catPicker(P.cats, 'prac') + '</div>'
      + '<div><div class="label">Which words</div><div class="seg" role="group" aria-label="Scope">' + scopes.map(function (s) { return '<button data-act="scope" data-s="' + s[0] + '" aria-pressed="' + (P.scope === s[0]) + '">' + s[1] + '</button>'; }).join('') + '</div></div>'
      + '<div><div class="label">How many</div>' + countSeg(P.count, 'prac') + '</div>'
      + '<p class="sub"><b style="color:var(--ink)">' + n + '</b> words match these filters.</p></section>'
      + '<section class="card"><div class="label">Choose a mode</div><div class="stack">' + modes.map(function (m) {
        return '<button class="btn ghost block" style="justify-content:space-between" data-act="mode" data-m="' + m[0] + '"><span>' + m[1] + '</span><span class="sub">' + m[2] + '</span></button>';
      }).join('') + '</div><p class="sub" style="margin-top:12px">Practice never changes your review dates. It only updates which words count as difficult.</p></section>';
  }
  function startPractice(mode) {
    var P = ui.prac, ids;
    if (mode === 'weak') {
      var sel = Object.keys(P.cats);
      ids = weakIds().filter(function (id) { return !sel.length || P.cats[byId.get(id).cat]; });
    } else ids = practicePool();
    if (!ids.length) { toast(mode === 'weak' ? 'No difficult words yet. They appear when you answer Forgot or miss a question.' : 'No words match these filters.'); return; }
    if (mode === 'list') { startRead(ids.slice().sort(function (a, b) { return a - b; }).slice(0, P.count), { kind: 'practice', title: 'Read as a list' }); return; }
    ids = quiz.interleave(quiz.shuffle(ids).slice(0, P.count), byId);
    if (mode === 'mcq') startQuiz(ids, { kind: 'mcq', title: 'Multiple choice' });
    else if (mode === 'type') startQuiz(ids, { kind: 'type', title: 'Type the answer' });
    else startFlash(ids, { kind: 'practice', reverse: mode === 'rev', title: mode === 'rev' ? 'Reverse cards' : mode === 'weak' ? 'Weak words' : 'Flashcards' });
  }

  /* ---------- Search ---------- */
  function vSearch() {
    var Q = ui.Q;
    return '<div class="stack"><div class="searchbox">' + ic('search') + '<input id="q" type="search" placeholder="Search a word, a meaning or a Bengali word" value="' + esc(Q.q) + '" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Search"></div>'
      + '<div class="filters"><select id="fcat" aria-label="Letter"><option value="">All letters</option>' + cats.map(function (c) { return '<option' + (Q.cat === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>'
      + (hasPosFilter ? '<select id="fpos" aria-label="Part of speech"><option value="">Any type</option>' + posSet.map(function (p) { return '<option' + (Q.pos === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') + '</select>' : '')
      + '<select id="fstatus" aria-label="Status">' + [['', 'Any status'], ['new', 'New'], ['learning', 'Learning'], ['mastered', 'Mastered'], ['starred', 'Starred'], ['weak', 'Difficult']].map(function (s) { return '<option value="' + s[0] + '"' + (Q.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></div>'
      + '<div class="letters" role="group" aria-label="Letter index" id="letters">' + cats.map(function (c) { return '<button data-act="letter" data-c="' + c + '" aria-pressed="' + (Q.letter === c) + '">' + c + '</button>'; }).join('') + '</div>'
      + '<div id="results" class="stack"></div></div>';
  }
  function passFilters(e) {
    var Q = ui.Q, c = store.card(e.id);
    if (Q.cat && e.cat !== Q.cat) return false;
    if (Q.letter && e.cat !== Q.letter) return false;
    if (Q.pos && e.pos.indexOf(Q.pos) < 0) return false;
    if (Q.status === 'starred') return !!(c && c.star);
    if (Q.status === 'weak') return srs.isWeak(c);
    if (Q.status) return statusOf(e.id) === Q.status;
    return true;
  }
  /* Groups results under a headword. A word that appears as a synonym or antonym of other entries is also shown,
     with those entries, under the matching headword (reverse lookup). */
  function searchGroups() {
    var Q = ui.Q, q = quiz.norm(Q.q), bn = /[ঀ-৿]/.test(Q.q), groups = [], map = {};
    function group(key, title) { if (!map[key]) { map[key] = { key: key, title: title, entries: [], reverse: [], rank: 3 }; groups.push(map[key]); } return map[key]; }
    if (bn) {
      entries.forEach(function (e) { if (e.bn.indexOf(Q.q.trim()) >= 0 && passFilters(e)) { var g = group(quiz.norm(e.word), e.word); g.entries.push(e); g.rank = 1; } });
    } else if (q) {
      entries.forEach(function (e) {
        var n = quiz.norm(e.word);
        var rank = n === q ? 0 : (n.indexOf(q) === 0 ? 1 : (q.length >= 3 && n.indexOf(q) >= 0 ? 2 : -1));
        if (rank >= 0 && passFilters(e)) { var g = group(n, e.word); g.entries.push(e); g.rank = Math.min(g.rank, rank); }
      });
      index.termIn.forEach(function (refs, term) {
        var rank = term === q ? 0 : (term.indexOf(q) === 0 ? 1 : -1);
        if (rank < 0) return;
        refs.forEach(function (r) {
          if (!passFilters(r.entry)) return;
          var g = group(term, refs[0].term); g.rank = Math.min(g.rank, rank);
          if (!g.reverse.some(function (x) { return x.entry.id === r.entry.id && x.kind === r.kind; })) g.reverse.push(r);
        });
      });
    } else {
      entries.forEach(function (e) { if (passFilters(e)) { var g = group(quiz.norm(e.word), e.word); g.entries.push(e); } });
    }
    groups.sort(function (a, b) { return a.rank - b.rank; });
    return groups;
  }
  function drawResults() {
    var el = $('#results'); if (!el) return;
    var groups = searchGroups(), total = groups.length, shown = groups.slice(0, ui.Q.limit);
    if (!total) { el.innerHTML = '<div class="card sub">No words found. Try fewer letters, or clear a filter.</div>'; return; }
    var q = ui.Q.q.trim();
    el.innerHTML = (q ? '<p class="sub">' + total + (total === 1 ? ' word' : ' words') + ' found</p>' : '')
      + shown.map(function (g, i) {
        var first = g.entries[0], open = q && i === 0 && g.rank === 0 ? ' open' : '';
        var body = g.entries.map(entryCard).join('');
        if (g.reverse.length) {
          body += '<div class="entry"><div class="revhead">Also listed under ' + esc(g.title) + '</div>' + g.reverse.map(function (r) {
            return '<details class="res"><summary><span class="sub" style="font-size:13px">' + (r.kind === 'syn' ? 'Synonym of' : 'Antonym of') + '</span><b>' + esc(r.entry.word) + '</b>' + ic('chev') + '</summary><div class="res-body">' + entryCard(r.entry) + '</div></details>';
          }).join('') + '</div>';
        }
        return '<details class="res"' + open + '><summary><b>' + esc(g.title) + '</b>' + ic('chev') + '</summary><div class="res-body">' + body + '</div></details>';
      }).join('')
      + (total > shown.length ? '<div class="more"><button class="btn ghost" data-act="moreResults">Show ' + Math.min(40, total - shown.length) + ' more</button></div>' : '');
  }

  /* ---------- Plan ---------- */
  var PACES = [5, 10, 15, 20, 25, 30, 40];
  function vPlan() {
    var st = store.s.settings, today = store.today(), sm = summary(), unseen = unseenIds().length;
    var proj = srs.project({ today: today, cards: store.s.cards, unseen: unseen, examDate: st.examDate || null, dailyNew: st.dailyNew, todayQuota: sm.remainingNew });
    var need = srs.neededPerDay(unseen, today, st.examDate), msg = '';
    if (!st.examDate) msg = '<div class="notice">Set an exam date to see whether you will reach every word in time.</div>';
    else if (st.examDate < today) msg = '<div class="notice">The exam date has passed. Pick a new date.</div>';
    else if (unseen === 0) msg = '<div class="notice good">Every word has been started. From here the plan is reviews only.</div>';
    else if (proj.finish && proj.finish <= st.examDate) msg = '<div class="notice good">At ' + st.dailyNew + ' a day you will have started every word by ' + fmtDateLong(proj.finish) + ', ' + plural(srs.diffDays(st.examDate, proj.finish), 'day') + ' before your exam.</div>';
    else msg = '<div class="notice">At ' + st.dailyNew + ' a day, ' + proj.unseenAfter + ' words are still not started by your exam. You would need about ' + need + ' a day.' + (need <= 60 ? ' <button class="btn small soft" style="margin-top:8px" data-act="usePace" data-n="' + need + '">Use ' + need + ' a day</button>' : '') + '</div>';
    var rows = (ui.planAll ? proj.days : proj.days.slice(0, 14));
    var table = '<div class="tablewrap"><table><thead><tr><th>Day</th><th>New</th><th>Reviews</th></tr></thead><tbody>' + rows.map(function (d, i) {
      return '<tr' + (d.date === today ? ' class="today"' : '') + '><td>' + (d.date === today ? 'Today' : fmtDate(d.date)) + '</td><td>' + d.intro + '</td><td>' + d.reviews + '</td></tr>';
    }).join('') + '</tbody></table></div>' + (proj.days.length > 14 ? '<div class="more"><button class="btn ghost" data-act="planAll">' + (ui.planAll ? 'Show fewer days' : 'Show all ' + proj.days.length + ' days') + '</button></div>' : '');
    return '<section class="card stack"><div><h2>Your pace</h2><p class="sub">New words per day. A change starts tomorrow; today\'s plan stays at ' + sm.quota + '.</p></div>'
      + '<div class="seg" role="group" aria-label="New words per day">' + PACES.map(function (n) { return '<button data-act="pace" data-n="' + n + '" aria-pressed="' + (st.dailyNew === n) + '">' + n + '</button>'; }).join('') + '</div>'
      + '<div class="field"><label for="exam">Exam or target date</label><input type="date" id="exam" value="' + esc(st.examDate) + '" min="' + today + '"></div>' + msg + '</section>'
      + '<section class="card stack"><div><h2>' + (st.examDate && st.examDate >= today ? 'Schedule until your exam' : 'Next 14 days') + '</h2><p class="sub">Assumes you answer Got it every time. Real reviews will be a little higher.</p></div>' + table + '</section>';
  }

  /* ---------- Settings ---------- */
  function isStandalone() { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
  function vSettings() {
    var u = engine.user, dev = store.s.device, st = store.s.settings;
    var statusText = { synced: 'Synced', syncing: 'Syncing...', offline: 'Offline. Changes will sync later.', error: 'Sync problem. Will retry.' }[engine.status] || '';
    var acct = u
      ? '<div class="row"><div class="avatar">' + (u.photo ? '<img src="' + esc(u.photo) + '" alt="" referrerpolicy="no-referrer">' : esc((u.name || u.email || '?').charAt(0).toUpperCase())) + '</div><div class="grow"><b>' + esc(u.name || 'Signed in') + '</b><div class="sub" style="overflow-wrap:anywhere">' + esc(u.email) + '</div></div></div><div class="sub">' + esc(statusText) + '</div><button class="btn ghost block" data-act="signout">Sign out</button>'
      : '<p class="sub">Sign in to keep your progress safe and use Lexora on more than one device. Without signing in, progress stays on this device.</p><button class="btn block" data-act="signin"' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Signing in...' : 'Sign in with Google') + '</button>';
    var install;
    if (isStandalone()) install = '<p class="sub">Lexora is installed on this device.</p>';
    else if (ui.installEvt) install = '<p class="sub">Install Lexora to open it like an app and study offline.</p><button class="btn block" data-act="install">Install app</button>';
    else if (/iphone|ipad|ipod/i.test(navigator.userAgent)) install = '<p class="sub">On iPhone or iPad, tap the Share button in Safari, then <b>Add to Home Screen</b>.</p>';
    else install = '<p class="sub">Use your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>';
    var unclear = entries.filter(function (e) { return e.note; }).length;
    return '<section class="card stack"><h2>Profile</h2>' + acct + '</section>'
      + '<section class="card stack"><h2>Install</h2>' + install + '</section>'
      + '<section class="card stack"><h2>Appearance and study</h2>'
      + '<div class="field"><label>Theme</label><div class="seg" role="group" aria-label="Theme">' + [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(function (t) { return '<button data-act="theme" data-t="' + t[0] + '" aria-pressed="' + (dev.theme === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div></div>'
      + '<div class="field"><label for="lang">Language</label><select id="lang"><option value="en" selected>English</option></select></div>'
      + '</section>'
      + '<section class="card stack"><h2>Your data</h2><p class="sub">' + store.seenCount() + ' of ' + entries.length + ' words started. ' + unclear + ' entries are marked "Unclear in source" because the book print was hard to read or looked like a misprint.</p>'
      + '<button class="btn ' + (ui.resetArmed ? 'danger' : 'ghost') + ' block" data-act="reset">' + (ui.resetArmed ? 'Tap again to erase all progress' : 'Reset progress') + '</button>'
      + (ui.resetArmed ? '<p class="sub">This clears your schedule, counters and stars' + (u ? ' on this device and in your account' : ' on this device') + '. It cannot be undone.</p>' : '') + '</section>'
      + '<p class="sub" style="text-align:center">Lexora ' + APP_VERSION + ' · ' + esc(DATA.meta.title) + '</p>';
  }

  /* ---------- sessions (full screen sheet) ---------- */
  var SES = null;
  function sheet(html) { var el = $('#sheet'); el.innerHTML = html; el.hidden = false; document.body.style.overflow = 'hidden'; }
  function closeSheet() { SES = null; var el = $('#sheet'); el.hidden = true; el.innerHTML = ''; document.body.style.overflow = ''; render(); }
  function frame(title, count, pct, body, foot) {
    return '<div class="sheet-head"><button class="iconbtn" data-act="close" aria-label="Close">' + ic('close') + '</button><div class="t">' + esc(title) + '</div><div class="n" id="sn">' + esc(count) + '</div></div>'
      + '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(pct) + '"><i style="width:' + pct + '%"></i></div>'
      + '<div class="sheet-body" id="sbody"><div class="sheet-in">' + body + '</div></div><div class="sheet-foot"><div id="sfoot">' + foot + '</div></div>';
  }

  /* read list */
  function rowBody(e) {
    return '<div class="body"><div class="bnline">' + esc(e.bn) + '</div>' + chipsHtml(e.syn) + chipsHtml(e.ant, 'ant') + unclearHtml(e) + '</div>';
  }
  function readCount() { return SES.ids.filter(function (id) { return (store.card(id) || {}).read; }).length; }
  function readFoot() {
    var k = SES.ctx.kind;
    if (k === 'daily') return '<button class="btn block" data-act="readNext">Start test</button>';
    if (k === 'pick') return '<div class="two" style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><button class="btn ghost" data-act="close">Done</button><button class="btn" data-act="readNext">Test these</button></div>';
    return '<button class="btn block" data-act="close">Done</button>';
  }
  function startRead(ids, ctx) { SES = { type: 'read', ids: ids, ctx: ctx, cover: !!store.s.device.cover, shown: {} }; drawRead(); }
  function drawRead() {
    var items = SES.ids.map(function (id, i) {
      var e = byId.get(id), c = store.card(id) || {}, hidden = SES.cover && !SES.shown[id];
      return '<li class="rd' + (c.read ? ' is-read' : '') + '" data-id="' + id + '"><span class="no">' + (i + 1) + '</span><div><div class="w">' + esc(e.word) + '</div>'
        + (hidden ? '<button class="cover" data-act="reveal" data-id="' + id + '">Tap to show the meaning</button>' : rowBody(e)) + '</div>'
        + '<div class="acts"><button class="iconbtn star" data-act="star" data-id="' + id + '" aria-pressed="' + !!c.star + '" aria-label="Star ' + esc(e.word) + '">' + ic('star') + '</button>'
        + '<button class="iconbtn tick" data-act="tick" data-id="' + id + '" aria-pressed="' + !!c.read + '" aria-label="Mark ' + esc(e.word) + ' as read">' + ic('check') + '</button></div></li>';
    }).join('');
    var body = '<div class="toolbar"><button class="switch" role="switch" data-act="cover" aria-checked="' + SES.cover + '"><span class="tr"></span><span>Cover answers</span></button><button class="btn small ghost" data-act="markAll">Mark all read</button></div><ol class="words">' + items + '</ol>';
    var keep = $('#sbody') ? $('#sbody').scrollTop : 0;
    sheet(frame(SES.ctx.title, readCount() + '/' + SES.ids.length + ' read', SES.ids.length ? readCount() / SES.ids.length * 100 : 0, body, readFoot()));
    $('#sbody').scrollTop = keep;
  }
  function updateReadHeader() {
    var n = readCount(); $('#sn').textContent = n + '/' + SES.ids.length + ' read';
    var bar = document.querySelector('#sheet .progress i'); if (bar) bar.style.width = (SES.ids.length ? n / SES.ids.length * 100 : 0) + '%';
  }

  /* flashcards */
  function startFlash(ids, o) { SES = { type: 'flash', o: o, ses: new Session(store, ids, { kind: o.kind }), shown: false }; drawFlash(); }
  function drawFlash() {
    var s = SES.ses; if (s.done()) return drawResult();
    var id = s.current(), e = byId.get(id), rev = SES.o.reverse, today = store.today(), body, foot;
    var front = rev ? '<div class="bigbn">' + esc(e.bn) + '</div><div class="hintline">Which word means this?</div>' : '<div class="big">' + esc(e.word) + '</div><div class="hintline">Say the meaning, a synonym and an antonym.</div>';
    if (!SES.shown) {
      body = '<div class="flash">' + front + '</div>';
      foot = '<button class="btn block" data-act="flip">Show answer</button>';
    } else {
      body = '<div class="flash"><div class="big">' + esc(e.word) + '</div><div class="back"><div class="bnline bn" style="font-size:21px">' + esc(e.bn) + '</div>'
        + '<div><div class="label">Synonyms</div>' + chipsHtml(e.syn) + '</div><div><div class="label">Antonyms</div>' + chipsHtml(e.ant, 'ant') + '</div>' + unclearHtml(e) + '</div></div>';
      var pv = SES.o.kind === 'srs' ? srs.preview(store.card(id), today) : null;
      foot = '<div class="grades">'
        + '<button class="grade forgot" data-act="grade" data-g="forgot">Forgot<small>' + (pv ? pv.forgot : 'Again soon') + '</small></button>'
        + '<button class="grade hard" data-act="grade" data-g="hard">Hard<small>' + (pv ? pv.hard : '&nbsp;') + '</small></button>'
        + '<button class="grade got" data-act="grade" data-g="got">Got it<small>' + (pv ? pv.got : '&nbsp;') + '</small></button></div>';
    }
    sheet(frame(SES.o.title, (s.pos + 1) + '/' + s.queue.length, s.progress() * 100, body, foot));
  }

  /* multiple choice and typing */
  function startQuiz(ids, o) { SES = { type: o.kind, o: o, ses: new Session(store, ids, { kind: 'practice' }), cur: null, q: null }; drawQuiz(); }
  function pickQuestion() {
    var s = SES.ses;
    while (!s.done()) {
      var e = byId.get(s.current()), kinds = quiz.shuffle(['syn', 'ant']), q = null;
      for (var i = 0; i < kinds.length && !q; i++) {
        if (SES.type === 'mcq') q = quiz.makeMcq(index, e, kinds[i]);
        else if (quiz.safeTerms(index, e, kinds[i]).length) q = { kind: kinds[i], word: e.word, entryId: e.id };
      }
      if (q) return q;
      s.skip();
    }
    return null;
  }
  function drawQuiz() {
    var s = SES.ses, cur = SES.cur;
    if (!cur) { if (s.done()) return drawResult(); SES.q = pickQuestion(); if (!SES.q) return drawResult(); }
    var q = cur ? cur.q : SES.q, e = byId.get(q.entryId), kindLabel = q.kind === 'syn' ? 'Synonym of' : 'Antonym of';
    var body = '<div class="q"><div class="label" style="margin:0">' + kindLabel + '</div><div class="big">' + esc(e.word) + '</div></div>', foot = '';
    if (SES.type === 'mcq') {
      body += '<div class="opts">' + q.options.map(function (o, i) {
        var cls = '', mark = 'ABCD'.charAt(i);
        if (cur) { if (i === q.answer) { cls = ' right'; mark = '✓'; } else if (i === cur.pick) { cls = ' wrong'; mark = '✗'; } }
        return '<button class="opt' + cls + '" data-act="opt" data-i="' + i + '"' + (cur ? ' disabled' : '') + '><span class="k">' + mark + '</span><span>' + esc(o) + '</span></button>';
      }).join('') + '</div>';
    } else if (!cur) {
      body += '<div class="field"><label for="typed" class="sr">Your answer</label><input type="text" id="typed" placeholder="Type a ' + (q.kind === 'syn' ? 'synonym' : 'antonym') + '" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></div>';
      foot = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><button class="btn ghost" data-act="dunno">I don\'t know</button><button class="btn" data-act="check">Check</button></div>';
    } else {
      body += '<div class="field"><input type="text" value="' + esc(cur.text) + '" disabled aria-label="Your answer"></div>';
    }
    if (cur) {
      var verdict = cur.ok ? (cur.res && cur.res.exact === false ? 'Correct. Spelling: ' + cur.res.matched : 'Correct') : 'Not quite';
      var accepted = SES.type === 'type' || !cur.ok ? '<div><div class="label">Good answers</div>' + chipsHtml(quiz.validTerms(index, e, q.kind).slice(0, 6), q.kind === 'ant' ? 'ant' : '') + '</div>' : '';
      body += '<div class="card stack"><div class="verdict ' + (cur.ok ? 'ok' : 'bad') + '">' + esc(verdict) + '</div><div class="bnline bn" style="font-size:19px">' + esc(e.bn) + '</div>' + accepted + unclearHtml(e) + '</div>';
      foot = '<button class="btn block" data-act="qnext">Next</button>';
    } else if (SES.type === 'mcq') foot = '<p class="sub" style="text-align:center;padding:6px 0">Tap the answer you think is right.</p>';
    sheet(frame(SES.o.title, Math.min(s.pos + 1, s.queue.length) + '/' + s.queue.length, s.progress() * 100, body, foot));
    var inp = $('#typed'); if (inp) inp.focus();
  }
  function answerQuiz(ok, pick, text, res) {
    if (SES.cur) return;
    var q = SES.q; SES.cur = { q: q, ok: ok, pick: pick, text: text || '', res: res };
    SES.ses.answer(ok); drawQuiz();
  }

  /* result */
  function drawResult() {
    var s = SES.ses, st = s.stats, total = st.forgot + st.hard + st.got, missed = s.missedIds(), srsKind = SES.type === 'flash' && SES.o.kind === 'srs';
    var head, big;
    if (SES.type === 'flash') { big = st.got + ' of ' + total; head = srsKind ? 'Test finished' : 'Practice finished'; }
    else { big = st.got + ' of ' + total; head = total && st.got / total >= 0.9 ? 'Excellent' : (total && st.got / total >= 0.7 ? 'Good work' : 'Keep going'); }
    var lines = SES.type === 'flash' ? '<p class="sub">Got it ' + st.got + ' · Hard ' + st.hard + ' · Forgot ' + st.forgot + '</p>' : '<p class="sub">' + Math.round(total ? st.got / total * 100 : 0) + '% right on the first try.</p>';
    var next = srsKind && total ? '<p class="sub">Your next reviews are scheduled. Hard words return in 3 days, the rest in 7 days or more.</p>' : '';
    var list = missed.length ? '<div><div class="label">Words to look at again</div><ul class="misslist">' + missed.map(function (id) {
      var e = byId.get(id); return '<li><b>' + esc(e.word) + '</b> <span class="bn muted">' + esc(e.bn.split('/')[0]) + '</span><div class="sub">' + esc(e.syn.slice(0, 3).join(', ')) + '</div></li>';
    }).join('') + '</ul></div>' : '';
    var body = '<div class="card stack" style="text-align:center"><div class="label" style="margin:0">' + head + '</div><div class="score">' + big + '</div>' + lines + next + '</div>' + list;
    var foot = missed.length ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><button class="btn ghost" data-act="again">Practise missed</button><button class="btn" data-act="close">Done</button></div>' : '<button class="btn block" data-act="close">Done</button>';
    sheet(frame(SES.o ? SES.o.title : 'Done', '', 100, body, foot));
  }

  /* ---------- starting study ---------- */
  function startToday(reviewsOnly) {
    var sm = summary(), today = store.today(), due = store.dueIds(today);
    var newIds = reviewsOnly ? [] : unseenIds().slice(0, sm.remainingNew);
    var testIds = quiz.interleave(newIds.concat(due), byId);
    if (!testIds.length) { toast('Nothing left for today. Use Pick more words to read ahead.'); go('today'); return; }
    if (newIds.length) startRead(newIds, { kind: 'daily', title: 'New words', testIds: testIds });
    else startFlash(testIds, { kind: 'srs', title: 'Review' });
  }

  /* ---------- sign-in ---------- */
  function authMessage(err) {
    var c = (err && (err.code || err.message)) || '';
    if (/popup-closed|cancelled/i.test(c)) return '';
    if (/unauthorized-domain/.test(c)) return 'This website address is not allowed for sign-in yet. See FIREBASE_SETUP.md, step 2.';
    if (/popup-blocked/.test(c)) return 'The sign-in window was blocked. Allow pop-ups for this site and try again.';
    if (/network|offline|Failed to fetch|import/i.test(c) || !navigator.onLine) return 'You are offline. Connect to the internet to sign in.';
    return 'Could not sign in. Try again in a moment.';
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('[data-act]'); if (!a) return;
    var d = a.dataset, act = d.act, id = +d.id;
    switch (act) {
      case 'tab': go(d.r); break;
      case 'settings': go('settings'); break;
      case 'start': startToday(false); break;
      case 'reviewsOnly': startToday(true); break;
      case 'weak': ui.prac.scope = 'any'; go('practice'); break;
      case 'cat': {
        var sel = ui[d.k].cats;
        if (!d.c) { ui[d.k].cats = {}; } else if (sel[d.c]) delete sel[d.c]; else sel[d.c] = true;
        render(); break;
      }
      case 'count': ui[d.k].count = +d.n; render(); break;
      case 'scope': ui.prac.scope = d.s; render(); break;
      case 'mode': startPractice(d.m); break;
      case 'pickRead': {
        var cs = Object.keys(ui.pick.cats);
        var pool = unseenIds().filter(function (i) { return !cs.length || ui.pick.cats[byId.get(i).cat]; });
        if (!pool.length) { toast('No new words left in these letters.'); break; }
        pool.sort(function (x, y) { var rx = (store.card(x) || {}).read ? 1 : 0, ry = (store.card(y) || {}).read ? 1 : 0; return rx - ry || x - y; });
        var ids = pool.slice(0, ui.pick.count).sort(function (x, y) { return x - y; });
        startRead(ids, { kind: 'pick', title: 'Pick more words' }); break;
      }
      case 'letter': ui.Q.letter = ui.Q.letter === d.c ? '' : d.c; ui.Q.limit = 40;
        document.querySelectorAll('#letters button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.c === ui.Q.letter)); }); drawResults(); break;
      case 'moreResults': ui.Q.limit += 40; drawResults(); break;
      case 'star': {
        var c = store.toggleStar(id);
        document.querySelectorAll('[data-act="star"][data-id="' + id + '"]').forEach(function (b) { b.setAttribute('aria-pressed', String(!!c.star)); });
        break;
      }
      case 'tick': {
        var on = a.getAttribute('aria-pressed') !== 'true'; store.setRead(id, on);
        a.setAttribute('aria-pressed', String(on));
        var li = a.closest('li'); if (li) li.classList.toggle('is-read', on);
        if (SES && SES.type === 'read') updateReadHeader(); break;
      }
      case 'markAll': SES.ids.forEach(function (i) { if (!(store.card(i) || {}).read) store.setRead(i, true); }); drawRead(); break;
      case 'cover': SES.cover = !SES.cover; SES.shown = {}; store.setDevice('cover', SES.cover); drawRead(); break;
      case 'reveal': {
        SES.shown[id] = true; var li2 = a.closest('li'), cell = a.parentNode;
        cell.removeChild(a); cell.insertAdjacentHTML('beforeend', rowBody(byId.get(id))); break;
      }
      case 'readNext':
        if (SES.ctx.kind === 'daily') startFlash(SES.ctx.testIds, { kind: 'srs', title: 'Test' });
        else startFlash(SES.ids.slice(), { kind: 'practice', title: 'Test these words' });
        break;
      case 'flip': SES.shown = true; drawFlash(); break;
      case 'grade': SES.ses.grade(d.g); SES.shown = false; drawFlash(); break;
      case 'opt': { var q = SES.q, i = +d.i; answerQuiz(i === q.answer, i, '', null); break; }
      case 'check': {
        var inp = $('#typed'), txt = inp ? inp.value : '';
        if (!txt.trim()) { toast('Type an answer first, or tap "I don\'t know".'); break; }
        var res = quiz.checkTyped(index, byId.get(SES.q.entryId), SES.q.kind, txt); answerQuiz(!!res.ok, -1, txt, res); break;
      }
      case 'dunno': answerQuiz(false, -1, '', null); break;
      case 'qnext': SES.cur = null; drawQuiz(); break;
      case 'again': {
        var miss = SES.ses.missedIds(); if (miss.length) startFlash(miss, { kind: 'practice', title: 'Missed words' }); break;
      }
      case 'close': closeSheet(); break;
      case 'pace': store.setSetting('dailyNew', +d.n); render(); break;
      case 'usePace': store.setSetting('dailyNew', Math.max(5, Math.min(60, +d.n))); render(); toast('New words per day set to ' + d.n + ', from tomorrow.'); break;
      case 'planAll': ui.planAll = !ui.planAll; render(); break;
      case 'theme': store.setDevice('theme', d.t); applyTheme(); render(); break;
      case 'install': if (ui.installEvt) { ui.installEvt.prompt(); ui.installEvt.userChoice.then(function () { ui.installEvt = null; render(); }); } break;
      case 'signin': {
        ui.busy = true; render();
        Promise.resolve(adapter.signIn()).then(function () { ui.busy = false; render(); }, function (err) { ui.busy = false; render(); var m = authMessage(err); if (m) toast(m); });
        break;
      }
      case 'signout': Promise.resolve(adapter.signOut()).then(function () { engine.detach(); toast('Signed out. Your progress stays on this device.'); render(); }); break;
      case 'reset':
        if (!ui.resetArmed) { ui.resetArmed = true; render(); }
        else {
          var uid = engine.user && engine.user.uid; ui.resetArmed = false;
          var done = uid ? engine.resetCloud().catch(function () { toast('Could not clear the cloud copy. Try again when online.'); }) : Promise.resolve();
          store.reset(); if (uid) store.setOwner(uid);
          done.then(function () { toast('Progress erased.'); render(); });
        }
        break;
    }
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'q') { ui.Q.q = ev.target.value; ui.Q.limit = 40; drawResults(); }
  });
  document.addEventListener('change', function (ev) {
    var id = ev.target.id;
    if (id === 'fcat') { ui.Q.cat = ev.target.value; drawResults(); }
    else if (id === 'fpos') { ui.Q.pos = ev.target.value; drawResults(); }
    else if (id === 'fstatus') { ui.Q.status = ev.target.value; drawResults(); }
    else if (id === 'exam') { store.setSetting('examDate', ev.target.value); render(); }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !$('#sheet').hidden) { closeSheet(); return; }
    if (ev.key === 'Enter' && ev.target.id === 'typed') { ev.preventDefault(); var b = $('[data-act="check"]'); if (b) b.click(); }
  });

  /* ---------- theme, PWA, sync wiring ---------- */
  function applyTheme() {
    var t = store.s.device.theme, r = document.documentElement;
    if (t === 'light' || t === 'dark') r.setAttribute('data-theme', t); else r.removeAttribute('data-theme');
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); ui.installEvt = e; if (ui.route === 'settings') render(); });
  window.addEventListener('appinstalled', function () { ui.installEvt = null; if (ui.route === 'settings') render(); });
  window.addEventListener('online', function () { if (adapter.retry) adapter.retry(); engine.goOnline(); });
  engine.onStatus(function () { renderBar(); if (ui.route === 'settings' && $('#sheet').hidden) render(); });
  store.on(function (what) { if (what === 'remote' && $('#sheet').hidden) render(); });

  applyTheme();
  render();
  engine.init();
  engine.onStatus(function (s) {
    if (s === 'synced' && engine.lastResult && engine.lastResult.replaced && !engine._toldReplaced) {
      engine._toldReplaced = true; toast('Loaded the progress saved in this account.');
    }
  });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* offline install is optional */ }); });
  }
  L.app = { store: store, engine: engine, go: go, render: render, ui: ui, index: index };
})();
