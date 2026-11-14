import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers.mjs';

const ev = loadScripts('data.js', 'gamechars.js', 'relics.js');

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

/* ---------- Équipement conseillé (relicLoadout) ---------- */
const LO_OPTS = `{ element: 'lightning', profileMain: ${JSON.stringify(PROFILE_MAIN)}, value: r => r.q, grade: r => r.q >= 0.55 ? 'A' : r.q >= 0.4 ? 'B' : r.q >= 0.25 ? 'C' : 'D' }`;
const loadout = (relics, advice = ADVICE) => ev(`relicLoadout(${JSON.stringify(advice)}, ${JSON.stringify(relics)}, 'acheron', ${LO_OPTS})`);
const CAV = ['head', 'hands', 'body', 'feet'];
const cav = (set, q, owner = 'acheron', level = 15) => CAV.map(s => R(s, set, MAINS[s], q, owner, level));
const planar = (q, owner = 'acheron') => ['sphere', 'rope'].map(s => R(s, IZU, MAINS[s], q, owner));

test('loadout_picks_best_full_set', () => {
  const lo = loadout([...cav(PIO, 0.5, null), ...cav(SCH, 0.7), ...planar(0.6)]);
  assert.deepEqual(lo.combo.cavern, [{ name: SCH, pieces: 4 }]);
  assert.equal(lo.combo.rank, 2);
  assert.equal(lo.combo.planar, IZU);
  for (const s of CAV) assert.equal(lo.slots[s].state, 'keep');
  assert.deepEqual(lo.counts, { swap: 0, farm: 0 });
});

test('loadout_swaps_free_better_piece', () => {
  const free = R('hands', PIO, 'atk', 0.8, null);
  const lo = loadout([...cav(PIO, 0.6), ...planar(0.6), free]);
  assert.equal(lo.slots.hands.state, 'swap');
  assert.equal(lo.slots.hands.pick.id, free.id);
  assert.equal(lo.slots.hands.worn.owner, 'acheron');
  assert.equal(lo.counts.swap, 1);
});

test('loadout_ignores_other_owners', () => {
  const other = R('hands', PIO, 'atk', 0.95, 'other');
  const lo = loadout([...cav(PIO, 0.6), ...planar(0.6), other]);
  assert.notEqual(lo.slots.hands.pick.id, other.id);
  assert.equal(lo.slots.hands.state, 'keep');
});

test('loadout_never_picks_unleveled_free_piece', () => {
  const young = R('body', PIO, 'cr', 0.9, null, 0);
  const lo = loadout([...cav(PIO, 0.45), ...planar(0.6), young]);
  assert.equal(lo.slots.body.pick.owner, 'acheron');
  assert.equal(lo.slots.body.state, 'keep');
});

test('loadout_keeps_worn_when_nothing_better', () => {
  const kit6 = [...cav(PIO, 0.6), ...planar(0.6)];
  kit6[2] = R('body', PIO, 'cr', 0.1);   // corps porté, note D
  const lo = loadout(kit6);
  assert.equal(lo.slots.body.state, 'farm');
  assert.equal(lo.slots.body.pick.id, kit6[2].id);
  assert.deepEqual(lo.slots.body.farm, { set: PIO, mains: ['cr', 'cd'] });
  assert.equal(lo.counts.farm, 1);
});

test('loadout_swap_and_farm', () => {
  const kit6 = [...cav(PIO, 0.6), ...planar(0.6)];
  kit6[3] = R('feet', PIO, 'atk_pct', 0.1);
  const free = R('feet', PIO, 'atk_pct', 0.3, null);   // meilleure, mais note C
  const lo = loadout([...kit6, free]);
  assert.equal(lo.slots.feet.state, 'swap_farm');
  assert.equal(lo.slots.feet.pick.id, free.id);
  assert.deepEqual(lo.counts, { swap: 1, farm: 1 });
});

test('loadout_flex_pair', () => {
  const pieces = [R('head', MUS, 'hp', 0.6, null), R('hands', MUS, 'atk', 0.6, null),
    R('body', PIO, 'cr', 0.6, null), R('feet', PIO, 'atk_pct', 0.6, null), ...planar(0.6, null)];
  const lo = loadout(pieces);
  assert.deepEqual(lo.combo.cavern.map(p => p.name + ':' + p.pieces).sort(), [MUS + ':2', PIO + ':2'].sort());
  assert.equal(lo.combo.rank, null);
  for (const s of CAV) assert.ok(lo.slots[s].pick, s);
});

