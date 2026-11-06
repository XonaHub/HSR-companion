/* Calcul du farm restant : fonctions pures, sans accès au DOM ni à l'état de l'app (S, G).
   Constantes : js/data.js (LEVELS, LEVEL_EXP, LC_LEVEL_EXP, EXP_ITEMS, LC_EXP_ITEMS, ASCENSION…). */

const FARM_CREDIT_ID = '2', FARM_TD_ID = '241';   // ids du jeu (GAME.special)
const FARM_LEGACY_AB = { basic: 'Point01', skill: 'Point02', ult: 'Point03', talent: 'Point04' };

/** Traces du plan avec les clés du jeu (Point01…) : les anciens plans utilisaient basic/skill/ult/talent. */
function farmPlanTr(p) {
  const o = {};
  for (const k in p.tr || {}) o[FARM_LEGACY_AB[k] || k] = p.tr[k];
  return o;
}
/** Catégorie et palier d'un objet d'après GAME.items ([en, fr, icône, rareté, catégorie]). */
const farmItemCat = (items, id) => items && items[id] ? items[id][4] : (String(id) === FARM_CREDIT_ID ? 'credit' : 'common');
const farmItemTier = (items, id) => items && items[id] ? Math.max(1, items[id][3] - 1) : 1;   // rareté 2/3/4 → T1/T2/T3

/** EXP cumulée au niveau lvl : table aux paliers de LEVELS, interpolée entre deux paliers (niveau importé). */
function levelExpAt(table, lvl) {
  if (table[lvl] != null) return table[lvl];
  const i = LEVELS.findIndex(L => L > lvl);
  if (i <= 0) return i === 0 ? 0 : table[LEVELS[LEVELS.length - 1]];
  const a = LEVELS[i - 1], b = LEVELS[i];
  return Math.round(table[a] + (table[b] - table[a]) * (lvl - a) / (b - a));
}

/** Point de départ du plan : l'état importé du perso s'il existe, sinon les champs « de » du plan (repli). */
function planStart(p, owned) {
  const tr = farmPlanTr(p), imported = !!(owned && owned.lvl);
  const out = { lvl: imported ? owned.lvl : p.lvFrom, promo: imported && owned.promo != null ? owned.promo : null, tr: {}, bonusDone: imported && !!owned.bonusAll };
  for (const a in tr) out.tr[a] = imported && owned.tr && owned.tr[a] != null ? owned.tr[a] : tr[a][0];
  return out;
}

/** Ascension due au palier LEVELS[i + 1] (i = 0…5) pour aller jusqu'à lvTo. Avec un état importé
    (promo connu) : due si promo <= i ; sans : due si départ <= palier < lvTo. */
const ascDue = (i, lvl, promo, lvTo) => {
  const cap = LEVELS[i + 1];
  return cap < lvTo && (promo != null ? promo <= i : lvl <= cap);
};

/** Ce que demande le plan à partir de start (planStart).
    g : données exactes du perso (GAME.chars) ou null ; c : { rarity, path } pour les tables de repli (perso personnalisé).
    cone : exemplaire équipé (S.cones) ou null ; gCone : son entrée GAME.lightCones ou null. Le cône ne compte que si p.lc.on.
    → { exp, lcExp, items: { id: n }, gen: { p1…, c1…, boss, weekly } (repli), done } */
