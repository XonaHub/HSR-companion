/* Bilan des reliques d'un perso (conseils Prydwen, sinon profil de reliques) : fonctions pures, sans accès au DOM.
   Nécessite normName (gamechars.js). Les noms de sets sont comparés en anglais. */

const RELIC_CAVERN = ['head', 'hands', 'body', 'feet'];
const RELIC_PLANAR = ['sphere', 'rope'];

/** Stat principale acceptable ? Tête et mains n'ont qu'une stat possible ; sans liste, rien n'est jugé.
    `allowed` peut contenir 'elem' (profils de l'app) : bonus de DGT de l'élément du perso. */
function relicMainOk(slot, main, allowed, element) {
  if (slot === 'head' || slot === 'hands' || !allowed || !allowed.length) return true;
  return allowed.includes(main) || (allowed.includes('elem') && main === 'dmg_' + element);
}

/** Pièces par set : clé normalisée -> { name, n } */
function relicSetCounts(pieces) {
  const m = new Map();
  for (const r of pieces) {
    const k = normName(r.set);
    if (!k) continue;
    if (!m.has(k)) m.set(k, { name: r.set, n: 0 });
    m.get(k).n++;
  }
  return m;
}

/** Set des 4 pièces caverne : 'rec' (entrée conseillée n° rank), 'mix' (2 + 2 parmi les bonus à combiner),
    'missing' (moins de 4 pièces), 'off' (hors conseils) ou 'unknown' (pas de conseil).
    `target` : noms des sets visés (ceux de l'entrée trouvée, sinon de la première entrée). */
function cavernStatus(pieces, advice) {
  const sets = (advice && advice.sets) || [];
  if (!sets.length) return { kind: 'unknown', rank: null, target: [] };
  const counts = relicSetCounts(pieces);
  const n = name => (counts.get(normName(name)) || { n: 0 }).n;
  const flex = ((advice && advice.flex) || []).map(normName);
  for (let i = 0; i < sets.length; i++) {
    const entry = sets[i];
    if (!entry.every(p => n(p.name) >= p.pieces)) continue;
    const used = entry.reduce((s, p) => s + p.pieces, 0);
    // entrée « 2 pièces + Flex » : les 2 autres pièces forment un bonus de la liste à combiner
    if (used < 4 && ![...counts].some(([k, c]) => c.n >= 2 && flex.includes(k) && !entry.some(p => normName(p.name) === k))) continue;
    return { kind: 'rec', rank: i + 1, target: entry.map(p => p.name) };
  }
  const pairs = [...counts.values()].filter(c => c.n >= 2 && flex.includes(normName(c.name)));
  if (pairs.length >= 2) return { kind: 'mix', rank: null, target: pairs.slice(0, 2).map(c => c.name) };
  return { kind: pieces.length < 4 ? 'missing' : 'off', rank: null, target: sets[0].map(p => p.name) };
}

/** Set planaire (sphère + corde) : mêmes valeurs que cavernStatus, sans 'mix'. */
function planarStatus(pieces, advice) {
  const planars = (advice && advice.planars) || [];
  if (!planars.length) return { kind: 'unknown', rank: null, target: [] };
  if (pieces.length < 2) return { kind: 'missing', rank: null, target: [planars[0]] };
  const [a, b] = pieces.map(r => normName(r.set));
  const i = a === b ? planars.findIndex(p => normName(p) === a) : -1;
  return i >= 0 ? { kind: 'rec', rank: i + 1, target: [planars[i]] } : { kind: 'off', rank: null, target: [planars[0]] };
}

/** Bilan des reliques portées par `charId`.
    opts = { element, profileMain (PROFILES[profil].main), score: r -> note (ratio), grade: r -> 'S'…'D' }.
    Renvoie { source, slots, cavern, planar, mains, priority } ; priority : au plus 3
    { relic, main, set, low, better } triées par motif (stat principale, set, note) puis par note. */
