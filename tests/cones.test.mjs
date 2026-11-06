import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers.mjs';

const ev = loadScripts('data.js', 'cones.js');
const LCS = [{ id: '23024', en: 'Along the Passing Shore', fr: 'Le long du rivage', rarity: 5, path: 'Nihility', icon: '', preview: '', asc: [] }];
const charIdOf = `(id => id == 1308 ? 'acheron' : null)`;
const run = list => ev(`importCones(${JSON.stringify(list)}, ${JSON.stringify(LCS)}, ${charIdOf})`);

test('import_maps_fields', () => {
  const r = run([{ _uid: 7, id: 23024, name: 'Along the Passing Shore', level: 80, ascension: 6, superimposition: 2, location: 1308 }]);
  assert.deepEqual(r, [{ uid: '7', id: '23024', name: 'Along the Passing Shore', level: 80, asc: 6, sup: 2, owner: 'acheron' }]);
});

test('import_maps_string_fields_of_real_export', () => {
  // l'export réel donne _uid, id et location sous forme de chaînes
  const r = run([{ _uid: '12', id: '23024', name: 'X', level: 1, ascension: 0, superimposition: 1, location: '1308', lock: false }]);
  assert.equal(r[0].uid, '12'); assert.equal(r[0].owner, 'acheron');
});

test('unequipped_has_null_owner', () => {
  const base = { _uid: 1, id: 23024, name: 'A', level: 1, ascension: 0, superimposition: 1 };
  assert.equal(run([{ ...base, location: 0 }])[0].owner, null);
  assert.equal(run([{ ...base, location: '' }])[0].owner, null);
  assert.equal(run([base])[0].owner, null);
});

test('unknown_cone_kept_with_archive_name', () => {
  const r = run([{ _uid: 2, id: 99999, name: 'Brand New Cone', level: 10, ascension: 1, superimposition: 1, location: 0 }]);
  assert.equal(r.length, 1); assert.equal(r[0].name, 'Brand New Cone'); assert.equal(r[0].id, '99999');
  assert.equal(ev(`coneOf(${JSON.stringify(LCS)}, '99999')`), null);
  assert.equal(ev(`coneOf(${JSON.stringify(LCS)}, 23024)`).id, '23024');
});

// --- coneAdvice ---
const adv = loadScripts('data.js', 'gamechars.js', 'cones.js');
const mkLc = (id, en) => ({ id: String(id), en, fr: en, rarity: 5, path: 'Nihility', icon: '', preview: '', asc: [] });
const LCS2 = [mkLc(1, 'Along the Passing Shore'), mkLc(2, 'Incessant Rain'), mkLc(3, 'Good Night and Sleep Well'), mkLc(4, 'Boundless Choreo'),
  mkLc(5, 'Cone Five'), mkLc(6, 'Cone Six'), mkLc(7, 'Cone Seven')];
const ACHERON = { updated: '01/01/2026', stale: false, cones: [
  { name: 'Along the Passing Shore', rank: 1, score: 125.5, sup: 1 },
  { name: 'Incessant Rain', rank: 2, score: 107.77, sup: 1 },
  { name: 'Good Night and Sleep Well', rank: 3, score: 100, sup: 5 },
  { name: 'Boundless Choreo', rank: 4, score: 95.51, sup: 5 }] };
const own = (uid, id, sup, owner) => ({ uid, id: String(id), name: 'x', level: 80, asc: 6, sup, owner });
const INV = [own('a', 4, 5, 'acheron'), own('b', 3, 3, 'pela')];
const advice = (ranking, cones, lcs = LCS2) =>
  adv(`coneAdvice(${JSON.stringify(ranking)}, ${JSON.stringify(cones)}, ${JSON.stringify(lcs)}, 'acheron')`);

test('splits_mine_and_target', () => {
  const r = advice(ACHERON, INV);
  assert.deepEqual(r.mine.map(e => e.lc.en), ['Good Night and Sleep Well', 'Boundless Choreo']);
  assert.equal(r.mine[0].rank, 3); assert.equal(r.mine[0].owned.owner, 'pela'); assert.equal(r.mine[1].rank, 4);
  assert.deepEqual(r.target.map(e => e.lc.en), ['Along the Passing Shore', 'Incessant Rain']);
  assert.equal(r.target[0].owned, null);
});

test('better_points_to_higher_ranked_owned', () => {
  const r = advice(ACHERON, INV);
  assert.equal(r.equipped.id, '4'); assert.equal(r.better.lc.en, 'Good Night and Sleep Well');
});

test('no_better_when_best_is_equipped', () => {
  const r = advice(ACHERON, [own('a', 4, 5, 'acheron')]);
  assert.equal(r.better, null);
});

test('keeps_top5_only', () => {
  const ranking = { updated: '', stale: false, cones: LCS2.map((l, i) => ({ name: l.en, rank: i + 1, score: null, sup: 1 })) };
  const r = advice(ranking, INV);
  assert.ok(r.mine.length + r.target.length <= 5);
  assert.equal(r.mine.length + r.target.length, 5);
});

test('duplicate_entry_uses_closest_sup', () => {
  const ranking = { updated: '', stale: false, cones: [
    { name: 'Incessant Rain', rank: 1, score: null, sup: 1 },
    { name: 'Boundless Choreo', rank: 2, score: null, sup: 5 },
    { name: 'Boundless Choreo', rank: 6, score: null, sup: 1 }] };
  const r = advice(ranking, [own('c', 4, 3, null)]);
  assert.equal(r.mine.length, 1); assert.equal(r.mine[0].rank, 6); assert.equal(r.mine[0].testedSup, 1);
  assert.deepEqual(r.target.map(e => e.lc.en), ['Incessant Rain']);
});

test('free_copy_preferred', () => {
  const r = advice(ACHERON, [own('b', 3, 3, 'pela'), own('c', 3, 3, null)]);
  assert.equal(r.mine[0].owned.owner, null);
});

test('equipped_outside_ranking_makes_first_owned_better', () => {
  const r = advice(ACHERON, [own('z', 7, 1, 'acheron'), own('b', 3, 3, 'pela')]);
  assert.equal(r.equipped.id, '7'); assert.equal(r.better.lc.en, 'Good Night and Sleep Well');
});

test('sorted_by_displayed_rank_with_ties', () => {
  const ranks = [1, 1, 2, 2, 3, 3];
  const ranking = { updated: '', stale: false, cones: LCS2.slice(0, 6).map((l, i) => ({ name: l.en, rank: ranks[i], score: null, sup: 1 })) };
  const r = advice(ranking, [own('c', 2, 1, null), own('d', 5, 1, null)]);
  assert.equal(r.mine.length + r.target.length, 5);
  for (const list of [r.mine, r.target]) assert.deepEqual(list.map(e => e.rank), list.map(e => e.rank).sort((a, b) => a - b));
  assert.deepEqual(r.mine.map(e => e.rank), [1, 3]);
});
