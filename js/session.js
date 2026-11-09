/* Lexora study sessions: queue handling for flashcards, MCQ and typing. No DOM. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Lexora = root.Lexora || {}; root.Lexora.session = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_REQUEUE = 3;

  /* kind: 'srs' (today's test, changes the schedule) or 'practice' (only keeps hit and miss counts).
     A card marked "Forgot" goes to the back of the queue and is shown again in the same session. */
  function Session(store, ids, opts) {
    opts = opts || {};
    this.store = store;
    this.kind = opts.kind || 'practice';
    this.queue = ids.slice();
    this.pos = 0;
    this.total = ids.length;
    this.counted = {};
    this.requeues = {};
    this.stats = { forgot: 0, hard: 0, got: 0 };
    this.missed = {};
  }
  var P = Session.prototype;

  P.current = function () { return this.pos < this.queue.length ? this.queue[this.pos] : null; };
  P.done = function () { return this.pos >= this.queue.length; };
  P.progress = function () {
    var finished = Object.keys(this.counted).filter(function (k) { return this.counted[k] === 'final'; }, this).length;
    return this.total ? finished / this.total : 1;
  };

  /* g: 'forgot' | 'hard' | 'got' */
  P.grade = function (g) {
    var id = this.current();
    if (id === null) return null;
    var first = !this.counted[id];
    if (this.kind === 'srs') {
      this.store.applyGrade(id, g, first);
    } else if (first || g !== 'forgot') {
      if (first) this.store.recordPractice(id, g !== 'forgot');
    }
    if (first) { this.counted[id] = 'seen'; this.stats[g] += 1; }
    if (g === 'forgot') {
      this.missed[id] = 1;
      this.requeues[id] = (this.requeues[id] || 0) + 1;
      if (this.requeues[id] <= MAX_REQUEUE) this.queue.push(id);
      else this.counted[id] = 'final';
    } else {
      this.counted[id] = 'final';
    }
    this.pos += 1;
    return g;
  };

  /* MCQ and typing: ok is true or false. A wrong answer counts as "forgot" (and, in a test, is shown again). */
  P.answer = function (ok) { return this.grade(ok ? 'got' : 'forgot'); };

  /* Move past a card that cannot be asked in this mode, without grading it. */
  P.skip = function () { var id = this.current(); if (id !== null) { this.counted[id] = 'final'; this.pos += 1; } };

  P.missedIds = function () { return Object.keys(this.missed).map(Number); };

  return { Session: Session, MAX_REQUEUE: MAX_REQUEUE };
});