function relicReview(advice, relics, charId, opts) {
  const all = relics || [];
  const equipped = all.filter(r => r.owner === charId);
  const slots = {};
  for (const s of RELIC_CAVERN.concat(RELIC_PLANAR)) slots[s] = equipped.find(r => r.slot === s) || null;
  const allowedFor = slot => (advice && advice.main && advice.main[slot] && advice.main[slot].length ? advice.main[slot] : null)
    || (opts.profileMain && opts.profileMain[slot]) || null;
  const mains = ['body', 'feet', 'sphere', 'rope'].map(slot => {
    const allowed = allowedFor(slot), r = slots[slot];
    const best = allowed && allowed[0] === 'elem' ? 'dmg_' + opts.element : allowed ? allowed[0] : null;
    return { slot, relic: r, ok: r ? relicMainOk(slot, r.main, allowed, opts.element) : null, best };
  });
  const cavern = cavernStatus(RELIC_CAVERN.map(s => slots[s]).filter(Boolean), advice);
  const planar = planarStatus(RELIC_PLANAR.map(s => slots[s]).filter(Boolean), advice);
  const groupOf = slot => (RELIC_PLANAR.includes(slot) ? planar : cavern);
  const breaks = r => {
    const st = groupOf(r.slot);
    return (st.kind === 'off' || st.kind === 'missing') && !st.target.some(n => normName(n) === normName(r.set));
  };
  // meilleure pièce du même emplacement : stat principale bonne, set gardé (ou set visé si la pièce casse le set),
  // au moins aussi montée (une pièce +0 n'est notée que sur son potentiel), mieux notée pour ce perso, et d'une
  // meilleure lettre quand seule la note pose problème ; une pièce libre passe avant une pièce portée
  const GRADES = ['D', 'C', 'B', 'A', 'S'];
  const better = (r, breaking, onlyLow) => {
    const sets = (breaking ? groupOf(r.slot).target : [r.set]).map(normName);
    const cands = all.filter(x => x !== r && x.id !== r.id && x.slot === r.slot && x.owner !== charId
      && relicMainOk(x.slot, x.main, allowedFor(x.slot), opts.element) && sets.includes(normName(x.set))
      && (x.level || 0) >= (r.level || 0) && opts.score(x) > opts.score(r)
      && (!onlyLow || GRADES.indexOf(opts.grade(x)) > GRADES.indexOf(opts.grade(r))));
    const free = cands.filter(x => !x.owner);
    const pool = free.length ? free : cands;
    return pool.length ? pool.reduce((a, b) => (opts.score(b) > opts.score(a) ? b : a)) : null;
  };
  const issues = equipped.filter(r => slots[r.slot] === r).map(r => {
    const main = !relicMainOk(r.slot, r.main, allowedFor(r.slot), opts.element);
    const set = breaks(r);
    const low = ['C', 'D'].includes(opts.grade(r));
    return { relic: r, main, set, low, key: main ? 0 : set ? 1 : low ? 2 : 3 };
  }).filter(i => i.key < 3);
  issues.sort((a, b) => a.key - b.key || opts.score(a.relic) - opts.score(b.relic));
  const priority = issues.slice(0, 3).map(({ key, ...i }) => ({ ...i, better: better(i.relic, i.set, !i.main && !i.set) }));
  return { source: advice ? 'prydwen' : 'profile', slots, cavern, planar, mains, priority };
}

/* ---------- Équipement conseillé : 6 pièces tirées de l'inventaire (spec 2026-11-08-reliques-equipement) ----------
   Candidats : pièces libres de niveau 15 et pièces déjà portées par le perso (jamais celles d'un autre perso).
   Valeur d'une pièce : opts.value (valeur absolue des sous-stats utiles), pas le ratio par amélioration. */
const LO_GOOD = ['S', 'A', 'B'];
/* Comparaison de deux combinaisons : le bonus de set demande des pièces, donc d'abord le plus d'emplacements remplis.
   Combinaison complète : le meilleur total, puis le rang Prydwen. Incomplète (il faudra farmer) : viser le set le mieux
   classé plutôt qu'une pièce isolée bien notée d'un set moins bon. */
