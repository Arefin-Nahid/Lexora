const test = require('node:test'), assert = require('node:assert/strict');
const { Session } = require('../js/session.js');
const srs = require('../js/srs.js');
const { makeStore, DAY } = require('./helpers.js');

test('today test: Forgot shows the card again in the same session, then it is scheduled', () => {
  const { store } = makeStore();
  const s = new Session(store, [1, 2, 3], { kind: 'srs' });
  assert.equal(s.current(), 1);
  s.grade('forgot');                       // 1 goes to the back
  assert.deepEqual(s.queue, [1, 2, 3, 1]);
  assert.equal(store.card(1).due, store.today(), 'a forgotten card stays due today');
  s.grade('got'); s.grade('hard');
  assert.equal(s.current(), 1);
  s.grade('got');
  assert.ok(s.done());
  const today = store.today();
  assert.equal(srs.diffDays(store.card(1).due, today), 7);
  assert.equal(srs.diffDays(store.card(2).due, today), 7);
  assert.equal(srs.diffDays(store.card(3).due, today), 3);
  assert.equal(store.day(today).newDone, 3, 'each word counts once as new');
  assert.equal(s.stats.forgot, 1);
});

test('reviews count as reviewed, not as new', () => {
  const { store, clock } = makeStore();
  new Session(store, [1, 2], { kind: 'srs' }).grade('got');
  store.applyGrade(2, 'got', true);
  clock.t += 8 * DAY;
  const due = store.dueIds(store.today());
  assert.deepEqual(due, [1, 2]);
  const s = new Session(store, due, { kind: 'srs' });
  s.grade('got'); s.grade('got');
  assert.equal(store.day(store.today()).reviewed, 2);
  assert.equal(store.day(store.today()).newDone, 0);
  assert.equal(srs.diffDays(store.card(1).due, store.today()), 14);
});

test('practice never changes the schedule but keeps hit and miss counts', () => {
  const { store } = makeStore();
  store.applyGrade(5, 'got', true);
  const before = JSON.stringify([store.card(5).due, store.card(5).box, store.card(5).iv]);
  const s = new Session(store, [5, 6], { kind: 'practice' });
  s.grade('forgot'); s.grade('got'); s.grade('got');
  assert.equal(JSON.stringify([store.card(5).due, store.card(5).box, store.card(5).iv]), before);
  assert.equal(store.card(5).misses, 1);
  assert.ok(!store.card(6).first, 'practice does not introduce a word');
  assert.equal(store.card(6).hits, 1);
});

test('a card forgotten over and over is not shown forever', () => {
  const { store } = makeStore();
  const s = new Session(store, [9], { kind: 'practice' });
  let n = 0;
  while (!s.done() && n++ < 20) s.grade('forgot');
  assert.ok(s.done()); assert.ok(n <= 5);
});

test('MCQ and typing answers map to got and forgot', () => {
  const { store } = makeStore();
  const s = new Session(store, [1, 2], { kind: 'srs' });
  s.answer(true); s.answer(false);
  assert.ok(store.card(1).hits === 1 && store.card(2).misses === 1);
  assert.deepEqual(s.missedIds(), [2]);
});

test('star and read flags are kept without starting the schedule', () => {
  const { store } = makeStore();
  store.toggleStar(7); store.setRead(7, true);
  assert.ok(store.card(7).star && store.card(7).read && !store.card(7).first);
  assert.equal(store.seenCount(), 0);
  store.toggleStar(7);
  assert.ok(!store.card(7).star);
});

test('streak counts consecutive active days', () => {
  const { store, clock } = makeStore();
  store.applyGrade(1, 'got', true);
  clock.t += DAY; store.applyGrade(2, 'got', true);
  clock.t += DAY; assert.equal(store.streak(), 2, 'today not started yet, yesterday still counts');
  store.applyGrade(3, 'got', true); assert.equal(store.streak(), 3);
  clock.t += 3 * DAY; assert.equal(store.streak(), 0);
});

test('state survives a reload from storage', () => {
  const { store, clock } = makeStore();
  store.applyGrade(1, 'got', true); store.setSetting('examDate', '2026-12-31');
  const { Store } = require('../js/store.js');
  const again = new Store({ storage: store.storage, now: () => clock.t });
  assert.equal(again.card(1).due, store.card(1).due);
  assert.equal(again.s.settings.examDate, '2026-12-31');
  assert.equal(again.day(again.today()).newDone, 1);
});
