import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers.mjs';

const ev = loadScripts('data.js', 'farm.js');
const J = v => JSON.stringify(v);

// Perso minimal : ascension i → objet « A<i> », traces Point01 niveau l → « P<l> », traces bonus → « B »
const G_CHAR = {
  asc: [0, 1, 2, 3, 4, 5].map(i => [['2', 1000 * (i + 1)], ['A' + i, i + 1]]),
  tr: { Point01: [2, 3, 4, 5, 6].map(l => [['2', 100 * l], ['P' + l, 1]]) },
  bonus: [['2', 5000], ['B', 2]]
};
const C = { rarity: 5, path: 'hunt' };
// Cône minimal : ascension i → « L<i> »
const G_CONE = { rarity: 5, asc: [0, 1, 2, 3, 4, 5].map(i => [['2', 500 * (i + 1)], ['L' + i, 1]]) };
const plan = (o = {}) => ({ charId: 'x', lvFrom: 1, lvTo: 80, tr: { Point01: [1, 6] }, bonus: true, lc: { on: false, lvTo: 80 }, ...o });
const start = (p, owned) => ev(`planStart(${J(p)}, ${J(owned)})`);
const needs = (p, owned, cone = null, gCone = null, g = G_CHAR) =>
  ev(`planNeeds(${J(p)}, planStart(${J(p)}, ${J(owned)}), ${J(g)}, ${J(cone)}, ${J(gCone)}, ${J(C)})`);
const ids = items => Object.keys(items).filter(id => id !== '2').sort();

test('start_from_owned_state', () => {
  const p = plan({ tr: { Point01: [1, 4] }, bonus: false });
  const owned = { e: 0, lvl: 60, promo: 5, tr: { Point01: 4 } };
  const s = start(p, owned);
  assert.equal(s.lvl, 60); assert.equal(s.promo, 5); assert.equal(s.tr.Point01, 4); assert.equal(s.bonusDone, false);
  const r = needs(p, owned);
  assert.deepEqual(ids(r.items), ['A5']);   // seule l'ascension du palier 70 reste à faire
  assert.equal(r.exp, ev('LEVEL_EXP[80] - LEVEL_EXP[60]'));
  assert.equal(r.done, false);
});

test('start_falls_back_to_plan_without_import', () => {
  const p = plan({ lvFrom: 20, tr: { Point01: [2, 4] }, bonus: false });
  for (const owned of [{ e: 0 }, undefined, null]) {
    const s = start(p, owned);
    assert.equal(s.lvl, 20); assert.equal(s.tr.Point01, 2); assert.equal(s.bonusDone, false);
  }
  // repli : ascensions dues aux paliers lvFrom <= palier < lvTo (20 → 70), traces 3 et 4
  assert.deepEqual(ids(needs(p, { e: 0 }).items), ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'P3', 'P4']);
});

test('fallback_tables_for_custom_character', () => {
  // perso personnalisé sans données exactes : tables génériques de data.js, selon la rareté
  const r = needs(plan({ lvFrom: 70, tr: { Point01: [5, 6] }, bonus: false }), undefined, null, null, null);
  assert.equal(r.gen.boss, ev('ASCENSION[5][5].cost.boss'));
  assert.equal(r.gen.p3, ev('BASIC_COST[6].p3'));
});

test('plan_done_when_owned_reaches_target', () => {
  const p = plan();
  const owned = { e: 0, lvl: 80, promo: 6, tr: { Point01: 6 }, bonusAll: true };
  const r = needs(p, owned);
  assert.equal(r.done, true); assert.deepEqual(r.items, {}); assert.equal(r.exp, 0);
  // un plan terminé ne consomme rien : le plan suivant reçoit tout le stock
  const other = { exp: 0, lcExp: 0, items: { A0: 5 } };
  const m = ev(`allocate(${J([r, other])}, ${J({ A0: 5 })}, [])`);
  assert.deepEqual(m[0].missing.items, {}); assert.deepEqual(m[1].missing.items, {});
});

