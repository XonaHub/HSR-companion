import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers.mjs';

const ev = loadScripts('stats.js');
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} != ${b}`);

const CHAR = { stats: [[100, 10, 50, 5, 40, 4, 100, 0.05, 0.5]], trStats: { Point09: [['atk_pct', 0.04]], Point10: [['cr', 0.027]] }, element: 'ice', path: 'elation' };
const CONE = { stats: [[20, 2, 10, 1, 5, 0.5]], passive: [[['cd', 0.16]], [['cd', 0.2]]], path: 'elation', level: 2, promo: 0, sup: 2 };
const RELIC_MAIN = { head: { hp: [112.896, 39.5136] }, body: { cr: [0.05184, 0.018144] } };
const SET_BONUS = { 101: [[['heal', 0.1]], [['spd_pct', 0.06]]] };
const RELICS = [
  { slot: 'head', main: 'hp', level: 15, set: 'Passerby', subs: [{ stat: 'cr', val: 3.24 }, { stat: 'spd', val: 2.3 }] },
  { slot: 'body', main: 'cr', level: 0, set: 'Passerby', subs: [] }
];
const run = over => ev(`charStats(${JSON.stringify({ char: CHAR, level: 3, promo: 0, points: ['Point09'], cone: CONE, relics: RELICS, relicMain: RELIC_MAIN, setBonus: SET_BONUS, ...over })
  .replace(/}$/, ", setIdOf: n => n === 'Passerby' ? '101' : null }")})`);

test('stats_computed_like_the_game', () => {
  const r = run({});
  // base : perso niv. 3 (100 + 2×10…) + cône niv. 2 (20 + 2…)
  near(r.base.hp, 142, 'base PV'); near(r.base.atk, 71, 'base ATQ'); near(r.base.def, 53.5, 'base DÉF'); near(r.base.spd, 100, 'base VIT');
  near(r.total.hp, 142 + 112.896 + 39.5136 * 15, 'PV');       // tête +15
  near(r.total.atk, 71 * 1.04, 'ATQ');                          // trace Point09 seulement
  near(r.total.spd, 102.3, 'VIT');
  near(r.total.cr, 0.05 + 0.0324 + 0.05184, 'taux CRIT');       // base + sous-stat (%) + torse +0
  near(r.total.cd, 0.5 + 0.2, 'DGT CRIT');                     // passif du cône en S2
  near(r.total.heal, 0.1, 'soins');                             // 2 pièces du set, pas 4
  assert.deepEqual(r.missing, []);
});

test('cone_passive_needs_same_path', () => {
  const r = run({ cone: { ...CONE, path: 'hunt' } });
  near(r.total.cd, 0.5, 'DGT CRIT sans passif');
  near(r.base.atk, 71, 'les stats de base du cône comptent quand même');
});

test('four_piece_bonus_and_missing_data', () => {
  const four = RELICS.concat([{ slot: 'hands', main: 'atk', level: 0, set: 'Passerby', subs: [] }, { slot: 'feet', main: 'spd', level: 0, set: 'Passerby', subs: [] }]);
  const r = run({ relics: four });
  near(r.total.spd, 100 * 1.06 + 2.3, 'VIT avec 4 pièces');
  assert.deepEqual(r.missing, ['relicMain']);   // mains et pieds absents de RELIC_MAIN
  assert.deepEqual(run({ char: { ...CHAR, stats: [] } }).missing, ['char']);
});

test('archive_trace_points', () => {
  assert.deepEqual(ev(`archiveTracePoints({ ability_1: true, ability_3: true, stat_1: true, stat_10: true, special: true, stat_2: false })`),
    ['Point06', 'Point08', 'Point09', 'Point18', 'Point21']);
  assert.deepEqual(ev(`archiveTracePoints(null)`), []);
});
