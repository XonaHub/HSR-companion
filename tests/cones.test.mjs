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