function loBetter(top, cand, full) {
  if (!top) return true;
  if (cand.filled !== top.filled) return cand.filled > top.filled;
  const byTotal = cand.total !== top.total ? cand.total > top.total : cand.rank < top.rank;
  return cand.filled === full ? byTotal : cand.rank !== top.rank ? cand.rank < top.rank : cand.total > top.total;
}

/** Combinaisons caverne conseillées, dans l'ordre : entrées de advice.sets (une entrée de 2 pièces est complétée
    par une paire de advice.flex), puis paires 2 + 2 tirées de flex seul (rank null). */
function loadoutCavernCombos(advice) {
  const flex = (advice && advice.flex) || [];
  const out = [];
  ((advice && advice.sets) || []).forEach((entry, i) => {
    const used = entry.reduce((s, p) => s + p.pieces, 0);
    const alone = { sets: entry.map(p => ({ name: p.name, pieces: p.pieces })), rank: i + 1 };
    // entrée « 2 pièces + Flex » sans liste flex : l'entrée seule (les 2 autres pièces restent libres)
    if (used >= 4 || !flex.length) out.push(alone);
    else for (const f of flex) if (!entry.some(p => normName(p.name) === normName(f)))
      out.push({ sets: entry.map(p => ({ name: p.name, pieces: p.pieces })).concat({ name: f, pieces: 2 }), rank: i + 1 });
  });
  for (let a = 0; a < flex.length; a++) for (let b = a + 1; b < flex.length; b++)
    out.push({ sets: [{ name: flex[a], pieces: 2 }, { name: flex[b], pieces: 2 }], rank: null });
  return out;
}

/** Équipement conseillé de `charId`.
    opts = { element, profileMain, value: r -> nombre, grade: r -> 'S'…'D' }.
    Renvoie { combo: { cavern: [{ name, pieces }], planar, rank }, slots, counts: { swap, farm } } ;
    slots[slot] = { worn, pick, state: 'keep'|'swap'|'farm'|'swap_farm', target: { set, mains }, farm: target | null }. */
