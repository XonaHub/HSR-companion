import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers.mjs';

const ev = loadScripts('today.js');
const J = v => JSON.stringify(v);
const NOW = Date.parse('2026-11-06T12:00:00Z');
const call = (fn, ...args) => ev(`${fn}(...${J(args)})`);

const v = (version, start, end, phases = []) => ({ version, name: '', start, end, phases });
const ph = (start, end, items) => ({ start, end, items });
const it = (name, rarity = 5, kind = 'char', rerun = false) => ({ name, rarity, kind, rerun });

test('current_version_like_news_tab', () => {
  const list = [v('3.8', '2026-11-19T02:00:00Z'), v('3.7', '2026-10-08T02:00:00Z', '2026-11-19T02:00:00Z'), v('3.6', '2026-08-27T02:00:00Z', '2026-10-08T02:00:00Z')];
  assert.equal(call('currentVersion', list, NOW).version, '3.7');
  const ended = [v('3.8', '2026-11-19T02:00:00Z'), v('3.7', '2026-10-08T02:00:00Z', '2026-11-01T02:00:00Z')];
  assert.equal(call('currentVersion', ended, NOW).version, '3.7');   // repli : la dernière commencée
  assert.equal(call('currentVersion', [], NOW), null);
});

test('next_version_is_nearest', () => {
  const list = [v('3.9', '2027-01-07T02:00:00Z'), v('3.8', '2026-11-19T02:00:00Z'), v('3.7', '2026-10-08T02:00:00Z', '2026-11-19T02:00:00Z')];
  assert.equal(call('nextVersion', list, NOW).version, '3.8');
  assert.equal(call('nextVersion', [list[2]], NOW), null);
});

test('phase_current_by_dates', () => {
  const x = v('3.7', '2026-10-08T02:00:00Z', '2026-11-19T02:00:00Z', [
    ph('2026-10-10T02:00:00Z', '2026-10-30T15:00:00Z', [it('A')]),
    ph('2026-10-31T02:00:00Z', '2026-11-20T15:00:00Z', [it('B')])
  ]);
  const p = call('currentPhase', x, NOW);
  assert.equal(p.items[0].name, 'B');
  assert.equal(p.end, '2026-11-20T15:00:00Z');
});

test('phase_none_between_phases', () => {
  const x = v('3.7', '2026-10-08T02:00:00Z', '2026-11-19T02:00:00Z', [
    ph('2026-10-10T02:00:00Z', '2026-11-01T15:00:00Z', [it('A')]),
    ph('2026-11-10T02:00:00Z', '2026-11-30T15:00:00Z', [it('B')])
  ]);
  assert.equal(call('currentPhase', x, NOW), null);
});

test('phase_whole_version_without_dates', () => {
  const x = v('3.7', '2026-10-08T02:00:00Z', '2026-11-19T02:00:00Z', [ph(undefined, undefined, [it('A')]), ph(undefined, undefined, [it('B')])]);
  const p = call('currentPhase', x, NOW);
  assert.deepEqual(p.items.map(i => i.name), ['A', 'B']);
  assert.equal(p.end, '2026-11-19T02:00:00Z');
});

test('days_until_never_negative', () => {
  assert.equal(call('daysUntil', '2026-11-12T12:00:00Z', NOW), 6);
  assert.equal(call('daysUntil', '2026-11-01T12:00:00Z', NOW), 0);
  assert.equal(call('daysUntil', '2026-11-06T14:00:00Z', NOW), 1);
  assert.equal(ev(`daysUntil(undefined, ${NOW})`), null);
});

test('latest_news_counts_new_five_stars', () => {
  const x = { ...v('3.8', '2026-11-19T02:00:00Z'), name: 'Nom', phases: [
    ph(undefined, undefined, [it('A'), it('B'), it('C', 5, 'char', true), it('Cône', 5, 'lc'), it('D', 4)]),
    ph(undefined, undefined, [it('A')])
  ] };
  assert.equal(J(call('latestNews', [x])), J({ version: '3.8', name: 'Nom', newFive: 3, announced: true }));
  const empty = call('latestNews', [v('3.9', '2027-01-07T02:00:00Z')]);
  assert.equal(empty.newFive, 0);
  assert.equal(empty.announced, false);
  assert.equal(call('latestNews', []), null);
});

test('pulls_now_ignores_future_income', () => {
  assert.equal(call('pullsNow', { jades: 13650, passes: 4, days: 30, extra: 999 }, 160), 89);
  assert.equal(call('pullsNow', {}, 160), 0);
});

test('top_post_merges_exp_and_breaks_ties', () => {
  const tp = o => ({ expTP: 0, lcExpTP: 0, crTP: 0, pathTP: 0, bossTP: 0, echoTP: 0, ...o });
  assert.equal(J(call('topPost', tp({ expTP: 300, lcExpTP: 200, pathTP: 450 }))), J({ key: 'exp', tp: 500 }));
  assert.equal(call('topPost', tp({ expTP: 100, pathTP: 100 })).key, 'exp');
  assert.equal(call('topPost', tp({ bossTP: 90, echoTP: 120 })).key, 'weekly');
  assert.equal(call('topPost', tp({})), null);
});

test('farm_focus_skips_done_plans', () => {
  assert.equal(call('farmFocus', [{ tp: 0 }, { tp: 120 }, { tp: 40 }]), 1);
  assert.equal(call('farmFocus', [{ tp: 0 }]), -1);
  assert.equal(call('farmFocus', []), -1);
});

test('today_empty_inputs', () => {
  assert.equal(call('currentVersion', [], NOW), null);
  assert.equal(call('nextVersion', [], NOW), null);
  assert.equal(ev(`currentPhase(null, ${NOW})`), null);
  assert.equal(call('currentPhase', v('3.7', '2026-10-08T02:00:00Z'), NOW), null);
  assert.equal(call('latestNews', []), null);
});
