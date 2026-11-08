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
    if (used >= 4) out.push({ sets: entry.map(p => ({ name: p.name, pieces: p.pieces })), rank: i + 1 });
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
    const good = pick && LO_GOOD.includes(opts.grade(pick));
    const state = !pick ? 'farm' : worn && pick.id === worn.id ? (good ? 'keep' : 'farm') : good ? 'swap' : 'swap_farm';
    if (state === 'swap' || state === 'swap_farm') counts.swap++;
    if (state === 'farm' || state === 'swap_farm') counts.farm++;
    slots[slot] = { worn, pick, state, target, farm: state === 'farm' || state === 'swap_farm' ? target : null };
  }
  return { combo, slots, counts };
}