function relicLoadout(advice, relics, charId, opts) {
  const all = relics || [];
  const allowedFor = slot => (advice && advice.main && advice.main[slot] && advice.main[slot].length ? advice.main[slot] : null)
    || (opts.profileMain && opts.profileMain[slot]) || null;
  const admitted = all.filter(r => (!r.owner || r.owner === charId) && (r.owner === charId || r.level === 15)
    && relicMainOk(r.slot, r.main, allowedFor(r.slot), opts.element));
  // meilleure pièce d'un emplacement dans un set (ou tous sets si `set` est null)
  const best = (slot, set) => admitted.filter(r => r.slot === slot && (set == null || normName(r.set) === normName(set)))
    .reduce((a, b) => (!a || opts.value(b) > opts.value(a) ? b : a), null);
  const val = r => (r ? opts.value(r) : 0);
  const assign = {};   // emplacement -> set visé

  // caverne : chaque combinaison, et pour un 2 + 2 chaque répartition des deux sets entre les 4 emplacements
  const cavCombos = loadoutCavernCombos(advice);
  let combo = { cavern: [], planar: null, rank: null };
  if (cavCombos.length) {
    let top = null;
    for (const c of cavCombos) {
      const splits = c.sets.length === 1 ? [RELIC_CAVERN.map(() => c.sets[0].name)]
        : [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].map(pair => RELIC_CAVERN.map((_, i) => (pair.includes(i) ? c.sets[0].name : c.sets[1].name)));
      for (const split of splits) {
        const picks = RELIC_CAVERN.map((slot, i) => best(slot, split[i]));
        const filled = picks.filter(Boolean).length, total = picks.reduce((s, p) => s + val(p), 0);
        if (loBetter(top, { filled, total, rank: c.rank || Infinity }, 4)) top = { c, split, total, filled, rank: c.rank || Infinity };
      }
    }
    combo.cavern = top.c.sets; combo.rank = top.c.rank;
    RELIC_CAVERN.forEach((slot, i) => { assign[slot] = top.split[i]; });
  } else RELIC_CAVERN.forEach(slot => { assign[slot] = null; });

  // planaire : sphère et corde du même set, le mieux noté (à égalité, le premier conseillé)
  const planars = (advice && advice.planars) || [];
  if (planars.length) {
    let top = null;
    for (const p of planars) {
      const picks = RELIC_PLANAR.map(slot => best(slot, p));
      const filled = picks.filter(Boolean).length, total = picks.reduce((s, x) => s + val(x), 0);
      const rank = planars.indexOf(p) + 1;
      if (loBetter(top, { filled, total, rank }, 2)) top = { p, total, filled, rank };
    }
    combo.planar = top.p;
    RELIC_PLANAR.forEach(slot => { assign[slot] = top.p; });
  } else RELIC_PLANAR.forEach(slot => { assign[slot] = null; });

  const slots = {}, counts = { swap: 0, farm: 0 };
  for (const slot of RELIC_CAVERN.concat(RELIC_PLANAR)) {
    const worn = all.find(r => r.owner === charId && r.slot === slot) || null;
    const pick = best(slot, assign[slot]);
    const mains = (allowedFor(slot) || []).map(m => (m === 'elem' ? 'dmg_' + opts.element : m));
    const target = { set: assign[slot], mains: slot === 'head' || slot === 'hands' ? [] : mains };
    // une pièce encore basse (portée) est jugée sur sa valeur réelle, pas sur sa note par amélioration
    const good = pick && ((pick.level || 0) >= 15 ? LO_GOOD.includes(opts.grade(pick)) : opts.value(pick) >= RELIC_CORRECT_AT_15);
    const state = !pick ? 'farm' : worn && pick.id === worn.id ? (good ? 'keep' : 'farm') : good ? 'swap' : 'swap_farm';
    if (state === 'swap' || state === 'swap_farm') counts.swap++;
    if (state === 'farm' || state === 'swap_farm') counts.farm++;
    slots[slot] = { worn, pick, state, target, farm: state === 'farm' || state === 'swap_farm' ? target : null };
  }
  return { combo, slots, counts };
}

/* ---------- Pièces à monter : chances qu'une pièce encore basse finisse meilleure (hasard des améliorations) ----------
   Nécessite SUBSTATS et SUBSTAT_WEIGHTS (data.js). */

/* Valeur (sous-stats utiles) d'une pièce +15 notée B : ratio 0,4 sur 9 améliorations attendues (4 sous-stats + 5 paliers).
   Seuil « pièce correcte » quand l'emplacement n'a pas de pièce conseillée à battre. */
const RELIC_CORRECT_AT_15 = 0.4 * 9;

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même graine, mêmes tirages */
function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Part des `n` simulations où la pièce, montée à +15, vaut plus que `rivalValue` selon `valueOf`.
    Paliers à +3, +6, +9, +12, +15 : avec 3 sous-stats, le premier ajoute une 4e sous-stat (tirée selon
    SUBSTAT_WEIGHTS, hors stat principale et sous-stats présentes) ; sinon une des 4 est améliorée au hasard,
    d'une des 3 valeurs de SUBSTATS[stat].roll. */
function upgradeChance(relic, rivalValue, valueOf, rng, n = 5000) {
  // paliers restants : +3, +6, +9, +12, +15 (une pièce +13 a encore celui de +15)
  const steps = Math.max(0, 5 - Math.floor((relic.level || 0) / 3));
  const start = (relic.subs || []).filter(s => s.stat && SUBSTATS[s.stat]);
  if (!steps) return valueOf({ ...relic, subs: start }) > rivalValue ? 1 : 0;
  let wins = 0;
  for (let i = 0; i < n; i++) {
    const subs = start.map(s => ({ ...s }));
    rollUpgrades(subs, steps, relic.main, rng);
    if (valueOf({ ...relic, level: 15, subs }) > rivalValue) wins++;
  }
  return wins / n;
}

