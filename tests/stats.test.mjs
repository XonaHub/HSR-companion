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

test('reference_evanescia_matches_game_screen', () => {
  // Test de référence (spec reliques §5) : Evanescia du joueur, niv. 80, toutes traces, cône « Until the Flowers Bloom
  // Again » niv. 80 S1, reliques importées de Reliquary Archiver. Valeurs attendues : écran « Détails des stats » du jeu.
  const ref = loadScripts('assets.js', 'gamechars.js', 'stats.js');
  const S = (stat, val) => ({ stat, val });
  const relics = [
    { slot: 'head', main: 'hp', level: 15, set: 'Ever-Glorious Magical Girl', subs: [S('atk', 38.10379), S('cr', 5.508), S('cd', 16.199999), S('res', 7.7760005)] },
    { slot: 'hands', main: 'atk', level: 15, set: 'Ever-Glorious Magical Girl', subs: [S('hp', 33.87004), S('spd', 4.3), S('cr', 9.072), S('be', 17.495998)] },
    { slot: 'body', main: 'cd', level: 15, set: 'Ever-Glorious Magical Girl', subs: [S('def', 35.986916), S('hp_pct', 3.4560003), S('spd', 6.9), S('ehr', 10.800001)] },
    { slot: 'feet', main: 'atk_pct', level: 15, set: 'Ever-Glorious Magical Girl', subs: [S('cr', 6.48), S('cd', 11.6640005), S('ehr', 8.208), S('atk', 35.986916)] },
    { slot: 'sphere', main: 'dmg_physical', level: 15, set: 'Punklorde Stage Zero', subs: [S('cr', 2.9160001), S('ehr', 7.7760005), S('be', 17.495998), S('hp_pct', 7.7760005)] },
    { slot: 'rope', main: 'err', level: 15, set: 'Punklorde Stage Zero', subs: [S('hp', 42.33755), S('def_pct', 24.84), S('spd', 2.3), S('res', 8.64)] }
  ];
  const points = ['Point06', 'Point07', 'Point08', 'Point09', 'Point10', 'Point11', 'Point12', 'Point13', 'Point14', 'Point15', 'Point16', 'Point17', 'Point18'];
  const r = ref(`(() => {
    const g = GAME.chars.find(c => c.en === 'Evanescia'), lc = GAME.lightCones.find(l => l.en === 'Until the Flowers Bloom Again');
    return charStats({ char: { stats: g.stats, trStats: g.trStats, element: g.element, path: g.path }, level: 80, promo: 6,
      points: ${JSON.stringify(points)}, cone: { stats: lc.stats, passive: lc.passive, path: lc.path, level: 80, promo: 6, sup: 1 },
      relics: ${JSON.stringify(relics)}, relicMain: GAME.relicMain, setBonus: GAME.relicSetBonus,
      setIdOf: n => (GAME.relicSets[normName(n)] || [])[1] ?? null });
  })()`);
  const int = v => Math.floor(v + 1e-9), tenth = v => Math.floor(v * 1000 + 1e-9) / 10;
  assert.deepEqual([int(r.base.hp), int(r.base.atk), int(r.base.def), int(r.base.spd)], [2000, 1372, 923, 104]);
  assert.deepEqual([int(r.total.hp), int(r.total.atk), int(r.total.def), int(r.total.spd)], [3006, 2392, 1189, 122]);
  const t = r.total;
  assert.deepEqual([tenth(t.cr), tenth(t.cd), tenth(t.be), tenth(t.heal), tenth(t.err), tenth(t.ehr), tenth(t.res), tenth(t.elation), tenth(t.dmg)],
    [47.6, 218.6, 34.9, 0, 19.4, 26.7, 16.4, 26, 38.8]);   // régén. d'énergie : 100 % + 19,4 %
  assert.deepEqual(r.missing, []);
});

test('archive_trace_points', () => {
  assert.deepEqual(ev(`archiveTracePoints({ ability_1: true, ability_3: true, stat_1: true, stat_10: true, special: true, stat_2: false })`),
    ['Point06', 'Point08', 'Point09', 'Point18', 'Point21']);
  assert.deepEqual(ev(`archiveTracePoints(null)`), []);
});
