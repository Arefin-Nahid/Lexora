/* Lexora scheduler and daily plan. No DOM, no storage: plain functions so they can be tested in Node. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Lexora = root.Lexora || {}; root.Lexora.srs = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- dates (local time, 'YYYY-MM-DD') ---------- */
  var pad = function (n) { return String(n).padStart(2, '0'); };
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function diffDays(a, b) { return Math.round((Date.UTC.apply(null, ymdParts(a)) - Date.UTC.apply(null, ymdParts(b))) / 864e5); }
  function ymdParts(s) { var p = s.split('-').map(Number); return [p[0], p[1] - 1, p[2]]; }

  /* ---------- intervals ---------- */
  var LADDER = [7, 14, 30];   // "Got it": 7 days, then 14, then 30
  var HARD_DAYS = 3;          // "Hard": review in 3 days
  var EF_MIN = 1.3, EF_MAX = 3.0, MAX_DAYS = 365;

  function newCard(id) {
    return { id: id, box: 0, ef: 2.5, iv: 0, due: null, lapses: 0, hits: 0, misses: 0, star: false, read: false, first: null, t: 0 };
  }

  function gotInterval(c) {
    if (c.box < LADDER.length) return LADDER[c.box];
    return Math.min(MAX_DAYS, Math.round(Math.max(c.iv, LADDER[LADDER.length - 1]) * c.ef));
  }

  /* Returns an updated copy of the card after a grade: 'forgot' | 'hard' | 'got'.
     SM-2 style ease factor and a Leitner box (consecutive "Got it" count) are kept inside the card. */
  function grade(card, g, today) {
    var c = Object.assign({}, card);
    if (!c.first) c.first = today;
    if (g === 'forgot') {
      c.box = 0; c.iv = 0; c.due = today;
      c.ef = Math.max(EF_MIN, c.ef - 0.2); c.lapses += 1; c.misses += 1;
    } else if (g === 'hard') {
      c.iv = HARD_DAYS; c.due = addDays(today, HARD_DAYS);
      c.ef = Math.max(EF_MIN, c.ef - 0.15);
    } else if (g === 'got') {
      var iv = gotInterval(c);
      c.iv = iv; c.due = addDays(today, iv); c.box += 1;
      c.ef = Math.min(EF_MAX, c.ef + 0.1); c.hits += 1;
    } else throw new Error('unknown grade ' + g);
    return c;
  }

  function fmtInterval(days) {
    if (days <= 0) return 'Again now';
    if (days === 1) return '1 day';
    if (days < 100) return days + ' days';
    var m = Math.round(days / 30);
    return m + ' months';
  }

  /* What each button will do, shown under the button. */
  function preview(card, today) {
    var c = card || newCard(0), out = {};
    ['forgot', 'hard', 'got'].forEach(function (g) {
      var n = grade(c, g, today);
      out[g] = g === 'forgot' ? 'Again now' : fmtInterval(diffDays(n.due, today));
    });
    return out;
  }

  function status(card) {
    if (!card || !card.first) return 'new';
    return card.box >= 3 ? 'mastered' : 'learning';
  }
  function isWeak(card) {
    return !!(card && card.first && (card.misses > card.hits || (card.lapses >= 2 && card.box < 3)));
  }
  function isDue(card, today) { return !!(card && card.first && card.due && card.due <= today); }

  /* ---------- daily plan ---------- */
  var MIN_NEW = 1.5;      // minutes to read and test one new word
  var MIN_REVIEW = 0.5;   // minutes per review
  var PILE_LIMIT = 60;    // at this many due reviews, new words stop for the day

  function planQuota(o) {
    var dailyNew = o.dailyNew, budget = o.budget, due = o.dueCount;
    if (due >= PILE_LIMIT) return { quota: 0, reduced: true, reason: 'Many reviews are waiting, so new words are paused today.' };
    var room = budget == null ? dailyNew : Math.floor((budget - due * MIN_REVIEW) / MIN_NEW);
    var quota = Math.max(0, Math.min(dailyNew, room));
    if (quota < dailyNew) return { quota: quota, reduced: true, reason: 'Reduced from ' + dailyNew + ' because reviews take part of your time.' };
    return { quota: quota, reduced: false, reason: '' };
  }

  function estMinutes(newCount, reviewCount) { return Math.max(0, Math.round(newCount * MIN_NEW + reviewCount * MIN_REVIEW)); }

  function nextChainInterval(box, iv) {
    if (box < LADDER.length) return LADDER[box];
    return Math.min(MAX_DAYS, Math.round(Math.max(iv, 30) * 2.5));
  }

  /* Projects the load per day assuming every answer is "Got it".
     cards: {id: card}; unseen: number of words not started; returns the list of days and a finish date. */
  function project(o) {
    var today = o.today, cards = o.cards || {}, unseen = o.unseen;
    var horizon;
    if (o.examDate && o.examDate >= today) horizon = Math.min(400, diffDays(o.examDate, today) + 1);
    else horizon = 14;
    var dues = {};
    function addDue(date, n) { dues[date] = (dues[date] || 0) + (n || 1); }
    var end = addDays(today, horizon);
    Object.keys(cards).forEach(function (id) {
      var c = cards[id];
      if (!c.first || !c.due) return;
      var date = c.due < today ? today : c.due, box = c.box, iv = c.iv, guard = 0;
      while (date < end && guard++ < 40) {
        addDue(date);
        iv = nextChainInterval(box, iv); box += 1;
        date = addDays(date, iv);
      }
    });
    var days = [], left = unseen, finish = null;
    for (var d = 0; d < horizon; d++) {
      var date = addDays(today, d);
      var rev = dues[date] || 0;
      var q = d === 0 && o.todayQuota != null ? { quota: Math.min(o.todayQuota, left) }
        : planQuota({ dailyNew: o.dailyNew, budget: o.budget, dueCount: rev });
      var intro = Math.min(q.quota, left);
      left -= intro;
      if (intro > 0 && finish === null && left === 0) finish = date;
      if (intro > 0) {
        var date2 = addDays(date, LADDER[0]), box2 = 1, iv2 = LADDER[0], g = 0;
        while (date2 < end && g++ < 40) {
          addDue(date2, intro);
          iv2 = nextChainInterval(box2, iv2); box2 += 1;
          date2 = addDays(date2, iv2);
        }
      }
      days.push({ date: date, intro: intro, reviews: rev, total: intro + rev, minutes: estMinutes(intro, rev) });
    }
    if (finish === null && left === 0 && unseen === 0) finish = today;
    return { days: days, finish: finish, unseenAfter: left, horizon: horizon };
  }

  /* New words per day needed to finish before the exam, keeping the last week for revision. */
  function neededPerDay(unseen, today, examDate) {
    if (!examDate || examDate < today) return null;
    var left = Math.max(1, diffDays(examDate, today) + 1 - 7);
    return Math.ceil(unseen / left);
  }

  return {
    ymd: ymd, parseYmd: parseYmd, addDays: addDays, diffDays: diffDays,
    LADDER: LADDER, HARD_DAYS: HARD_DAYS, PILE_LIMIT: PILE_LIMIT, MIN_NEW: MIN_NEW, MIN_REVIEW: MIN_REVIEW,
    newCard: newCard, grade: grade, preview: preview, fmtInterval: fmtInterval,
    status: status, isWeak: isWeak, isDue: isDue,
    planQuota: planQuota, estMinutes: estMinutes, project: project, neededPerDay: neededPerDay
  };
});
