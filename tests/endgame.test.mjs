import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers.mjs';

const ev = loadScripts('endgame.js');
const J = v => JSON.stringify(v);
const call = (fn, ...args) => ev(`${fn}(...${J(args)})`);
const EU = 1;
const at = text => call('serverTimeMs', text, EU);

// Cycles du patch note 4.6 tels que lus par le Rust (src-tauri/src/news/parse.rs, test parse_46_two_moc_cycles)
const V46 = {
  version: '4.6', start: '2026-09-28T06:00:00+08:00', end: '2026-11-11T06:00:00+08:00', arbitration: 'Retour aux sources',
  endgame: [
    { mode: 'moc', name: "Traversée de l'au-delà", start: null, end: '2026-11-02T03:59', effect: 'a' },
    { mode: 'as', name: "Domination de l'oubli", start: '2026-10-05T04:00', end: '2026-11-16T03:59', effect: 'b' },
    { mode: 'pf', name: 'Mots imaginaires', start: '2026-10-19T04:00', end: '2026-11-30T03:59', effect: 'c' },
    { mode: 'moc', name: 'Loi du plus fort', start: '2026-11-02T04:00', end: '2026-12-14T03:59', effect: 'd' }
  ]
};
const cycles = (now) => ev(`endgameCycles(${J([V46])}, ${EU})`);
const status = now => ev(`endgameStatus(endgameCycles(${J([V46])}, ${EU}), ${now})`);

test('server_offsets', () => {
  assert.equal(call('serverTimeMs', '2026-11-16T04:00', 1), Date.parse('2026-11-16T03:00Z'));
  assert.equal(call('serverTimeMs', '2026-11-16T04:00', -5), Date.parse('2026-11-16T09:00Z'));
  assert.equal(call('serverTimeMs', '2026-11-16T04:00', 8), Date.parse('2026-11-15T20:00Z'));
  assert.equal(call('serverOfUid', '701234567'), 'europe');
  assert.equal(call('serverOfUid', '601234567'), 'america');
  assert.equal(call('serverOfUid', '801234567'), 'asia');
  assert.equal(call('serverOfUid', '901234567'), 'tw');
  assert.equal(call('serverOfUid', ''), null);
  assert.equal(call('serverOfUid', null), null);
});

test('cycles_from_46', () => {
  const c = cycles();
  assert.deepEqual([c.moc.length, c.pf.length, c.as.length], [2, 1, 1]);
  assert.equal(c.moc[0].startMs, Date.parse('2026-09-28T06:00:00+08:00'));   // début de la version
  assert.equal(c.moc[0].endMs, at('2026-11-02T03:59'));
  assert.equal(c.moc[1].name, 'Loi du plus fort');
  assert.equal(c.as[0].deduced, false);
  // la même version lue deux fois (cache + réseau) ne double pas les cycles
  const twice = ev(`endgameCycles(${J([V46, V46])}, ${EU})`);
  assert.equal(twice.moc.length, 2);
});

test('status_switches_at_reset', () => {
  const before = status(at('2026-11-16T03:59'));
  assert.equal(before.as.current.name, "Domination de l'oubli");
  assert.equal(before.as.next.deduced, true);
  assert.equal(before.as.next.startMs, at('2026-11-16T04:00'));
  const after = status(at('2026-11-16T04:00'));
  assert.equal(after.as.current.deduced, true);
  assert.equal(after.as.current.startMs, at('2026-11-16T04:00'));
  assert.equal(after.as.current.endMs, at('2026-12-28T03:59'));   // 6 semaines
  assert.equal(after.as.next.startMs, at('2026-12-28T04:00'));
});

test('next_reset_is_earliest', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const n = ev(`nextEndgameReset(endgameStatus(endgameCycles(${J([V46])}, ${EU}), ${now}))`);
  assert.equal(n.mode, 'as');
  assert.equal(n.cycle.startMs, at('2026-11-16T04:00'));
  assert.equal(n.cycle.deduced, true);
  // un cycle officiel à venir passe avant la déduction
  const s = status(at('2026-10-30T12:00'));
  assert.equal(s.moc.next.name, 'Loi du plus fort');
  assert.equal(s.moc.next.deduced, false);
});

test('deduced_chain_beyond_patch_notes', () => {
  const from = Date.parse('2026-11-07T12:00:00Z'), to = Date.parse('2027-01-07T12:00:00Z');
  const resets = ev(`endgameResetsBetween(endgameCycles(${J([V46])}, ${EU}), ${from}, ${to})`);
  assert.deepEqual(resets.map(r => [r.mode, r.startMs]), [
    ['as', at('2026-11-16T04:00')], ['pf', at('2026-11-30T04:00')], ['moc', at('2026-12-14T04:00')], ['as', at('2026-12-28T04:00')]
  ]);
  const j = ev(`endgameJadesBetween(endgameCycles(${J([V46])}, ${EU}), ${from}, ${to}, { moc: 900, pf: 800, as: 0 })`);
  assert.deepEqual(j, { jades: 1700, count: 4 });
});

test('empty_inputs', () => {
  const c = ev(`endgameCycles([], 1)`);
  assert.deepEqual(c, { moc: [], pf: [], as: [] });
  const s = ev(`endgameStatus(endgameCycles([], 1), 0)`);
  assert.deepEqual(s.moc, { current: null, next: null });
  assert.equal(ev(`nextEndgameReset(endgameStatus(endgameCycles([], 1), 0))`), null);
  assert.deepEqual(ev(`endgameJadesBetween(endgameCycles([], 1), 0, 1e13, { moc: 800, pf: 800, as: 800 })`), { jades: 0, count: 0 });
  // versions sans le champ endgame (ancien fil en cache)
  assert.deepEqual(ev(`endgameCycles([{ version: '4.5' }], 1)`), { moc: [], pf: [], as: [] });
});
