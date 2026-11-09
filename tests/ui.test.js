/* Session flows and a two-device sync test, run in jsdom against the built index.html served by a local server. */
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('http'), fs = require('fs'), path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { FakeServer, FakeAdapter } = require('./fake-firebase.js');
const { ROOT, entries } = require('./helpers.js');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.png': 'image/png' };
let server, base;
test.before(async () => {
  server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p));
  });
  await new Promise(r => server.listen(0, r));
  base = 'http://localhost:' + server.address().port + '/';
});
test.after(() => server.close());

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));
async function openApp(adapter) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!/Not implemented|Could not load link/.test(e.message)) errors.push(e.message); });
  const dom = await JSDOM.fromURL(base + 'index.html', {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.__lexoraAdapter = adapter || new FakeAdapter(new FakeServer()); w.HTMLElement.prototype.scrollIntoView = () => {}; w.scrollTo = () => {}; }
  });
  await new Promise(r => dom.window.addEventListener('load', r));
  await wait(60);
  const w = dom.window, d = w.document;
  const $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)];
  const click = s => { const el = typeof s === 'string' ? $(s) : s; assert.ok(el, 'missing ' + s); el.click(); };
  const type = (s, v) => { const el = $(s); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const change = (s, v) => { const el = $(s); el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  return { dom, w, d, $, $$, click, type, change, errors, app: w.Lexora.app, close: () => w.close() };
}
const sheetOpen = A => !A.$('#sheet').hidden;

async function gradeAll(A, plan) {
  let n = 0;
  while (sheetOpen(A) && A.$('.flash')) {
    if (A.$('[data-act=flip]')) A.click('[data-act=flip]');
    A.click('[data-act=grade][data-g=' + plan[n++ % plan.length] + ']');
    assert.ok(n < 200, 'session does not end');
  }
  return n;
}

test('home, tabs and the gear icon that toggles back', async () => {
  const A = await openApp();
  assert.match(A.$('.hero .big').textContent, /20\s*words left/);
  assert.equal(A.$$('#tabs button').length, 5);
  assert.deepEqual(A.$$('#tabs button > span:last-child').map(s => s.textContent), ['Home', 'Today', 'Practice', 'Search', 'Plan']);
  A.click('[data-r=plan]'); assert.equal(A.$('.topbar h1').textContent, 'Plan');
  A.click('.topbar [aria-label=Settings]'); assert.equal(A.$('.topbar h1').textContent, 'Settings');
  A.click('.topbar [aria-label=Settings]'); assert.equal(A.$('.topbar h1').textContent, 'Plan', 'second tap goes back');
  assert.deepEqual(A.errors, []); await wait(60); A.close();
});

test("today's flow: read list with ticks, then a graded test with intervals under the buttons", async () => {
  const A = await openApp();
  A.click('[data-act=start]');
  const rows = A.$$('li.rd');
  assert.equal(rows.length, 20);
  assert.equal(rows[0].querySelector('.no').textContent, '1');
  assert.equal(rows[0].querySelector('.w').textContent, entries[0].word, 'file order');
  A.click(rows[0].querySelector('.tick')); A.click(rows[1].querySelector('.star'));
  assert.ok(A.app.store.card(1).read && A.app.store.card(2).star);
  assert.equal(A.$('#sn').textContent, '1/20 read');
  A.click('[data-act=cover]');
  assert.equal(A.$$('li.rd .cover').length, 20, 'answers are covered');
  A.click('.cover'); assert.ok(A.$('li.rd .bnline'), 'tap reveals one word');
  A.click('[data-act=readNext]');
  assert.match(A.$('.sheet .t').textContent, /Test/);
  A.click('[data-act=flip]');
  assert.deepEqual(A.$$('.grade small').map(s => s.textContent), ['Again now', '3 days', '7 days']);
  const shown = A.$('.flash .big').textContent;
  A.click('[data-act=grade][data-g=forgot]');
  let seenAgain = false;
  while (A.$('.flash')) {
    if (A.$('[data-act=flip]')) A.click('[data-act=flip]');
    if (A.$('.flash .big').textContent === shown) seenAgain = true;
    A.click('[data-act=grade][data-g=' + (A.$('.flash .big').textContent === shown ? 'got' : 'hard') + ']');
  }
  assert.ok(seenAgain, 'a forgotten word comes back in the same session');
  assert.match(A.$('.score').textContent, /of 20/);
  A.click('[data-act=close]');
  assert.match(A.$('.hero .big').textContent, /Done/);
  const st = A.app.store, today = st.today();
  assert.equal(st.seenCount(), 20); assert.equal(st.day(today).newDone, 20);
  assert.ok(Object.values(st.s.cards).every(c => c.due > today));
  assert.deepEqual(A.errors, []); await wait(60); A.close();
});

test('practice: filters, scope and count; multiple choice and typing never touch the schedule', async () => {
  const A = await openApp();
  A.click('[data-r=practice]');
  A.click('[data-act=cat][data-c=B]'); A.click('[data-act=scope][data-s=new]'); A.click('[data-act=count][data-n="10"]');
  assert.match(A.$('main').textContent, /19 words match/);
  A.click('[data-act=mode][data-m=mcq]');
  let answered = 0;
  while (A.$('.opts')) {
    assert.equal(A.$$('.opt').length, 4);
    A.click('.opt'); answered++; A.click('[data-act=qnext]');
    assert.ok(answered < 40);
  }
  assert.ok(answered >= 10);
  A.click('[data-act=close]');
  assert.equal(A.app.store.seenCount(), 0, 'practice does not start the schedule');
  assert.ok(Object.values(A.app.store.s.cards).every(c => !c.due));
  A.click('[data-act=mode][data-m=type]');
  const e = entries.find(x => x.id === Number(A.$('.sheet .big').textContent ? entries.find(y => y.word === A.$('.sheet .big').textContent).id : 0));
  const kind = /Antonym/.test(A.$('.q .label').textContent) ? 'ant' : 'syn';
  A.type('#typed', e[kind][0]); A.click('[data-act=check]');
  assert.match(A.$('.verdict').textContent, /Correct/);
  assert.deepEqual(A.errors, []); await wait(60); A.close();
});

test('read as a list shows words in book order with read ticks, and weak words need a miss', async () => {
  const A = await openApp();
  A.click('[data-r=practice]'); A.click('[data-act=count][data-n="10"]');
  A.click('[data-act=mode][data-m=weak]');
  assert.match(A.$('#toast').textContent, /No difficult words yet/);
  A.click('[data-act=mode][data-m=list]');
  assert.deepEqual(A.$$('li.rd .w').map(x => x.textContent), entries.slice(0, 10).map(x => x.word));
  A.click('[data-act=markAll]'); assert.equal(A.$('#sn').textContent, '10/10 read');
  A.click('[data-act=close]');
  A.click('[data-act=scope][data-s=any]'); A.click('[data-act=mode][data-m=flash]');
  A.click('[data-act=flip]'); A.click('[data-act=grade][data-g=forgot]');
  assert.ok(A.app.store.s.cards[A.app.store.s.cards ? Object.keys(A.app.store.s.cards).find(k => A.app.store.s.cards[k].misses) : 0].misses === 1);
  await wait(60); A.close();
});

test('Pick more words reads extra words without using up the daily plan', async () => {
  const A = await openApp();
  A.click('[data-r=today]');
  A.click('[data-act=cat][data-k=pick][data-c=B]'); A.click('[data-act=count][data-k=pick][data-n="10"]');
  A.click('[data-act=pickRead]');
  const words = A.$$('li.rd .w').map(x => x.textContent);
  assert.equal(words.length, 10);
  const b = entries.filter(e => e.cat === 'B').slice(0, 10).map(e => e.word);
  assert.deepEqual(words, b);
  A.click('[data-act=close]');
  const sm = A.app.store.todaySummary(571);
  assert.equal(sm.remainingNew, 20, 'the plan is unchanged'); assert.equal(sm.newDone, 0);
  await wait(60); A.close();
});

test('search: headword, reverse lookup under the matching word, letters, unclear tag', async () => {
  const A = await openApp();
  A.click('[data-r=search]');
  A.type('#q', 'absurd');
  assert.ok(A.$('details.res[open]'), 'exact match opens');
  assert.match(A.$('details.res').textContent, /Unreasonable/);
  A.type('#q', 'calm');
  const g = A.$('details.res');
  assert.match(g.textContent, /Also listed under Calm/);
  assert.match(g.textContent, /Synonym of\s*Assuage/);
  assert.match(g.textContent, /Antonym of\s*Annoy/);
  A.type('#q', 'belittle');
  assert.match(A.$('#results').textContent, /Unclear in source/);
  assert.match(A.$('#results').textContent, /Parise/);
  A.type('#q', '');
  A.click('[data-act=letter][data-c=Q]');
  assert.deepEqual(A.$$('#results > details > summary b').map(x => x.textContent).sort(), entries.filter(e => e.cat === 'Q').map(e => e.word).sort());
  A.change('#fstatus', 'starred'); assert.match(A.$('#results').textContent, /No words found/);
  A.type('#q', 'অযৌক্তিক'); A.click('[data-act=letter][data-c=Q]'); A.change('#fstatus', '');
  assert.match(A.$('#results').textContent, /Absurd/);
  assert.deepEqual(A.errors, []); await wait(60); A.close();
});

test('plan: pace, exam date projection and the settings screen', async () => {
  const A = await openApp();
  A.click('[data-r=plan]');
  assert.match(A.$('main').textContent, /Set an exam date/);
  const future = new Date(Date.now() + 70 * 864e5).toISOString().slice(0, 10);
  A.change('#exam', future);
  assert.match(A.$('main').textContent, /Schedule until your exam/);
  assert.match(A.$('main .notice').textContent, /every word by/);
  A.click('[data-act=pace][data-n="5"]');
  assert.match(A.$('main .notice').textContent, /You would need about/);
  assert.equal(A.app.store.s.settings.dailyNew, 5);
  A.click('.topbar [aria-label=Settings]');
  assert.match(A.$('main').textContent, /Sign in with Google/);
  A.click('[data-act=theme][data-t=dark]'); assert.equal(A.d.documentElement.getAttribute('data-theme'), 'dark');
  A.click('[data-act=theme][data-t=system]'); assert.equal(A.d.documentElement.getAttribute('data-theme'), null);
  A.change('#budget', '60'); assert.equal(A.app.store.s.settings.budget, 60);
  A.click('[data-act=reset]'); assert.match(A.$('[data-act=reset]').textContent, /Tap again/);
  A.click('[data-act=reset]'); assert.equal(A.app.store.seenCount(), 0);
  assert.deepEqual(A.errors, []); await wait(60); A.close();
});

test('two devices through the app: progress made on one shows up on the other', async () => {
  const server = new FakeServer(), a1 = new FakeAdapter(server), a2 = new FakeAdapter(server);
  const A = await openApp(a1), B = await openApp(a2);
  await a1.signIn({ uid: 'u1', name: 'Nahid', email: 'n@example.com', photo: '' });
  await a2.signIn({ uid: 'u1', name: 'Nahid', email: 'n@example.com', photo: '' });
  await wait(80);
  A.click('[data-act=start]'); A.click('[data-act=readNext]');
  await gradeAll(A, ['got']);
  A.click('[data-act=close]'); await wait(1500);
  assert.equal(A.app.store.seenCount(), 20);
  assert.equal(Object.keys(server.u('u1').cards).length, 20);
  assert.equal(B.app.store.seenCount(), 20, 'device B received the cards');
  assert.match(B.$('.hero .big').textContent, /Done/, 'and its home screen updated');
  assert.equal(B.app.store.day(B.app.store.today()).newDone, 20);
  assert.equal(A.app.engine.status, 'synced');
  A.click('.topbar [aria-label=Settings]');
  assert.match(A.$('main').textContent, /n@example.com/);
  assert.deepEqual(A.errors.concat(B.errors), []); await wait(60); A.close(); B.close();
});