test('loadout_planar_same_set', () => {
  const lo = loadout([...cav(PIO, 0.6), R('sphere', IZU, 'dmg_lightning', 0.6), R('rope', 'Inert Salsotto', 'atk_pct', 0.9)]);
  assert.equal(lo.combo.planar, IZU);
  assert.equal(lo.slots.rope.state, 'farm');
  assert.equal(lo.slots.rope.farm.set, IZU);
});

test('loadout_empty_inventory', () => {
  const lo = loadout([]);
  for (const s of ['head', 'hands', 'body', 'feet', 'sphere', 'rope']) {
    assert.equal(lo.slots[s].state, 'farm', s);
    assert.equal(lo.slots[s].pick, null);
  }
  assert.equal(lo.counts.farm, 6);
});

test('loadout_without_prydwen', () => {
  const mixed = [R('head', MUS, 'hp', 0.7), R('hands', SCH, 'atk', 0.7), R('body', PIO, 'cr', 0.7), R('feet', PIO, 'spd', 0.7),
    R('sphere', IZU, 'dmg_lightning', 0.7), R('rope', 'Inert Salsotto', 'atk_pct', 0.7), R('feet', MUS, 'spd', 0.9, null)];
  const lo = loadout(mixed, null);
  assert.equal(lo.combo.rank, null);
  assert.equal(lo.slots.feet.state, 'swap');
  assert.equal(lo.slots.rope.state, 'keep');
  const weak = loadout([R('body', PIO, 'cr', 0.1)], null);
  assert.deepEqual(weak.slots.body.farm, { set: null, mains: ['cr', 'cd'] });
});

test('loadout_tie_prefers_rank', () => {
  const lo = loadout([...cav(PIO, 0.6, null), ...cav(SCH, 0.6, null), ...planar(0.6)]);
  assert.equal(lo.combo.rank, 1);
  assert.deepEqual(lo.combo.cavern, [{ name: PIO, pieces: 4 }]);
});

/* ---------- Pièces à monter (upgradeChance, upgradeCandidates) ---------- */
// valeur de test : rolls utiles pour un perso critique (Taux CRIT et DGT CRIT, poids 1)
const CRIT_VALUE = `r => r.subs.reduce((s, x) => s + (['cr', 'cd'].includes(x.stat) ? x.val / SUBSTATS[x.stat].roll[2] : 0), 0)`;
const chance = (relic, rival, seed = 7) => ev(`upgradeChance(${JSON.stringify(relic)}, ${rival}, ${CRIT_VALUE}, seededRng(${seed}))`);
const young = { id: 'y', slot: 'body', set: PIO, main: 'atk_pct', level: 0, owner: null,
  subs: [{ stat: 'cr', val: 2.592 }, { stat: 'cd', val: 5.184 }, { stat: 'spd', val: 2 }] };

test('upgrade_chance_maxed_piece', () => {
  const done = { ...young, level: 15 };
  assert.equal(chance(done, 1), 1);    // 0,8 + 0,8 = 1,6 > 1
  assert.equal(chance(done, 2), 0);
});

test('upgrade_chance_is_deterministic', () => {
  const a = chance(young, 3), b = chance(young, 3);
  assert.equal(a, b);
  assert.ok(a > 0 && a < 1, String(a));
});

test('upgrade_chance_good_start_beats_weak_rival', () => {
  assert.ok(chance(young, 1) > 0.9);
  assert.ok(chance(young, 9) < 0.05);
});

test('upgrade_three_subs_adds_fourth', () => {
  const counts = ev(`(() => { const seen = new Set(); upgradeChance(${JSON.stringify(young)}, 0, r => { seen.add(r.subs.length + ':' + r.level); return 1; }, seededRng(3), 200); return [...seen]; })()`);
  assert.deepEqual(counts, ['4:15']);
});

