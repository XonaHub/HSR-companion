import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers.mjs';

const ev = loadScripts('gamechars.js', 'relics.js');

// conseils d'Acheron tels que lus sur Prydwen (src-tauri/src/prydwen/parse.rs)
const ADVICE = {
  sets: [
    [{ name: 'Pioneer Diver of Dead Waters', pieces: 4 }],
    [{ name: 'Scholar Lost in Erudition', pieces: 4 }],
    [{ name: 'Band of Sizzling Thunder', pieces: 4 }],
    [{ name: 'Scholar Lost in Erudition', pieces: 2 }]
  ],
  flex: ['Pioneer Diver of Dead Waters', 'Musketeer of Wild Wheat', 'Prisoner in Deep Confinement', 'The Wind-Soaring Valorous', 'Band of Sizzling Thunder'],
  planars: ['Izumo Gensei and Takama Divine Realm', 'Inert Salsotto'],
  main: { body: ['cr', 'cd'], feet: ['atk_pct', 'spd'], sphere: ['atk_pct', 'dmg_lightning'], rope: ['atk_pct'] }
};
const PROFILE_MAIN = { body: ['cr', 'cd'], feet: ['spd', 'atk_pct'], sphere: ['elem', 'atk_pct'], rope: ['atk_pct', 'err'] };
const PIO = 'Pioneer Diver of Dead Waters', SCH = 'Scholar Lost in Erudition', MUS = 'Musketeer of Wild Wheat', IZU = 'Izumo Gensei and Takama Divine Realm';

let n = 0;
const R = (slot, set, main, q, owner = 'acheron', level = 15) => ({ id: 'r' + (++n), slot, set, main, owner, q, level });
const MAINS = { head: 'hp', hands: 'atk', body: 'cr', feet: 'atk_pct', sphere: 'dmg_lightning', rope: 'atk_pct' };
/** 6 pièces bien montées ; `over` remplace des pièces par emplacement */
function kit(over = {}) {
  return ['head', 'hands', 'body', 'feet', 'sphere', 'rope'].map(s => over[s] !== undefined ? over[s]
    : R(s, ['sphere', 'rope'].includes(s) ? IZU : PIO, MAINS[s], 0.6)).filter(Boolean);
}
const OPTS = `{ element: 'lightning', profileMain: ${JSON.stringify(PROFILE_MAIN)}, score: r => r.q, grade: r => r.q >= 0.55 ? 'A' : r.q >= 0.4 ? 'B' : r.q >= 0.25 ? 'C' : 'D' }`;
const review = (relics, advice = ADVICE) => ev(`relicReview(${JSON.stringify(advice)}, ${JSON.stringify(relics)}, 'acheron', ${OPTS})`);

test('main_stat_rules', () => {
  assert.equal(ev(`relicMainOk('head', 'hp', ['cr'], 'ice')`), true);
  assert.equal(ev(`relicMainOk('body', 'cd', ['cr', 'cd'], 'ice')`), true);
  assert.equal(ev(`relicMainOk('body', 'atk_pct', ['cr', 'cd'], 'ice')`), false);
  assert.equal(ev(`relicMainOk('sphere', 'dmg_ice', ['elem'], 'ice')`), true);
  assert.equal(ev(`relicMainOk('sphere', 'dmg_fire', ['elem'], 'ice')`), false);
  assert.equal(ev(`relicMainOk('rope', 'be', null, 'ice')`), true);
});

test('recommended_4pc_and_planar', () => {
  const r = review(kit());
  assert.deepEqual([r.cavern.kind, r.cavern.rank], ['rec', 1]);
  assert.deepEqual([r.planar.kind, r.planar.rank], ['rec', 1]);
  assert.ok(r.mains.every(m => m.ok));
  assert.equal(r.priority.length, 0);
  assert.equal(r.source, 'prydwen');
});

test('second_entry_has_rank_2', () => {
  const r = review(kit({ head: R('head', SCH, 'hp', 0.6), hands: R('hands', SCH, 'atk', 0.6), body: R('body', SCH, 'cr', 0.6), feet: R('feet', SCH, 'atk_pct', 0.6) }));
  assert.deepEqual([r.cavern.kind, r.cavern.rank], ['rec', 2]);
});

test('two_plus_two_from_flex_list', () => {
  const r = review(kit({ head: R('head', MUS, 'hp', 0.6), hands: R('hands', MUS, 'atk', 0.6) }));
  assert.equal(r.cavern.kind, 'mix');
  assert.deepEqual(r.cavern.target.sort(), [MUS, PIO].sort());
  assert.equal(r.priority.length, 0);
});

test('scholar_2pc_plus_flex_entry', () => {
  // 2 Scholar + 2 Musketeer : entrée « Scholar 2 pièces + Flex » (rang 4) et pas un simple 2 + 2
  const r = review(kit({ head: R('head', SCH, 'hp', 0.6), hands: R('hands', SCH, 'atk', 0.6), body: R('body', MUS, 'cr', 0.6), feet: R('feet', MUS, 'atk_pct', 0.6) }));
  assert.deepEqual([r.cavern.kind, r.cavern.rank], ['rec', 4]);
  // 2 Scholar + 2 pièces dépareillées : pas conseillé
  const off = review(kit({ head: R('head', SCH, 'hp', 0.6), hands: R('hands', SCH, 'atk', 0.6), body: R('body', MUS, 'cr', 0.6) }));
  assert.equal(off.cavern.kind, 'off');
});