function planNeeds(p, start, g, cone, gCone, c) {
  const r = { exp: Math.max(0, levelExpAt(LEVEL_EXP, p.lvTo) - levelExpAt(LEVEL_EXP, start.lvl)), lcExp: 0, items: {}, gen: {}, done: false };
  const addList = list => { for (const [id, n] of list || []) if (n) r.items[id] = (r.items[id] || 0) + n; };
  const rarity = (c && c.rarity) || 5, mult = TRACE_CREDIT_MULT[rarity] || 1;
  const addGen = (o, m = 1) => {
    for (const k in o) {
      if (k === 'credits') addList([[FARM_CREDIT_ID, Math.round(o[k] * m)]]);
      else if (k === 'td') addList([[FARM_TD_ID, o[k]]]);
      else r.gen[k] = (r.gen[k] || 0) + o[k];
    }
  };
  addList([[FARM_CREDIT_ID, Math.round(r.exp * EXP_CREDIT_RATIO)]]);
  for (let i = 0; i < 6; i++) {
    if (ascDue(i, start.lvl, start.promo, p.lvTo)) g ? addList(g.asc[i]) : addGen((ASCENSION[rarity] || ASCENSION[5])[i].cost);
  }
  const tr = farmPlanTr(p);
  for (const a in tr) {
    const from = start.tr[a] != null ? start.tr[a] : tr[a][0];
    for (let l = from + 1; l <= tr[a][1]; l++) {
      if (g) { if (g.tr[a] && g.tr[a][l - 2]) addList(g.tr[a][l - 2]); }
      else { const table = a === 'Point01' ? BASIC_COST : ABILITY_COST; if (table[l]) addGen(table[l], mult); }
    }
  }
  if (p.bonus !== false && !start.bonusDone) g ? addList(g.bonus) : addGen(BONUS_TRACES, mult);
  // cône équipé : EXP de cône, crédits de cette EXP, ascensions
  if (p.lc && p.lc.on && cone && gCone) {
    const table = LC_LEVEL_EXP[gCone.rarity] || LC_LEVEL_EXP[5];
    r.lcExp = Math.max(0, levelExpAt(table, p.lc.lvTo) - levelExpAt(table, cone.level || 1));
    addList([[FARM_CREDIT_ID, Math.round(r.lcExp * LC_EXP_CREDIT_RATIO)]]);
    for (let i = 0; i < 6; i++) if (ascDue(i, cone.level || 1, cone.asc || 0, p.lc.lvTo)) addList((gCone.asc || [])[i]);
  }
  r.done = !r.exp && !r.lcExp && !Object.keys(r.items).length && !Object.values(r.gen).some(Boolean);
  return r;
}

/** Familles de synthèse [T1, T2, T3] : matériaux de Voie et matériaux communs des persos du jeu. */
function familiesOf(game) {
  const seen = new Set(), out = [];
  for (const ch of (game && game.chars) || []) {
    for (const f of [ch.pathMats, ch.common]) {
      if (!Array.isArray(f) || f.length !== 3) continue;
      const key = f.join('|');
      if (!seen.has(key)) { seen.add(key); out.push(f.map(String)); }
    }
  }
  return out;
}

/** Partage du stock entre les plans, dans l'ordre (le premier se sert d'abord).
    Dans une famille, un besoin de palier N est couvert par le palier N, puis par le palier N-1 à 3 pour 1 (récursivement).
    Dans un plan, les paliers bas passent avant : ainsi la synthèse ne prend que le stock dont ce plan n'a pas besoin tel quel.
    L'EXP de perso est couverte par EXP_ITEMS, celle de cône par LC_EXP_ITEMS (elles ne se remplacent pas).
    inventory : { id: n }, ou undefined sans import (le manque est alors le besoin total). */
function allocate(needsInOrder, inventory, families) {
  const stock = {};
  for (const id in inventory || {}) stock[id] = inventory[id] || 0;
  const pool = items => Object.entries(items).reduce((s, [id, v]) => s + (stock[id] || 0) * v, 0);
  let expPool = pool(EXP_ITEMS), lcPool = pool(LC_EXP_ITEMS);
  const famOf = {};
  for (const f of families || []) f.forEach((id, k) => { famOf[id] = [f, k]; });
  // quantité disponible au palier k, synthèse depuis les paliers inférieurs comprise
  const avail = (f, k) => (stock[f[k]] || 0) + (k > 0 ? Math.floor(avail(f, k - 1) / 3) : 0);
  const take = (f, k, n) => {   // n <= avail(f, k)
    const got = Math.min(stock[f[k]] || 0, n);
    stock[f[k]] = (stock[f[k]] || 0) - got;
    if (n > got) take(f, k - 1, 3 * (n - got));
  };
  return needsInOrder.map(need => {
    const missing = { exp: 0, lcExp: 0, items: {}, gen: { ...(need.gen || {}) } };
    const e = Math.min(expPool, need.exp || 0); expPool -= e; missing.exp = (need.exp || 0) - e;
    const l = Math.min(lcPool, need.lcExp || 0); lcPool -= l; missing.lcExp = (need.lcExp || 0) - l;
    const tierOf = id => famOf[id] ? famOf[id][1] : 0;
    const list = Object.entries(need.items || {}).sort((a, b) => tierOf(a[0]) - tierOf(b[0]));
    for (const [id, n] of list) {
      let got;
      if (famOf[id]) { const [f, k] = famOf[id]; got = Math.min(n, avail(f, k)); take(f, k, got); }
      else { got = Math.min(n, stock[id] || 0); stock[id] = (stock[id] || 0) - got; }
      if (n > got) missing.items[id] = n - got;
    }
    return { missing };
  });
}

