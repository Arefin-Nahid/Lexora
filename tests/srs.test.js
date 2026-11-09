const test = require('node:test'), assert = require('node:assert/strict');
const srs = require('../js/srs.js');
const { makeStore, entries, DAY } = require('./helpers.js');

const T0 = '2026-11-10';

test('Got it ladder: 7, 14, 30 days, then ease factor', () => {
  let c = srs.newCard(1), today = T0, seen = [];
  for (let i = 0; i < 5; i++) {
    c = srs.grade(c, 'got', today);
    seen.push(srs.diffDays(c.due, today));
    today = c.due;
  }
  assert.deepEqual(seen.slice(0, 3), [7, 14, 30]);
  assert.ok(seen[3] > 30 && seen[4] > seen[3], 'intervals keep growing after the ladder: ' + seen);
  assert.equal(c.box, 5);
});

test('Hard is 3 days and does not move the box', () => {
  let c = srs.grade(srs.newCard(1), 'got', T0);   // box 1
  c = srs.grade(c, 'hard', c.due);
  assert.equal(srs.diffDays(c.due, T0) - 7, 3);
  assert.equal(c.box, 1);
  assert.ok(c.ef < 2.6);
});

test('Forgot resets the box, is due today and counts a lapse', () => {
  let c = srs.newCard(1);
  c = srs.grade(c, 'got', T0); c = srs.grade(c, 'got', c.due);
  const f = srs.grade(c, 'forgot', '2026-12-01');
  assert.equal(f.box, 0); assert.equal(f.due, '2026-12-01'); assert.equal(f.lapses, 1); assert.equal(f.iv, 0);
  assert.ok(f.ef >= 1.3 && f.ef < c.ef);
  // after a forgotten word the ladder starts again at 7 days
  assert.equal(srs.diffDays(srs.grade(f, 'got', '2026-12-01').due, '2026-12-01'), 7);
});

test('ease factor stays inside 1.3 and 3.0', () => {
  let c = srs.newCard(1);
  for (let i = 0; i < 30; i++) c = srs.grade(c, 'forgot', T0);
  assert.equal(c.ef, 1.3);
  for (let i = 0; i < 60; i++) c = srs.grade(c, 'got', T0);
  assert.equal(c.ef, 3);
  assert.ok(srs.diffDays(c.due, T0) <= 365);
});

test('button previews show the next interval', () => {
  const p = srs.preview(srs.newCard(1), T0);
  assert.deepEqual(p, { forgot: 'Again now', hard: '3 days', got: '7 days' });
  const c = srs.grade(srs.newCard(1), 'got', T0);
  assert.equal(srs.preview(c, c.due).got, '14 days');
  assert.equal(srs.fmtInterval(1), '1 day');
});

test('status, weak and due helpers', () => {
  assert.equal(srs.status(null), 'new');
  let c = srs.grade(srs.newCard(1), 'got', T0);
  assert.equal(srs.status(c), 'learning');
  for (let i = 0; i < 3; i++) c = srs.grade(c, 'got', T0);
  assert.equal(srs.status(c), 'mastered');
  const w = srs.grade(srs.newCard(2), 'forgot', T0);
  assert.ok(srs.isWeak(w));
  assert.ok(srs.isDue(w, T0)); assert.ok(!srs.isDue(srs.grade(srs.newCard(3), 'got', T0), T0));
});

test('daily quota is reduced when reviews pile up', () => {
  assert.equal(srs.planQuota({ dailyNew: 20, budget: 30, dueCount: 0 }).quota, 20);
  const mid = srs.planQuota({ dailyNew: 20, budget: 30, dueCount: 30 });
  assert.ok(mid.quota < 20 && mid.quota > 0 && mid.reduced);
  assert.equal(srs.planQuota({ dailyNew: 20, budget: 30, dueCount: 60 }).quota, 0);
  assert.equal(srs.planQuota({ dailyNew: 20, budget: 15, dueCount: 40 }).quota, 0);
});

test('the daily plan is frozen for the day', () => {
  const { store, clock } = makeStore();
  const today = store.today();
  const p1 = store.ensurePlan(today);
  assert.equal(p1.quota, 20);
  store.setSetting('dailyNew', 5);
  assert.equal(store.ensurePlan(today).quota, 20, 'changing the setting does not change today');
  clock.t += DAY;
  assert.equal(store.ensurePlan(store.today()).quota, 5, 'it applies tomorrow');
});

test('today summary follows grading', () => {
  const { store } = makeStore();
  const s0 = store.todaySummary(entries.length);
  assert.equal(s0.remainingNew, 20); assert.equal(s0.due, 0);
  for (let i = 1; i <= 5; i++) store.applyGrade(i, 'got', true);
  const s1 = store.todaySummary(entries.length - 5);
  assert.equal(s1.newDone, 5); assert.equal(s1.remainingNew, 15);
  assert.ok(s1.progress > 0.2 && s1.progress < 0.3);
});

test('projection to an exam date', () => {
  const { store } = makeStore();
  const unseen = 571;
  const exam = srs.addDays(T0, 40);
  const p = srs.project({ today: T0, cards: {}, unseen, examDate: exam, dailyNew: 20, budget: 30 });
  assert.equal(p.days.length, 41);
  assert.equal(p.days[0].intro, 20);
  assert.ok(p.days[7].reviews >= 20, 'first reviews come back after 7 days');
  assert.ok(p.finish === null || p.finish <= exam);
  assert.equal(srs.neededPerDay(571, T0, exam), Math.ceil(571 / (41 - 7)));
  const quick = srs.project({ today: T0, cards: {}, unseen: 30, examDate: null, dailyNew: 20, budget: 30 });
  assert.equal(quick.days.length, 14); assert.equal(quick.finish, srs.addDays(T0, 1));
});

test('projection counts reviews already scheduled', () => {
  const c = srs.grade(srs.newCard(1), 'got', T0);
  const p = srs.project({ today: srs.addDays(T0, 1), cards: { 1: c }, unseen: 0, examDate: null, dailyNew: 20, budget: 30 });
  const dayOfReview = p.days.find(d => d.date === c.due);
  assert.equal(dayOfReview.reviews, 1);
});
