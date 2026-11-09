const test = require('node:test'), assert = require('node:assert/strict');
const quiz = require('../js/quiz.js');
const { entries } = require('./helpers.js');
const index = quiz.buildIndex(entries);

test('MCQ distractors are never a valid synonym or antonym of the word (every entry, both kinds, 3 seeds)', () => {
  let made = 0;
  for (const seed of [1, 2, 3]) {
    const rng = quiz.mulberry32(seed);
    for (const e of entries) {
      for (const kind of ['syn', 'ant']) {
        const q = quiz.makeMcq(index, e, kind, rng);
        if (!q) continue;
        made++;
        assert.equal(q.options.length, 4);
        assert.equal(new Set(q.options.map(quiz.norm)).size, 4, 'options are distinct for ' + e.word);
        const valid = new Set([...quiz.validTerms(index, e, 'syn'), ...quiz.validTerms(index, e, 'ant')].map(quiz.norm));
        const related = quiz.relatedSet(index, e);
        q.options.forEach((o, i) => {
          if (i === q.answer) return;
          const n = quiz.norm(o);
          assert.ok(!valid.has(n), `"${o}" is a valid synonym/antonym of ${e.word}`);
          assert.ok(!related.has(n), `"${o}" is related to ${e.word}`);
          assert.notEqual(n, quiz.norm(e.word));
        });
        const right = index.byWord.get(quiz.norm(e.word)).flatMap(x => kind === 'syn' ? x.syn : x.ant);
        assert.ok(right.map(quiz.norm).includes(quiz.norm(q.options[q.answer])), 'correct option is a real ' + kind);
      }
    }
  }
  assert.ok(made > 3000, 'questions were generated: ' + made);
});

test('a flagged misprint is never offered as the correct answer or as a distractor', () => {
  const belittle = entries.find(e => e.word === 'Belittle');
  assert.ok(belittle.ant.includes('Parise'));
  for (let s = 0; s < 40; s++) {
    const q = quiz.makeMcq(index, belittle, 'ant', quiz.mulberry32(s));
    assert.ok(q);
    assert.ok(!q.options.map(quiz.norm).includes('parise'));
  }
  for (const e of entries) {
    const q = quiz.makeMcq(index, e, 'syn', quiz.mulberry32(e.id));
    if (q) assert.ok(!q.options.map(quiz.norm).includes('clam'));
  }
});

test('typing accepts any valid answer of that kind and tolerates near misses', () => {
  const absurd = entries.find(e => e.word === 'Absurd');
  assert.deepEqual(quiz.checkTyped(index, absurd, 'syn', 'illogical').matched, 'Illogical');
  assert.ok(quiz.checkTyped(index, absurd, 'syn', ' UNREASONABLE ').ok);
  const near = quiz.checkTyped(index, absurd, 'syn', 'unreasonible');
  assert.ok(near.ok && !near.exact);
  assert.ok(!quiz.checkTyped(index, absurd, 'syn', 'sensible').ok, 'an antonym is wrong for a synonym question');
  assert.ok(quiz.checkTyped(index, absurd, 'ant', 'sensible').ok);
  assert.ok(!quiz.checkTyped(index, absurd, 'syn', 'absurd').ok, 'the word itself is not an answer');
  assert.ok(!quiz.checkTyped(index, absurd, 'syn', '').ok);
  assert.ok(!quiz.checkTyped(index, absurd, 'syn', 'banana').ok);
});

test('typing also accepts the probable spelling of a flagged misprint', () => {
  const belittle = entries.find(e => e.word === 'Belittle');
  assert.ok(quiz.checkTyped(index, belittle, 'ant', 'Praise').ok);
  assert.ok(quiz.checkTyped(index, belittle, 'ant', 'Parise').ok);
});

test('a word with several groups accepts answers from all of them', () => {
  const groups = entries.filter(e => e.word === 'Proficient');
  assert.equal(groups.length, 2);
  const a = groups[0].syn[0], b = groups[1].syn.find(t => !groups[0].syn.includes(t));
  assert.ok(quiz.checkTyped(index, groups[0], 'syn', a).ok);
  if (b) assert.ok(quiz.checkTyped(index, groups[0], 'syn', b).ok);
});

test('levenshtein and normalisation', () => {
  assert.equal(quiz.lev('kitten', 'sitting'), 3);
  assert.equal(quiz.norm('Affable (অমায়িক)'), 'affable');
  assert.equal(quiz.norm('  Set  Free '), 'set free');
});

test('interleave mixes categories and keeps every id', () => {
  const ids = entries.filter((e, i) => i % 9 === 0).map(e => e.id);
  const out = quiz.interleave(ids, index.byId, quiz.mulberry32(5));
  assert.deepEqual([...out].sort((a, b) => a - b), ids);
  let runs = 0;
  for (let i = 1; i < out.length; i++) if (index.byId.get(out[i]).cat === index.byId.get(out[i - 1]).cat) runs++;
  assert.ok(runs < ids.length / 4, 'few neighbours share a category: ' + runs);
});