test('upgrade_candidates_filters', () => {
  const pick = { id: 'p', slot: 'hands', set: PIO, main: 'atk', level: 15, owner: 'acheron', v: 5, subs: [] };
  const lo = { slots: {
    head: { pick: null, target: { set: PIO, mains: [] } },
    hands: { pick, target: { set: PIO, mains: [] } },
    body: { pick: null, target: { set: PIO, mains: ['cr', 'cd'] } },
    feet: { pick: null, target: { set: PIO, mains: ['atk_pct', 'spd'] } },
    sphere: { pick: null, target: { set: IZU, mains: ['atk_pct'] } },
    rope: { pick: null, target: { set: IZU, mains: ['atk_pct'] } } } };
  const C = (id, slot, set, main, v, extra = {}) => ({ id, slot, set, main, level: 3, owner: null, v, subs: [], ...extra });
  const relics = [
    C('ok-hands', 'hands', PIO, 'atk', 9), C('ok-hands-2', 'hands', PIO, 'atk', 8),   // 2 pour le même emplacement : 1 gardée
    C('bad-set', 'head', MUS, 'hp', 9), C('bad-main', 'body', PIO, 'def_pct', 9),
    C('too-low', 'feet', PIO, 'spd', 4),                                              // ne bat pas le seuil
    C('maxed', 'head', PIO, 'hp', 9, { level: 15 }), C('other-owner', 'head', PIO, 'hp', 9, { owner: 'x' }),
    C('ok-head', 'head', PIO, 'hp', 9), C('ok-body', 'body', PIO, 'cr', 9), C('ok-rope', 'rope', IZU, 'atk_pct', 9)];
  const out = ev(`upgradeCandidates(${JSON.stringify(lo)}, ${JSON.stringify(relics)}, 'acheron',
    { value: r => r.v, valueOf: r => r.v, correctValue: () => 6, rng: seededRng(1) })`);
  assert.equal(out.length, 3);
  const ids = out.map(x => x.relic.id);
  assert.ok(!ids.some(id => ['bad-set', 'bad-main', 'too-low', 'maxed', 'other-owner', 'ok-hands-2'].includes(id)), ids.join());
  assert.ok(out.every(x => x.chance === 1));
  const hands = out.find(x => x.slot === 'hands');
  if (hands) assert.equal(hands.rival.id, 'p');
});

test('upgrade_steps_count_partial_levels', () => {
  // un palier à +15 reste à une pièce +13 : elle n'est pas « terminée »
  const seen = lvl => ev(`(() => { let k = 0; upgradeChance({ ...${JSON.stringify(young)}, level: ${lvl} }, 0, r => { k = Math.max(k, r.subs.reduce((s, x) => s + x.val, 0)); return 1; }, seededRng(2), 50); return k; })()`);
  const base = young.subs.reduce((s, x) => s + x.val, 0);
  assert.ok(seen(13) > base, 'une +13 doit encore gagner un palier');
  assert.equal(ev(`upgradeChance({ ...${JSON.stringify(young)}, level: 13 }, 999, ${CRIT_VALUE}, seededRng(2))`), 0);
  // +1 : 5 paliers (4e sous-stat + 4 améliorations), comme +0
  const steps = lvl => ev(`(() => { let n = 0; upgradeChance({ ...${JSON.stringify(young)}, level: ${lvl} }, 0, r => { n = r.subs.length; return 1; }, seededRng(2), 1); return n; })()`);
  assert.equal(steps(1), 4);
});

test('relic_correct_value_is_grade_b_at_15', () => {
  assert.equal(ev('RELIC_CORRECT_AT_15'), 0.4 * 9);
});

test('upgrade_candidates_reuse_cache', () => {
  const lo = { slots: { head: { pick: null, target: { set: PIO, mains: [] } } } };
  const relics = [{ id: 'c1', slot: 'head', set: PIO, main: 'hp', level: 3, owner: null, v: 9, subs: [] }];
  const calls = ev(`(() => { let n = 0; const cache = new Map();
    const opts = { value: r => r.v, valueOf: r => { n++; return r.v; }, correctValue: () => 6, rng: seededRng(1), cache };
    upgradeCandidates(${JSON.stringify(lo)}, ${JSON.stringify(relics)}, 'acheron', opts); const first = n;
    upgradeCandidates(${JSON.stringify(lo)}, ${JSON.stringify(relics)}, 'acheron', opts); return [first, n]; })()`);
  assert.ok(calls[0] > 0);
  assert.equal(calls[1], calls[0]);
});

test('upgrade_candidates_keep_tracked_pieces', () => {
  // une pièce suivie en direct reste affichée sous le seuil, à +15, et en plus des 3 premières
  const lo = { slots: { head: { pick: null, target: { set: PIO, mains: [] } }, hands: { pick: null, target: { set: PIO, mains: [] } },
    body: { pick: null, target: { set: PIO, mains: [] } }, feet: { pick: null, target: { set: PIO, mains: [] } } } };
  const C = (id, slot, v, level = 3) => ({ id, slot, set: PIO, main: 'x', level, owner: null, v, subs: [] });
  const relics = [C('a', 'head', 9), C('b', 'hands', 9), C('c', 'body', 9), C('weak', 'feet', 1), C('done', 'head', 1, 15)];
  const run = keep => ev(`upgradeCandidates(${JSON.stringify(lo)}, ${JSON.stringify(relics)}, 'acheron',
    { value: r => r.v, valueOf: r => r.v, correctValue: () => 6, rng: seededRng(1), keep: new Set(${JSON.stringify(keep)}) })`).map(x => x.relic.id).sort();
  assert.deepEqual(run([]), ['a', 'b', 'c']);
  assert.deepEqual(run(['weak', 'done']), ['a', 'b', 'c', 'done', 'weak']);
});

