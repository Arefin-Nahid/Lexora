const test = require('node:test'), assert = require('node:assert/strict');
const { data, entries } = require('./helpers.js');

test('data.json is complete and well formed', () => {
  assert.equal(entries.length, 571);
  assert.equal(data.meta.entries, 571);
  entries.forEach((e, i) => {
    assert.equal(e.id, i + 1);
    assert.ok(e.word && e.bn && e.syn.length && e.ant.length, 'fields present for ' + e.word);
    assert.match(e.cat, /^[A-Z]$/);
    assert.ok(e.page >= 231 && e.page <= 248);
  });
  assert.equal(new Set(entries.map(e => e.page)).size, 18);
});

test('as-printed values are kept and doubts are tagged', () => {
  const belittle = entries.find(e => e.word === 'Belittle');
  assert.ok(belittle.ant.includes('Parise') && belittle.note && belittle.suggest.terms.Parise === 'Praise');
  const ing = entries.filter(e => e.word === 'Ingenious');
  assert.equal(ing.length, 2);
  assert.equal(ing[1].suggest.word, 'Ingenuous');
  assert.equal(entries.filter(e => e.note).length, 36);
});