test('incomplete_set_and_empty_slot', () => {
  const r = review(kit({ feet: null }));
  assert.equal(r.slots.feet, null);
  assert.equal(r.cavern.kind, 'missing');
  assert.equal(r.mains.find(m => m.slot === 'feet').ok, null);
  const off = review(kit({ head: R('head', MUS, 'hp', 0.6) }));
  assert.equal(off.cavern.kind, 'off');
  assert.deepEqual(off.cavern.target, [PIO]);
});

test('planar_mismatch_is_off', () => {
  const r = review(kit({ rope: R('rope', 'Inert Salsotto', 'atk_pct', 0.6) }));
  assert.equal(r.planar.kind, 'off');
  assert.deepEqual(r.priority.map(p => [p.relic.slot, p.set]), [['rope', true]]);
});

test('priority_order_main_then_set_then_grade', () => {
  const badMain = R('body', PIO, 'atk_pct', 0.7);
  const breaker = R('head', MUS, 'hp', 0.6);
  const low = R('hands', PIO, 'atk', 0.1);
  const mid = R('feet', PIO, 'atk_pct', 0.3);
  const r = review(kit({ body: badMain, head: breaker, hands: low, feet: mid }));
  assert.deepEqual(r.priority.map(p => p.relic.id), [badMain.id, breaker.id, low.id]);
  assert.deepEqual([r.priority[0].main, r.priority[1].set, r.priority[2].low], [true, true, true]);
  assert.equal(r.mains.find(m => m.slot === 'body').best, 'cr');
});

test('better_piece_prefers_free_then_best_score_and_never_itself', () => {
  const low = R('hands', PIO, 'atk', 0.1);
  const carried = R('hands', PIO, 'atk', 0.9, 'pela');
  const free = R('hands', PIO, 'atk', 0.5, null);
  const otherSet = R('hands', MUS, 'atk', 0.95, null);
  const r = review(kit({ hands: low }).concat([carried, free, otherSet]));
  assert.equal(r.priority[0].better.id, free.id);
  // sans pièce libre : la pièce portée par un autre perso
  const r2 = review(kit({ hands: low }).concat([carried]));
  assert.equal(r2.priority[0].better.id, carried.id);
  assert.equal(r2.priority[0].better.owner, 'pela');
  // rien de mieux : pas de suggestion
  assert.equal(review(kit({ hands: low })).priority[0].better, null);
});

test('better_piece_for_set_breaker_comes_from_target_set', () => {
  const breaker = R('head', MUS, 'hp', 0.6);
  const pioHead = R('head', PIO, 'hp', 0.7, null);
  const musHead = R('head', MUS, 'hp', 0.9, null);
  const r = review(kit({ head: breaker }).concat([pioHead, musHead]));
  assert.equal(r.priority[0].better.id, pioHead.id);
});

test('better_piece_must_have_a_good_main_stat', () => {
  const badMain = R('body', PIO, 'atk_pct', 0.7);
  const alsoBad = R('body', PIO, 'def_pct', 0.9, null);
  const good = R('body', PIO, 'cd', 0.4, null);
  const r = review(kit({ body: badMain }).concat([alsoBad, good]));
  // une pièce conforme moins bien notée ne remplace pas : seules les pièces mieux notées comptent
  assert.equal(r.priority[0].better, null);
  const good2 = R('body', PIO, 'cd', 0.8, null);
  assert.equal(review(kit({ body: badMain }).concat([alsoBad, good2])).priority[0].better.id, good2.id);
});

test('better_piece_is_at_least_as_levelled', () => {
  // cas réel (Evanescia) : une corde +0 notée C ne remplace pas une corde +15 notée D
  const low = R('rope', IZU, 'atk_pct', 0.1);
  const fresh = R('rope', IZU, 'atk_pct', 0.3, null, 0);
  assert.equal(review(kit({ rope: low }).concat([fresh])).priority[0].better, null);
  const done = R('rope', IZU, 'atk_pct', 0.3, null, 15);
  assert.equal(review(kit({ rope: low }).concat([fresh, done])).priority[0].better.id, done.id);
});

test('low_grade_only_needs_a_better_letter', () => {
  // cas réel : une sphère D proposée pour remplacer une sphère D
  const low = R('sphere', IZU, 'dmg_lightning', 0.1);
  const sameLetter = R('sphere', IZU, 'atk_pct', 0.2, null);
  assert.equal(review(kit({ sphere: low }).concat([sameLetter])).priority[0].better, null);
  const cLetter = R('sphere', IZU, 'atk_pct', 0.3, null);
  assert.equal(review(kit({ sphere: low }).concat([sameLetter, cLetter])).priority[0].better.id, cLetter.id);
  // stat principale fausse : une pièce conforme mieux notée suffit, même de la même lettre
  const badMain = R('body', PIO, 'atk_pct', 0.1);
  const fix = R('body', PIO, 'cr', 0.2, null);
  assert.equal(review(kit({ body: badMain }).concat([fix])).priority[0].better.id, fix.id);
});

test('fallback_to_profile_without_advice', () => {
  const r = review(kit({ head: R('head', MUS, 'hp', 0.6), feet: R('feet', PIO, 'def_pct', 0.6) }), null);
  assert.equal(r.source, 'profile');
  assert.equal(r.cavern.kind, 'unknown');
  assert.equal(r.planar.kind, 'unknown');
  assert.equal(r.mains.find(m => m.slot === 'feet').ok, false);
  assert.equal(r.mains.find(m => m.slot === 'sphere').best, 'dmg_lightning');
  // sans conseil, aucun set n'est « cassé »
  assert.deepEqual(r.priority.map(p => [p.relic.slot, p.main, p.set]), [['feet', true, false]]);
});
