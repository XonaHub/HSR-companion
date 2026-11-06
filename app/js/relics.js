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
  // mieux notée pour ce perso ; une pièce libre passe avant une pièce portée
  const better = (r, breaking) => {
    const sets = (breaking ? groupOf(r.slot).target : [r.set]).map(normName);
    const cands = all.filter(x => x !== r && x.id !== r.id && x.slot === r.slot && x.owner !== charId
      && relicMainOk(x.slot, x.main, allowedFor(x.slot), opts.element) && sets.includes(normName(x.set))
      && opts.score(x) > opts.score(r));
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
  const priority = issues.slice(0, 3).map(({ key, ...i }) => ({ ...i, better: better(i.relic, i.set) }));
  return { source: advice ? 'prydwen' : 'profile', slots, cavern, planar, mains, priority };
}
