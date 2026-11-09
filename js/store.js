/* Lexora local store: cards, daily counters, settings and the frozen daily plan, saved in localStorage.
   Everything the sync layer needs (dirty flags, pending counter increments, owner) lives here too. */
(function (root, factory) {
  var srs = (typeof module === 'object' && module.exports) ? require('./srs.js') : root.Lexora.srs;
  var api = factory(srs);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Lexora = root.Lexora || {}; root.Lexora.store = api; }
})(typeof self !== 'undefined' ? self : this, function (srs) {
  'use strict';

  var KEY = 'lexora:v1';

  function defaults() {
    return {
      v: 1,
      owner: null,                 // uid whose progress this device holds (null: never signed in)
      cards: {},                   // id -> card
      days: {},                    // date -> {newDone, reviewed}
      pending: {},                 // date -> {field: n} counter increments not yet sent
      dirtyCards: {},              // id -> 1 for cards changed since the last push
      dirtyState: false,
      settings: { dailyNew: 20, budget: 30, examDate: '' },
      plan: {},                    // date -> frozen plan for that day
      stateT: 0,
      device: { theme: 'system', lang: 'en', lastRoute: 'home' }
    };
  }

  function Store(opts) {
    opts = opts || {};
    this.storage = opts.storage || null;
    this.key = opts.key || KEY;
    this.now = opts.now || function () { return Date.now(); };
    this.listeners = [];
    this.s = this._load();
  }
  var P = Store.prototype;

  P._load = function () {
    var d = defaults();
    try {
      var raw = this.storage && this.storage.getItem(this.key);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.v === 1) {
          d = Object.assign(d, o);
          d.settings = Object.assign(defaults().settings, o.settings || {});
          d.device = Object.assign(defaults().device, o.device || {});
        }
      }
    } catch (e) { /* start fresh */ }
    return d;
  };
  P.save = function () {
    try { if (this.storage) this.storage.setItem(this.key, JSON.stringify(this.s)); } catch (e) { /* storage full or blocked */ }
  };
  P.on = function (fn) { this.listeners.push(fn); };
  P.emit = function (what) { var self = this; this.listeners.forEach(function (fn) { try { fn(what); } catch (e) { /* ignore */ } }); };
  P.today = function () { return srs.ymd(new Date(this.now())); };

  /* ---------- cards ---------- */
  P.card = function (id) { return this.s.cards[id] || null; };

  P.putCard = function (id, fn) {
    var old = this.s.cards[id];
    var c = Object.assign(srs.newCard(id), old);
    var n = fn(c) || c;
    n.id = id;
    n.t = Math.max(this.now(), (old && old.t ? old.t + 1 : 0));
    this.s.cards[id] = n;
    this.s.dirtyCards[id] = 1;
    this.save(); this.emit('card');
    return n;
  };

  /* Today's test: grade a card and move its due date. count=true adds it to today's counters (once per card per session). */
  P.applyGrade = function (id, g, count) {
    var today = this.today(), was = this.s.cards[id], wasNew = !(was && was.first);
    var n = this.putCard(id, function (c) { return srs.grade(c, g, today); });
    if (count) this.bump(today, wasNew ? 'newDone' : 'reviewed', 1);
    return n;
  };

  /* Practice: updates hit and miss counts (used for weak words) but never the schedule. */
  P.recordPractice = function (id, ok) {
    return this.putCard(id, function (c) { if (ok) c.hits += 1; else c.misses += 1; return c; });
  };
  P.toggleStar = function (id) {
    var cur = this.s.cards[id] && this.s.cards[id].star;
    return this.putCard(id, function (c) { c.star = !cur; return c; });
  };
  P.setRead = function (id, v) {
    return this.putCard(id, function (c) { c.read = !!v; return c; });
  };

  P.dueIds = function (today) {
    var out = [], cards = this.s.cards;
    Object.keys(cards).forEach(function (k) { if (srs.isDue(cards[k], today)) out.push(+k); });
    return out.sort(function (a, b) { return cards[a].due < cards[b].due ? -1 : cards[a].due > cards[b].due ? 1 : a - b; });
  };
  P.seenCount = function () {
    var c = this.s.cards; return Object.keys(c).filter(function (k) { return c[k].first; }).length;
  };

  /* ---------- counters ---------- */
  P.day = function (date) { return this.s.days[date] || { newDone: 0, reviewed: 0 }; };
  P.bump = function (date, field, n) {
    var d = this.s.days[date] || (this.s.days[date] = { newDone: 0, reviewed: 0 });
    d[field] = (d[field] || 0) + n;
    var p = this.s.pending[date] || (this.s.pending[date] = {});
    p[field] = (p[field] || 0) + n;
    this.save(); this.emit('day');
  };
  P.streak = function () {
    var date = this.today(), s = this.s.days;
    function active(d) { return s[d] && (s[d].newDone + s[d].reviewed) > 0; }
    if (!active(date)) date = srs.addDays(date, -1);
    var n = 0;
    while (active(date)) { n++; date = srs.addDays(date, -1); }
    return n;
  };

  /* ---------- settings and the frozen plan ---------- */
  P.setSetting = function (k, v) {
    this.s.settings[k] = v; this.s.stateT = this.now(); this.s.dirtyState = true;
    this.save(); this.emit('settings');
  };
  P.setDevice = function (k, v) { this.s.device[k] = v; this.save(); this.emit('device'); };

  /* The quota for a day is decided on the first visit that day and then frozen. */
  P.ensurePlan = function (today) {
    var p = this.s.plan[today];
    if (p) return p;
    var due = this.dueIds(today).length, st = this.s.settings;
    var q = srs.planQuota({ dailyNew: st.dailyNew, budget: st.budget, dueCount: due });
    p = { quota: q.quota, reduced: q.reduced, reason: q.reason, due0: due, dailyNew: st.dailyNew, budget: st.budget };
    this.s.plan[today] = p;
    var keys = Object.keys(this.s.plan).sort();
    while (keys.length > 45) delete this.s.plan[keys.shift()];
    this.s.stateT = this.now(); this.s.dirtyState = true;
    this.save();
    return p;
  };

  /* What is left to do today. unseenCount: words never graded. */
  P.todaySummary = function (unseenCount) {
    var today = this.today(), p = this.ensurePlan(today), d = this.day(today);
    var remainingNew = Math.max(0, Math.min(p.quota - d.newDone, unseenCount));
    var due = this.dueIds(today).length;
    var total = p.quota + p.due0, done = Math.min(total, d.newDone + d.reviewed);
    return {
      date: today, quota: p.quota, reduced: p.reduced, reason: p.reason, newDone: d.newDone, reviewedToday: d.reviewed,
      remainingNew: remainingNew, due: due, remaining: remainingNew + due,
      minutes: srs.estMinutes(remainingNew, due), progress: total > 0 ? done / total : 1
    };
  };

  /* ---------- sync helpers ---------- */
  P.stateDoc = function () {
    return { t: this.s.stateT, settings: Object.assign({}, this.s.settings), plan: Object.assign({}, this.s.plan) };
  };
  P.mergeRemoteCard = function (id, doc) {
    var l = this.s.cards[id];
    if (!doc) return false;
    if (!l || (doc.t || 0) > (l.t || 0)) {
      this.s.cards[id] = Object.assign(srs.newCard(+id), doc, { id: +id });
      delete this.s.dirtyCards[id];
      return true;
    }
    return false;
  };
  P.mergeRemoteState = function (doc) {
    if (!doc || (doc.t || 0) <= (this.s.stateT || 0)) return false;
    this.s.settings = Object.assign(defaults().settings, doc.settings || {});
    this.s.plan = Object.assign({}, doc.plan || {});
    this.s.stateT = doc.t; this.s.dirtyState = false;
    return true;
  };
  P.setOwner = function (uid) { this.s.owner = uid; this.save(); };
  P.wipeProgress = function () {
    var dev = this.s.device, owner = this.s.owner;
    this.s = defaults(); this.s.device = dev; this.s.owner = owner;
    this.save(); this.emit('wipe');
  };
  P.reset = function () { var dev = this.s.device; this.s = defaults(); this.s.device = dev; this.save(); this.emit('wipe'); };

  return { Store: Store, defaults: defaults, KEY: KEY };
});
