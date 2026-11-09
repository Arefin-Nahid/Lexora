const test = require('node:test'), assert = require('node:assert/strict');
const { SyncEngine } = require('../js/sync.js');
const { FakeServer, FakeAdapter } = require('./fake-firebase.js');
const { makeStore, DAY } = require('./helpers.js');

const A = { uid: 'userA', name: 'A' }, B = { uid: 'userB', name: 'B' };
const tick = () => new Promise(r => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

function device(server, clock) {
  const { store } = makeStore(clock);
  const adapter = new FakeAdapter(server);
  const engine = new SyncEngine(store, adapter, { debounce: 0, initialTimeout: 50, retryMs: 10 });
  engine.init();
  return { store, adapter, engine };
}

test('progress made before signing in is merged into the account on first login', async () => {
  const server = new FakeServer(), clock = { t: Date.parse('2026-11-10T09:00:00') };
  const d = device(server, clock);
  d.store.applyGrade(1, 'got', true); d.store.applyGrade(2, 'hard', true); d.store.setSetting('dailyNew', 12);
  await d.adapter.signIn(A); await settle();
  assert.equal(d.store.s.owner, 'userA');
  assert.deepEqual(Object.keys(server.u('userA').cards).sort(), ['1', '2']);
  assert.equal(server.u('userA').state.settings.dailyNew, 12);
  assert.equal(server.u('userA').days[d.store.today()].newDone, 2);
  assert.equal(d.engine.status, 'synced');
});

test('two devices: newest change wins per card, counters add up', async () => {
  const server = new FakeServer(), clock = { t: Date.parse('2026-11-10T09:00:00') };
  const one = device(server, clock), two = device(server, clock);
  await one.adapter.signIn(A); await two.adapter.signIn(A); await settle();

  one.store.applyGrade(1, 'got', true); await settle();
  assert.equal(two.store.card(1).hits, 1, 'device two received the card');

  clock.t += 1000;
  two.store.applyGrade(1, 'forgot', false);          // newer change on device two
  one.store.applyGrade(2, 'got', true);
  await settle();
  assert.equal(one.store.card(1).misses, 1, 'newest wins on device one');
  assert.equal(server.u('userA').cards[1].misses, 1);
  assert.ok(two.store.card(2), 'card 2 reached device two');

  const today = one.store.today();
  two.store.applyGrade(3, 'got', true); await settle();
  assert.equal(server.u('userA').days[today].newDone, 3);
  assert.equal(one.store.day(today).newDone, 3);
  assert.equal(two.store.day(today).newDone, 3);
});

test('an older offline edit does not overwrite a newer change from another device', async () => {
  const server = new FakeServer(), clock = { t: Date.parse('2026-11-10T09:00:00') };
  const one = device(server, clock), two = device(server, clock);
  await one.adapter.signIn(A); await two.adapter.signIn(A);
  one.store.applyGrade(4, 'got', true); await settle();

  two.adapter.online = false;
  clock.t += 1000; two.store.toggleStar(4);              // older edit, made offline
  await settle();
  assert.equal(two.engine.status, 'offline');
  clock.t += 5000; one.store.applyGrade(4, 'hard', false); // newer edit elsewhere
  await settle();
  two.adapter.goOnline(); await two.engine.goOnline(); await settle();
  const final = server.u('userA').cards[4];
  assert.equal(final.iv, 3, 'newer grade is kept in the cloud');
  assert.equal(two.store.card(4).iv, 3);
});

test('offline changes queue up and are sent when the device is back online', async () => {
  const server = new FakeServer(), clock = { t: Date.parse('2026-11-10T09:00:00') };
  const d = device(server, clock);
  await d.adapter.signIn(A); await settle();
  d.adapter.online = false;
  d.store.applyGrade(10, 'got', true); d.store.applyGrade(11, 'got', true);
  await settle();
  assert.equal(Object.keys(server.u('userA').cards).length, 0);
  assert.equal(Object.keys(d.store.s.dirtyCards).length, 2);
  assert.equal(d.store.s.pending[d.store.today()].newDone, 2);
  d.adapter.goOnline(); await d.engine.goOnline(); await settle();
  assert.equal(Object.keys(server.u('userA').cards).length, 2);
  assert.equal(Object.keys(d.store.s.dirtyCards).length, 0);
  assert.equal(server.u('userA').days[d.store.today()].newDone, 2);
  assert.equal(d.store.day(d.store.today()).newDone, 2, 'local total is not counted twice');
});

test("another account's data never bleeds into a signed-in account", async () => {
  const server = new FakeServer(), clock = { t: Date.parse('2026-11-10T09:00:00') };
  const d = device(server, clock);
  d.store.applyGrade(1, 'got', true);
  await d.adapter.signIn(A); await settle();
  assert.ok(server.u('userA').cards[1]);

  await d.adapter.signOut(); await settle();
  assert.equal(d.engine.status, 'signed-out');
  d.store.applyGrade(2, 'got', true);                      // signed-out use stays on the device
  await settle();
  assert.ok(!server.u('userA').cards[2]);

  server.u('userB').cards[50] = { id: 50, box: 1, ef: 2.5, iv: 7, due: '2026-11-17', lapses: 0, hits: 1, misses: 0, star: false, read: false, first: '2026-11-01', t: 5 };
  await d.adapter.signIn(B); await settle();
  assert.deepEqual(Object.keys(d.store.s.cards), ['50'], "only account B's progress is on the device");
  assert.equal(d.engine.lastResult.replaced, true);
  assert.deepEqual(Object.keys(server.u('userB').cards), ['50'], "account A's cards were not written to account B");
  assert.ok(server.u('userA').cards[1], "account A's cloud data is untouched");
  assert.equal(d.store.s.owner, 'userB');
});

test('signing back in as the same account merges instead of replacing', async () => {
  const server = new FakeServer(), clock = { t: Date.parse('2026-11-10T09:00:00') };
  const d = device(server, clock);
  await d.adapter.signIn(A); d.store.applyGrade(1, 'got', true); await settle();
  await d.adapter.signOut(); clock.t += 1000; d.store.applyGrade(2, 'got', true);
  await d.adapter.signIn(A); await settle();
  assert.deepEqual(Object.keys(server.u('userA').cards).sort(), ['1', '2']);
  assert.equal(d.engine.lastResult.replaced, false);
});

test('first load while offline falls back to local data and syncs later', async () => {
  const server = new FakeServer(), clock = { t: Date.parse('2026-11-10T09:00:00') };
  const d = device(server, clock);
  d.adapter.online = false;
  d.store.applyGrade(1, 'got', true);
  await d.adapter.signIn(A);
  await new Promise(r => setTimeout(r, 80));
  assert.equal(d.engine.status, 'offline');
  assert.ok(d.store.card(1), 'local progress is still there');
  d.adapter.goOnline(); await settle(); await d.engine.goOnline(); await settle();
  assert.ok(server.u('userA').cards[1]);
  assert.equal(d.engine.status, 'synced');
});