test('cone_included_only_when_on', () => {
  const p = plan({ bonus: false, tr: { Point01: [6, 6] }, lc: { on: true, lvTo: 80 } });
  const owned = { lvl: 80, promo: 6, tr: { Point01: 6 } };
  const cone = { uid: '1', id: '23024', level: 1, asc: 0, sup: 1, owner: 'x' };
  const on = needs(p, owned, cone, G_CONE);
  assert.deepEqual(ids(on.items), ['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
  assert.equal(on.lcExp, ev('LC_LEVEL_EXP[5][80]'));
  assert.ok(on.items['2'] > 0); assert.equal(on.done, false);
  const off = needs({ ...p, lc: { on: false, lvTo: 80 } }, owned, cone, G_CONE);
  assert.deepEqual(off.items, {}); assert.equal(off.lcExp, 0); assert.equal(off.done, true);
  // cône déjà au niveau visé : rien
  const maxed = needs(p, owned, { ...cone, level: 80, asc: 6 }, G_CONE);
  assert.equal(maxed.lcExp, 0); assert.equal(maxed.done, true);
  // sans cône équipé (ou cône inconnu des données du jeu) : rien
  assert.equal(needs(p, owned, null, null).done, true);
  assert.equal(needs(p, owned, cone, null).done, true);
});

test('second_plan_gets_leftover_after_first', () => {
  const n = { exp: 0, lcExp: 0, items: { X: 50 } };
  const m = ev(`allocate(${J([n, n])}, ${J({ X: 70 })}, [])`);
  assert.equal(m[0].missing.items.X || 0, 0);
  assert.equal(m[1].missing.items.X, 30);
});

test('synthesis_covers_higher_tier', () => {
  const fam = [['T1', 'T2', 'T3']];
  const need = { exp: 0, lcExp: 0, items: { T3: 2 } };
  const run = (inv, list = [need]) => ev(`allocate(${J(list)}, ${J(inv)}, ${J(fam)})`);
  assert.equal(run({ T2: 6 })[0].missing.items.T3 || 0, 0);
  assert.equal(run({ T2: 5 })[0].missing.items.T3, 1);   // 5 T2 = 1 T3, reste 2 T2
  const after = run({ T2: 5 }, [need, { exp: 0, lcExp: 0, items: { T2: 2 } }]);
  assert.equal(after[1].missing.items.T2 || 0, 0);       // les 2 T2 restants servent au plan suivant
  assert.equal(run({ T1: 9 }, [{ exp: 0, lcExp: 0, items: { T3: 1 } }])[0].missing.items.T3 || 0, 0);   // 9 T1 → 3 T2 → 1 T3
  // les besoins de palier inférieur du même plan passent avant la synthèse
  assert.deepEqual(run({ T1: 3 }, [{ exp: 0, lcExp: 0, items: { T1: 3, T2: 1 } }])[0].missing.items, { T2: 1 });
});

test('exp_pools_not_interchangeable', () => {
  const inv = { 213: 2, 223: 1 };   // 2 Guides du voyageur (40 000 EXP de perso), 1 Éther raffiné (6 000 EXP de cône)
  const m = ev(`allocate(${J([{ exp: 50000, lcExp: 10000, items: {} }])}, ${J(inv)}, [])`)[0].missing;
  assert.equal(m.exp, 10000); assert.equal(m.lcExp, 4000);
  const none = ev(`allocate(${J([{ exp: 50000, lcExp: 10000, items: {} }])}, undefined, [])`)[0].missing;
  assert.equal(none.exp, 50000); assert.equal(none.lcExp, 10000);   // sans inventaire : besoin total
});

test('families_from_game_data', () => {
  const g = { chars: [
    { pathMats: ['p1', 'p2', 'p3'], common: ['c1', 'c2', 'c3'] },
    { pathMats: ['p1', 'p2', 'p3'], common: ['d1', 'd2', 'd3'] },
    { id: 'sans données' }] };
  assert.deepEqual(ev(`familiesOf(${J(g)})`), [['p1', 'p2', 'p3'], ['c1', 'c2', 'c3'], ['d1', 'd2', 'd3']]);
});

const ITEMS = { W: ['Weekly', 'Hebdo', '', 5, 'weekly'] };
const times = (missing, today = 'new Date(2026, 10, 6)') => ev(`farmTimes(${J(missing)}, DEFAULT_RATES, ${today}, ${J(ITEMS)})`);

test('weekly_limits_time', () => {
  const r = times([{ exp: 0, lcExp: 0, items: { W: 9 } }]);
  const runs = Math.ceil(9 / ev('DEFAULT_RATES.echo'));
  assert.equal(r.perPlan[0].weeklyRuns, runs);
  assert.equal(r.perPlan[0].limitedByWeekly, true);
  assert.equal(r.perPlan[0].days, Math.ceil(runs / 3) * 7);
  assert.equal(r.total.limitedByWeekly, true); assert.equal(r.total.days, Math.ceil(runs / 3) * 7);
});

test('cumulative_dates', () => {
  const exp = 48 * ev('DEFAULT_RATES.exp');   // 480 d'énergie
  const r = times([{ exp, lcExp: 0, items: {} }, { exp, lcExp: 0, items: {} }]);
  assert.equal(r.perPlan[0].tp, 480); assert.equal(r.perPlan[1].tp, 480);
  assert.equal(r.perPlan[0].days, 2); assert.equal(r.perPlan[1].days, 2);
  assert.equal(r.perPlan[0].cumDays, 2); assert.equal(r.perPlan[1].cumDays, 4);
  assert.equal(r.perPlan[0].limitedByWeekly, false);
  assert.equal(r.perPlan[0].cumDate, ev('new Date(2026, 10, 8)'));
  assert.equal(r.perPlan[1].cumDate, ev('new Date(2026, 10, 10)'));
  assert.equal(r.total.tp, 960); assert.equal(r.total.days, 4); assert.equal(r.total.date, ev('new Date(2026, 10, 10)'));
});

test('weekly_limited_plan_then_energy_plan', () => {
  const runs = Math.ceil(9 / ev('DEFAULT_RATES.echo')), weeks = Math.ceil(runs / 3);
  const exp = 48 * ev('DEFAULT_RATES.exp');   // 480 d'énergie : 2 jours
  const r = times([{ exp: 0, lcExp: 0, items: { W: 9 } }, { exp, lcExp: 0, items: {} }]);
  const [a, b] = r.perPlan;
  assert.equal(a.limitedByWeekly, true); assert.equal(a.days, weeks * 7); assert.equal(a.cumDays, weeks * 7);
  assert.equal(b.limitedByWeekly, false); assert.equal(b.days, 2);   // seul, le 2e plan est limité par l'énergie
  assert.equal(b.cumLimitedByWeekly, true); assert.equal(b.cumWeeklyRuns, runs);   // cumulé : les boss hebdo restent le plus long
  assert.equal(b.cumDays, Math.max((a.tp + b.tp) / 240, weeks * 7));
  assert.equal(r.total.limitedByWeekly, true); assert.equal(r.total.days, b.cumDays); assert.equal(r.total.tp, a.tp + b.tp);
});

test('farm_order_changes_plan_times_not_total', () => {
  const exp = 48 * ev('DEFAULT_RATES.exp');
  const big = { exp: 3 * exp, lcExp: 0, items: {} }, small = { exp, lcExp: 0, items: {} };
  const ab = times([big, small]), ba = times([small, big]);
  assert.equal(ab.total.days, ba.total.days); assert.equal(ab.total.tp, ba.total.tp);
  assert.equal(ab.perPlan[0].cumDays, 6); assert.equal(ba.perPlan[0].cumDays, 2);
});

test('disabled_plans_consume_no_stock', () => {
  // la sélection des plans actifs (on !== false) est faite dans ui/planner.js avant allocate : un plan désactivé n'est pas transmis
  const plans = [{ on: false, items: { A: 5 } }, { on: true, items: { A: 5 } }];
  const alloc = list => ev(`allocate(${J(list)}, { A: 5 }, [])`).map(x => x.missing.items);
  const active = alloc(plans.filter(p => p.on !== false));
  assert.deepEqual(active, [{}]);   // le plan actif reçoit tout le stock
  assert.deepEqual(alloc(plans), [{}, { A: 5 }]);   // s'il était transmis, il le prendrait au suivant
});