/** Énergie pour ce qui manque (même barème que le planificateur), détaillée.
    items : GAME.items, pour reconnaître crédits, Voie, boss et hebdo. */
function farmTp(missing, rates, items) {
  let credits = 0, pathT1 = 0, boss = 0, weekly = 0;
  for (const id in missing.items || {}) {
    const n = missing.items[id], cat = farmItemCat(items, id);
    if (cat === 'credit') credits += n;
    else if (cat === 'path') pathT1 += n * 3 ** (farmItemTier(items, id) - 1);
    else if (cat === 'boss') boss += n;
    else if (cat === 'weekly') weekly += n;
  }
  const q = missing.gen || {};   // repli : perso personnalisé
  [1, 2, 3].forEach(i => { pathT1 += (q['p' + i] || 0) * 3 ** (i - 1); });
  boss += q.boss || 0; weekly += q.weekly || 0;
  const t = {
    expTP: (missing.exp || 0) / rates.exp * 10,
    lcExpTP: (missing.lcExp || 0) / (rates.lcExp || DEFAULT_RATES.lcExp) * 10,
    crTP: credits / rates.credits * 10,
    pathTP: pathT1 / rates.crimson * 10,
    bossTP: boss / rates.shadow * 30,
    weeklyRuns: Math.ceil(weekly / rates.echo)
  };
  t.echoTP = t.weeklyRuns * 30;
  t.total = t.expTP + t.lcExpTP + t.crTP + t.pathTP + t.bossTP + t.echoTP;
  return t;
}

/** Durée : le plus long entre l'énergie (TP_PER_DAY par jour) et les boss hebdo (3 par semaine). */
function farmDays(tp, weeklyRuns) {
  const energy = tp / TP_PER_DAY, weeks = Math.ceil(weeklyRuns / 3) * 7;
  return { days: Math.max(energy, weeks), limitedByWeekly: weeks > energy };
}
const addDays = (today, n) => { const d = new Date(today.getTime()); d.setDate(d.getDate() + Math.ceil(n)); return d; };

/** Temps restant par plan et au total. Le temps cumulé d'un plan est celui de ce plan et de tous ceux qui le
    précèdent, farmés ensemble (énergie et boss hebdo avancent en parallèle) ; date = today + jours arrondis au supérieur. */
function farmTimes(missingInOrder, rates, today, items) {
  const sum = { exp: 0, lcExp: 0, items: {}, gen: {} };
  const perPlan = missingInOrder.map(m => {
    const own = farmTp(m, rates, items), d = farmDays(own.total, own.weeklyRuns);
    sum.exp += m.exp || 0; sum.lcExp += m.lcExp || 0;
    for (const id in m.items || {}) sum.items[id] = (sum.items[id] || 0) + m.items[id];
    for (const k in m.gen || {}) sum.gen[k] = (sum.gen[k] || 0) + m.gen[k];
    const cum = farmTp(sum, rates, items), cd = farmDays(cum.total, cum.weeklyRuns);
    return { tp: own.total, weeklyRuns: own.weeklyRuns, days: d.days, limitedByWeekly: d.limitedByWeekly, cumDays: cd.days, cumDate: addDays(today, cd.days) };
  });
  const all = farmTp(sum, rates, items), d = farmDays(all.total, all.weeklyRuns);
  return { perPlan, total: { tp: all.total, weeklyRuns: all.weeklyRuns, days: d.days, date: addDays(today, d.days), limitedByWeekly: d.limitedByWeekly } };
}