const rngPick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
/** Sous-stat tirée selon SUBSTAT_WEIGHTS, hors stat principale et sous-stats présentes */
function drawSubstat(subs, main, rng) {
  // appelée des centaines de milliers de fois par fiche : pas de tableau intermédiaire
  const ids = WEIGHTED_SUBS || (WEIGHTED_SUBS = Object.keys(SUBSTAT_WEIGHTS));
  const free = id => id !== main && !subs.some(s => s.stat === id);
  let total = 0, last = null;
  for (const id of ids) if (free(id)) { total += SUBSTAT_WEIGHTS[id]; last = id; }
  let r = rng() * total, pick = last;
  for (const id of ids) if (free(id)) { r -= SUBSTAT_WEIGHTS[id]; if (r < 0) { pick = id; break; } }
  return { stat: pick, val: rngPick(SUBSTATS[pick].roll, rng) };
}
let WEIGHTED_SUBS = null;   // clés de SUBSTAT_WEIGHTS, calculées une fois
/** `steps` paliers sur `subs` (modifié) : 4e sous-stat si la pièce n'en a que 3, sinon une des 4 améliorée au hasard */
function rollUpgrades(subs, steps, main, rng) {
  for (let k = 0; k < steps; k++) {
    if (subs.length < 4) subs.push(drawSubstat(subs, main, rng));
    else { const s = rngPick(subs, rng); s.val += rngPick(SUBSTATS[s.stat].roll, rng); }
  }
  return subs;
}

const UPGRADE_STOP = 0.15;  // sous ce seuil : « ne vaut plus le coup » (pièces à monter)

/** Pièces libres encore basses qui pourraient battre la pièce conseillée de leur emplacement (ou, sans pièce
    conseillée, devenir correctes : opts.correctValue). Même set et stat principale que la cible de l'emplacement,
    chances ≥ 10 %, la meilleure par emplacement, au plus 3, triées par chances décroissantes.
    opts = { value, valueOf, correctValue: r -> nombre, rng, cache?: Map (résultats déjà calculés),
    keep?: Set d'ids suivis en direct (toujours renvoyés, même sous 10 %, à +15 ou au-delà des 3) }. Renvoie [{ relic, slot, chance, rival }]. */
function upgradeCandidates(loadout, relics, charId, opts) {
  const bySlot = {}, kept = [];
  for (const r of relics || []) {
    const sl = loadout.slots[r.slot];
    const tracked = !!(opts.keep && opts.keep.has(r.id));   // suivie en direct : gardée sous le seuil et à +15
    if (!sl || r.owner || ((r.level || 0) >= 15 && !tracked)) continue;
    const tg = sl.target;
    if (tg.set != null && normName(r.set) !== normName(tg.set)) continue;
    if (tg.mains.length && !tg.mains.includes(r.main)) continue;
    // une pièce suivie devenue la pièce conseillée de son emplacement (montée à +15) a gagné
    if (tracked && sl.pick && sl.pick.id === r.id) { kept.push({ relic: r, slot: r.slot, chance: 1, rival: null }); continue; }
    const rival = sl.pick || null;
    const rivalValue = rival ? opts.value(rival) : opts.correctValue(r);
    // le calcul est lourd (milliers de tirages) et la fiche se redessine souvent : résultat gardé par pièce et cible
    const key = opts.cache && JSON.stringify([r.id, r.level, r.main, r.subs, rivalValue]);
    let chance = key && opts.cache.has(key) ? opts.cache.get(key) : null;
    if (chance === null) { chance = upgradeChance(r, rivalValue, opts.valueOf, opts.rng); if (key) opts.cache.set(key, chance); }
    if (tracked) { kept.push({ relic: r, slot: r.slot, chance, rival }); continue; }
    if (chance < 0.1) continue;
    if (!bySlot[r.slot] || chance > bySlot[r.slot].chance) bySlot[r.slot] = { relic: r, slot: r.slot, chance, rival };
  }
  return Object.values(bySlot).sort((a, b) => b.chance - a.chance).slice(0, 3).concat(kept);
}