test('tracked_piece_that_became_the_pick_counts_as_won', () => {
  const done = { id: 'd', slot: 'head', set: PIO, main: 'hp', level: 15, owner: null, v: 9, subs: [] };
  const lo = { slots: { head: { pick: done, target: { set: PIO, mains: [] } } } };
  const out = ev(`upgradeCandidates(${JSON.stringify(lo)}, ${JSON.stringify([done])}, 'acheron',
    { value: r => r.v, valueOf: r => r.v, correctValue: () => 6, rng: seededRng(1), keep: new Set(['d']) })`);
  assert.equal(out.length, 1);
  assert.equal(out[0].chance, 1);
});

test('loadout_two_piece_entry_without_flex_still_gives_a_combo', () => {
  const advice = { ...ADVICE, sets: [[{ name: SCH, pieces: 2 }]], flex: [] };
  const lo = loadout([...cav(SCH, 0.6), ...planar(0.6)], advice);
  assert.deepEqual(lo.combo.cavern, [{ name: SCH, pieces: 2 }]);
  assert.equal(lo.combo.rank, 1);
});

test('loadout_worn_low_level_piece_is_not_kept_as_good', () => {
  // portée à +3 : bonne note par amélioration (ratio), mais valeur absolue faible → à farmer, pas « garder »
  const kit6 = [...cav(PIO, 0.6), ...planar(0.6)];
  kit6[0] = R('head', PIO, 'hp', 0.6, 'acheron', 3);
  const lo = ev(`relicLoadout(${JSON.stringify(ADVICE)}, ${JSON.stringify(kit6)}, 'acheron',
    { element: 'lightning', profileMain: ${JSON.stringify(PROFILE_MAIN)}, value: r => r.level === 15 ? 5 : 1, grade: () => 'A' })`);
  assert.equal(lo.slots.head.state, 'farm');
  assert.equal(lo.slots.body.state, 'keep');
});

/* ---------- Aléas et reliques (Relic Recon) ---------- */
const gchance = (main, rival, relevant = ['cr', 'cd'], seed = 1) =>
  ev(`guaranteedChance('${main}', ${rival}, ${CRIT_VALUE}, ${JSON.stringify(relevant)}, seededRng(${seed}))`);

test('guaranteed_chance_bounds', () => {
  assert.equal(gchance('atk_pct', -1), 1);      // toute pièce bat une valeur négative
  assert.equal(gchance('atk_pct', 100), 0);     // 9 rolls au plus : impossible
});
test('guaranteed_chance_has_two_relevant_subs', () => {
  // Taux CRIT et DGT CRIT toujours présents : au moins 2 rolls minimaux (2 × 0,8)
  const min = ev(`(() => { let lo = 99; guaranteedChance('atk_pct', 0, r => { const v = (${CRIT_VALUE})(r); lo = Math.min(lo, v); return v; }, ['cr', 'cd'], seededRng(2), 500); return lo; })()`);
  assert.ok(min >= 1.6 - 1e-9);
});
test('guaranteed_chance_four_subs_nine_rolls', () => {
  const shapes = ev(`(() => { const s = new Set(); guaranteedChance('atk_pct', 0, r => { s.add(r.subs.length + ':' + r.level); return 0; }, ['cr', 'cd'], seededRng(3), 200); return [...s]; })()`);
  assert.deepEqual(shapes, ['4:15']);
});
test('guaranteed_chance_excludes_main_and_is_deterministic', () => {
  const hit = ev(`(() => { let hit = false; guaranteedChance('cr', 0, r => { if (r.subs.some(x => x.stat === 'cr')) hit = true; return 0; }, ['cd', 'spd'], seededRng(4), 300); return hit; })()`);
  assert.equal(hit, false);
  assert.equal(gchance('atk_pct', 3), gchance('atk_pct', 3));
});
test('relic_event_active_until_end', () => {
  assert.equal(ev(`relicEventActive(new Date('2026-12-22T20:00:00'))`), true);
  assert.equal(ev(`relicEventActive(new Date('2026-12-23T00:00:01'))`), false);
});
