import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers.mjs';

const ev = loadScripts('data.js', 'sanitize.js');

// mêmes valeurs par défaut que defaultState() (ui/core.js) pour les champs que sanitizeState consulte
ev(`var BASE = {
  lang: 'fr', rosterView: 'chars', teamFilter: 'all', rates: { ...DEFAULT_RATES },
  warp: { jades: 0, passes: 0, charPity: 0, charGuar: false, lcPity: 0, lcGuar: false, days: 0, express: false, extra: 0, targetChar: 1, targetLc: 0 },
  teams: { moc: [[null, null, null, null], [null, null, null, null]], pf: [[null, null, null, null], [null, null, null, null]], as: [[null, null, null, null], [null, null, null, null]] }
}`);
const clean = s => ev(`sanitizeState(${JSON.stringify(s)}, BASE)`);
const XSS = '"><img src=x onerror=alert(1)>';

test('une relique piégée ne garde ni id ni niveau injectables', () => {
  const out = clean({ relics: [{ id: 'a1' + XSS, slot: 'body', main: 'cr', level: XSS, owner: XSS, set: XSS, subs: [{ stat: 'cd', val: '5.4' }, { stat: XSS, val: 1 }] }] });
  const r = out.relics[0];
  assert.equal(r.id, 'a1imgsrcxonerroralert1');
  assert.equal(r.level, 0);
  assert.equal(r.owner, 'imgsrcxonerroralert1');
  assert.equal(r.set, XSS, 'le nom du set reste un texte (échappé à l’affichage)');
  assert.deepEqual(r.subs, [{ stat: 'cd', val: 5.4 }, { stat: '', val: 1 }]);
});

test('relique avec emplacement ou stat principale inconnus : retirée', () => {
  const out = clean({ relics: [{ id: 'x', slot: 'body', main: XSS }, { id: 'y', slot: XSS, main: 'cr' }, { id: 'z', slot: 'feet', main: 'spd', level: 15 }] });
  assert.deepEqual(out.relics.map(r => r.id), ['z']);
});

test('une relique normale passe sans changement utile', () => {
  const r = { id: 'a123', src: 'archive', slot: 'sphere', main: 'dmg_fire', level: 15, owner: 'acheron', lock: true, set: 'Inert Salsotto', subs: [{ stat: 'spd', val: 2.6 }], exact: true };
  assert.deepEqual(clean({ relics: [r] }).relics[0], r);
});

test('cônes : nombres bornés, ids nettoyés', () => {
  const out = clean({ cones: [{ uid: '42', id: '23001', name: 'X', level: '80', asc: 9, sup: XSS, owner: null }, { uid: '' }] });
  assert.deepEqual(out.cones, [{ uid: '42', id: '23001', name: 'X', level: 80, asc: 6, sup: 1, owner: null }]);
});

test('historique : bannière et résultat limités aux valeurs connues', () => {
  const out = clean({ history: [{ id: 'g1', banner: XSS, result: XSS, pity: XSS, name: 'Kafka', date: '2026-11-06' }] });
  assert.equal(out.history[0].banner, 'std');
  assert.equal(out.history[0].result, 'na');
  assert.equal(out.history[0].pity, 0);
});

test('persos personnalisés, plans et équipes', () => {
  const out = clean({
    custom: [{ id: 'custom-ab' + XSS, name: XSS, rarity: '5', element: XSS, path: 'hunt' }],
    plans: [{ id: 'p1', charId: 'kafka', lvFrom: '20', lvTo: 99, tr: { Point01: ['1', 99] }, lc: { on: 1, lvTo: XSS } }],
    myTeams: [{ id: 't1', name: 'A', members: ['kafka', XSS], type: XSS, main: 'yes' }]
  });
  assert.equal(out.custom[0].id, 'custom-abimgsrcxonerroralert1');
  assert.equal(out.custom[0].name, XSS);
  assert.equal(out.custom[0].rarity, 5);
  assert.equal(out.custom[0].element, 'physical');
  assert.deepEqual(out.plans[0], { id: 'p1', charId: 'kafka', lvFrom: 20, lvTo: 80, tr: { Point01: [1, 15] }, lc: { on: true, lvTo: 80 } });
  assert.deepEqual(out.myTeams[0].members, ['kafka', 'imgsrcxonerroralert1', null, null]);
  assert.equal(out.myTeams[0].type, '');
  assert.equal(out.myTeams[0].main, true);
});

test('réglages : nombres invalides remplacés par les valeurs par défaut', () => {
  const out = clean({ lang: XSS, rates: { exp: XSS, credits: -3 }, warp: { jades: '1600', charGuar: 'oui' }, rosterFilter: { q: 'ka', el: XSS, rar: 5 } });
  assert.equal(out.lang, 'fr');
  assert.equal(out.rates.exp, ev('DEFAULT_RATES.exp'));
  assert.equal(out.rates.credits, ev('DEFAULT_RATES.credits'));
  assert.equal(out.warp.jades, 1600);
  assert.equal(out.warp.charGuar, true);
  assert.deepEqual(out.rosterFilter, { q: 'ka', el: '', path: '', rar: '5', owned: false });
});

test('résumé du dernier import : nombres seulement', () => {
  const out = clean({ lastArchive: { at: 1, chars: XSS, relics: '12', lcs: 3, jades: XSS, unknown: [XSS] } });
  assert.deepEqual(out.lastArchive, { at: 1, chars: 0, relics: 12, lcs: 3, jades: 0, unknown: [XSS], live: false });
});

test('persos possédés : niveaux bornés, profil inconnu retiré', () => {
  const out = clean({ owned: { ['kafka' + XSS]: { e: 9, lvl: '80', promo: 6, tr: { Point01: '6' }, pts: ['Point08', XSS], profile: XSS } } });
  assert.deepEqual(out.owned, { kafkaimgsrcxonerroralert1: { e: 6, lvl: 80, promo: 6, tr: { Point01: 6 }, pts: ['Point08', 'imgsrcxonerroralert1'] } });
});

test('endgame : serveur connu ou automatique, jades par cycle entre 0 et 900', () => {
  ev(`BASE.warp = { ...BASE.warp, egMoc: 800, egPf: 800, egAs: 800 }`);
  const out = clean({ server: XSS, warp: { egMoc: 5000, egPf: '900', egAs: -4 } });
  assert.equal(out.server, '');
  assert.deepEqual([out.warp.egMoc, out.warp.egPf, out.warp.egAs], [900, 900, 0]);
  assert.equal(clean({ server: 'america' }).server, 'america');
  assert.equal(clean({}).warp.egMoc, 800);
});

test('faiblesses par cycle : éléments inconnus retirés, ancien choix global supprimé', () => {
  const s = clean({ weak: ['fire'], cycleWeak: { moc: { start: 123, sides: [['fire', XSS, 'fire'], ['ice']] }, pf: 'x', zz: { start: 1, sides: [] } } });
  assert.equal(s.weak, undefined);
  assert.deepEqual(s.cycleWeak, { moc: { start: 123, sides: [['fire'], ['ice']] } });
  assert.deepEqual(clean({ cycleWeak: { as: { start: XSS, sides: XSS } } }).cycleWeak, { as: { start: null, sides: [[], []] } });
});
