/* Lexora quiz logic: word index, safe MCQ distractors, type-the-answer matching, interleaving. No DOM. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Lexora = root.Lexora || {}; root.Lexora.quiz = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/\(.*?\)/g, ' ').replace(/[^a-z\- ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    rng = rng || Math.random;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ---------- index ---------- */
  function suspectSet(e) {
    var s = new Set();
    var t = (e.suggest && e.suggest.terms) || {};
    Object.keys(t).forEach(function (k) { s.add(norm(k)); });
    return s;
  }

  function buildIndex(entries) {
    var byId = new Map(), byWord = new Map(), termIn = new Map(), allTerms = new Map();
    entries.forEach(function (e) {
      byId.set(e.id, e);
      var w = norm(e.word);
      if (!byWord.has(w)) byWord.set(w, []);
      byWord.get(w).push(e);
      var sus = suspectSet(e);
      [['syn', e.syn], ['ant', e.ant]].forEach(function (p) {
        p[1].forEach(function (t) {
          var n = norm(t);
          if (!n) return;
          if (!termIn.has(n)) termIn.set(n, []);
          termIn.get(n).push({ entry: e, kind: p[0], term: t });
          if (!sus.has(n) && !allTerms.has(n)) allTerms.set(n, t);
        });
      });
    });
    var pool = Array.from(allTerms.entries()).map(function (kv) { return { n: kv[0], t: kv[1] }; });
    return { entries: entries, byId: byId, byWord: byWord, termIn: termIn, pool: pool };
  }

  /* Words that are the same word, or a valid synonym or antonym of it, in any group. Never use these as distractors. */
  function relatedSet(index, e) {
    var b = new Set(), w = norm(e.word);
    function addEntry(x) {
      b.add(norm(x.word));
      if (x.suggest && x.suggest.word) b.add(norm(x.suggest.word));
      x.syn.concat(x.ant).forEach(function (t) {
        b.add(norm(t));
        var s = x.suggest && x.suggest.terms && x.suggest.terms[t];
        if (s) b.add(norm(s));
      });
    }
    b.add(w);
    (index.byWord.get(w) || [e]).forEach(addEntry);
    addEntry(e);
    // reverse lookups: entries where this word is listed as a synonym or antonym
    (index.termIn.get(w) || []).forEach(function (r) { addEntry(r.entry); });
    // one step further: the headwords listed as e's own synonyms and antonyms
    e.syn.concat(e.ant).forEach(function (t) {
      (index.byWord.get(norm(t)) || []).forEach(addEntry);
    });
    return b;
  }

  /* All terms of a kind that count as correct for this word: every group sharing the headword, plus printed and suggested spellings. */
  function validTerms(index, e, kind) {
    var out = [], seen = new Set();
    (index.byWord.get(norm(e.word)) || [e]).forEach(function (x) {
      (kind === 'syn' ? x.syn : x.ant).forEach(function (t) {
        var n = norm(t);
        if (n && !seen.has(n)) { seen.add(n); out.push(t); }
        var s = x.suggest && x.suggest.terms && x.suggest.terms[t];
        if (s && !seen.has(norm(s))) { seen.add(norm(s)); out.push(s); }
      });
    });
    return out;
  }

  /* Terms that are safe to show as the correct answer: not flagged as a probable misprint. */
  function safeTerms(index, e, kind) {
    var out = [], seen = new Set();
    (index.byWord.get(norm(e.word)) || [e]).forEach(function (x) {
      var sus = suspectSet(x);
      (kind === 'syn' ? x.syn : x.ant).forEach(function (t) {
        var n = norm(t);
        if (n && !sus.has(n) && !seen.has(n)) { seen.add(n); out.push(t); }
      });
    });
    return out;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* Returns {id, kind, word, options, answer, entryId, correct} or null when the word has no safe answer of that kind. */
  function makeMcq(index, e, kind, rng) {
    rng = rng || Math.random;
    var good = safeTerms(index, e, kind);
    if (!good.length) return null;
    var correct = good[Math.floor(rng() * good.length)];
    var banned = relatedSet(index, e);
    var multi = /\s/.test(correct);
    var cands = index.pool.filter(function (p) {
      return !banned.has(p.n) && p.n !== norm(correct) && (multi || !/\s/.test(p.n)) && p.n.length > 2;
    });
    cands = shuffle(cands, rng);
    var opts = [correct], used = new Set([norm(correct)]);
    for (var i = 0; i < cands.length && opts.length < 4; i++) {
      if (used.has(cands[i].n)) continue;
      used.add(cands[i].n); opts.push(cap(cands[i].t));
    }
    if (opts.length < 4) return null;
    var order = shuffle(opts, rng);
    return { id: e.id + ':' + kind, entryId: e.id, kind: kind, word: e.word, options: order, answer: order.indexOf(correct), correct: correct };
  }

  /* ---------- typing ---------- */
  function lev(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }
  function tolerance(len) { return len <= 3 ? 0 : (len <= 7 ? 1 : 2); }

  /* Accepts any valid synonym or antonym of the asked kind and tolerates a near-miss spelling. */
  function checkTyped(index, e, kind, input) {
    var typed = norm(input);
    if (!typed) return { ok: false };
    if (typed === norm(e.word)) return { ok: false, same: true };
    var terms = validTerms(index, e, kind), best = null;
    for (var i = 0; i < terms.length; i++) {
      var n = norm(terms[i]);
      if (n === typed) return { ok: true, exact: true, matched: terms[i] };
      var d = lev(n, typed);
      if (d <= tolerance(Math.max(n.length, typed.length)) && (!best || d < best.d)) best = { d: d, t: terms[i] };
    }
    return best ? { ok: true, exact: false, matched: best.t } : { ok: false };
  }

  /* ---------- interleave ---------- */
  function interleave(ids, byId, rng) {
    var groups = {};
    shuffle(ids, rng).forEach(function (id) {
      var c = byId.get(id) ? byId.get(id).cat : '#';
      (groups[c] = groups[c] || []).push(id);
    });
    var keys = shuffle(Object.keys(groups), rng), out = [], more = true;
    while (more) {
      more = false;
      keys.forEach(function (k) { if (groups[k].length) { out.push(groups[k].shift()); more = true; } });
    }
    return out;
  }

  return {
    norm: norm, mulberry32: mulberry32, shuffle: shuffle, lev: lev,
    buildIndex: buildIndex, relatedSet: relatedSet, validTerms: validTerms, safeTerms: safeTerms,
    makeMcq: makeMcq, checkTyped: checkTyped, interleave: interleave
  };
});
