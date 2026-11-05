import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers.mjs';

const ev = loadScripts('data.js', 'assets.js', 'gamechars.js');
const AEON = { id: '9001', key: 'aeon|quantum', en: 'Aeon', fr: 'Aiôn', element: 'quantum', path: 'elation', rarity: 5 };

test('adds_missing_game_char', () => {
  const out = ev(`mergeGameChars(CHARACTERS, GAME.chars.concat([${JSON.stringify(AEON)}]), DEFAULT_PROFILE_BY_PATH)`);
  const n = ev('CHARACTERS.length');
  assert.equal(out.length, n + 1);
  const aeon = out.find(c => c.id === 'aeon');
  assert.ok(aeon);
  assert.equal(aeon.name, 'Aeon');
  assert.equal(aeon.fr, 'Aiôn');
  assert.equal(aeon.profile, 'crit_atk');
  assert.equal(aeon.rarity, 5);
  assert.deepEqual(out.slice(0, n).map(c => c.id), ev('CHARACTERS.map(c => c.id)'));
});

test('nothing_added_when_lists_match', () => {
  assert.equal(ev('mergeGameChars(CHARACTERS, GAME.chars, DEFAULT_PROFILE_BY_PATH).length'), ev('CHARACTERS.length'));
});

test('no_double_trailblazer', () => {
  const tb = ev(`mergeGameChars(CHARACTERS, GAME.chars, DEFAULT_PROFILE_BY_PATH).filter(c => /Trailblazer/.test(c.name)).length`);
  assert.equal(tb, ev('CHARACTERS.filter(c => /Trailblazer/.test(c.name)).length'));
});

test('merge_moves_owned_and_plans', () => {
  const r = ev(`(() => {
    const chars = mergeGameChars(CHARACTERS, GAME.chars.concat([${JSON.stringify(AEON)}]), DEFAULT_PROFILE_BY_PATH);
    const state = {
      custom: [{ id: 'custom-x', name: 'Aiôn', rarity: 5, element: 'quantum', path: 'elation', custom: true }],
      owned: { 'custom-x': { e: 1, lvl: 60 } },
      plans: [{ id: 'p1', charId: 'custom-x' }],
      myTeams: [{ id: 't1', members: ['custom-x', null, null, null] }],
      teams: { moc: [['custom-x', null, null, null], [null, null, null, null]] }
    };
    const dups = findCustomDuplicates(state.custom, chars);
    for (const d of dups) mergeCustomInto(state, d.customId, d.officialId);
    return { dups, state };
  })()`);
  assert.deepEqual(r.dups, [{ customId: 'custom-x', officialId: 'aeon' }]);
  assert.deepEqual(r.state.owned, { aeon: { e: 1, lvl: 60 } });
  assert.equal(r.state.plans[0].charId, 'aeon');
  assert.equal(r.state.myTeams[0].members[0], 'aeon');
  assert.equal(r.state.teams.moc[0][0], 'aeon');
  assert.deepEqual(r.state.custom, []);
});

test('merge_keeps_existing_official_owned', () => {
  const owned = ev(`(() => {
    const state = { custom: [], owned: { 'custom-x': { e: 1 }, aeon: { e: 3 } }, plans: [], myTeams: [], teams: {} };
    mergeCustomInto(state, 'custom-x', 'aeon');
    return state.owned;
  })()`);
  assert.deepEqual(owned, { aeon: { e: 3 } });
});

test('no_duplicate_when_element_differs', () => {
  const dups = ev(`findCustomDuplicates(
    [{ id: 'custom-y', name: 'Aiôn', element: 'fire', path: 'elation' }],
    mergeGameChars(CHARACTERS, GAME.chars.concat([${JSON.stringify(AEON)}]), DEFAULT_PROFILE_BY_PATH))`);
  assert.deepEqual(dups, []);
});
