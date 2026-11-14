/* Nettoyage de l'état venu de l'extérieur (sauvegarde, fichier importé, archive, historique des vœux) :
   fonctions pures, sans accès au DOM. Nécessite data.js (SLOTS, MAIN_STATS, SUBSTATS, ELEMENTS, PATHS, PROFILE_IDS).
   Les ids, nombres et valeurs de liste fermée sont insérés tels quels dans le HTML (attributs data-*, classes,
   clés de traduction) : ici on garantit leur forme, pour qu'un fichier piégé ne puisse pas injecter de code.
   Les textes libres (noms, notes) restent des textes : ils sont échappés à l'affichage (esc dans ui/core.js). */

const safeId = v => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '');
const optId = v => (v == null || v === '' ? null : safeId(v) || null);
const safeNum = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const safeInt = (v, lo, hi, def = lo) => Math.min(hi, Math.max(lo, Math.trunc(safeNum(v, def))));
const safeStr = v => (v == null ? '' : String(v));
const oneOf = (v, list, def) => (list.includes(v) ? v : def);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const arrOf = v => (Array.isArray(v) ? v : []);

function cleanRelic(r) {
  if (!isObj(r) || !SLOTS.includes(r.slot) || !MAIN_STATS[r.slot].includes(r.main)) return null;
  const id = safeId(r.id);
  if (!id) return null;
  return {
    ...r, id, level: safeInt(r.level, 0, 15), owner: optId(r.owner), set: safeStr(r.set), lock: !!r.lock,
    src: r.src == null ? r.src : safeId(r.src),
    subs: arrOf(r.subs).filter(isObj).slice(0, 4).map(x => ({ stat: SUBSTATS[x.stat] ? x.stat : '', val: safeNum(x.val) }))
  };
}

function cleanCone(c) {
  if (!isObj(c) || !safeId(c.uid)) return null;
  return { uid: safeId(c.uid), id: safeId(c.id), name: safeStr(c.name), level: safeInt(c.level, 0, 80),
    asc: safeInt(c.asc, 0, 6), sup: safeInt(c.sup, 1, 5, 1), owner: optId(c.owner) };
}

const HISTORY_BANNERS = ['char', 'lc', 'std'];
const HISTORY_RESULTS = ['won', 'lost', 'guar', 'na'];
function cleanWish(x) {
  if (!isObj(x) || !safeId(x.id)) return null;
  return { ...x, id: safeId(x.id), src: x.src == null ? x.src : safeId(x.src), date: safeStr(x.date), name: safeStr(x.name),
    banner: oneOf(x.banner, HISTORY_BANNERS, 'std'), result: oneOf(x.result, HISTORY_RESULTS, 'na'), pity: safeInt(x.pity, 0, 90) };
}

function cleanCustom(c) {
  if (!isObj(c) || !safeId(c.id)) return null;
  return { ...c, id: safeId(c.id), name: safeStr(c.name) || '?', fr: c.fr == null ? c.fr : safeStr(c.fr),
    rarity: oneOf(Number(c.rarity), [4, 5], 4), element: oneOf(c.element, ELEMENTS, ELEMENTS[0]),
    path: oneOf(c.path, PATHS, PATHS[0]), profile: c.profile == null ? c.profile : oneOf(c.profile, PROFILE_IDS, undefined), custom: true };
}

/* Traces : { Point01: niveau } (perso possédé) ou { Point01: [de, à] } (plan) */
function cleanTraces(tr, pair) {
  const out = {};
  if (!isObj(tr)) return out;
  for (const k in tr) {
    const key = safeId(k);
    if (!key) continue;
    out[key] = pair ? arrOf(tr[k]).slice(0, 2).map(v => safeInt(v, 0, 15)) : safeInt(tr[k], 0, 15);
  }
  return out;
}

function cleanOwned(owned) {
  const out = {};
  if (!isObj(owned)) return out;
  for (const k in owned) {
    const id = safeId(k), o = owned[k];
    if (!id || !isObj(o)) continue;
    const c = { ...o, e: safeInt(o.e, 0, 6) };
    if (o.lvl != null) c.lvl = safeInt(o.lvl, 1, 80, 1);
    if (o.promo != null) c.promo = safeInt(o.promo, 0, 6);
    if (o.tr != null) c.tr = cleanTraces(o.tr, false);
    if (o.pts != null) c.pts = arrOf(o.pts).map(safeId).filter(Boolean);
    if (o.profile != null) { if (PROFILE_IDS.includes(o.profile)) c.profile = o.profile; else delete c.profile; }
    out[id] = c;
  }
  return out;
}

function cleanPlan(p) {
  if (!isObj(p) || !safeId(p.id)) return null;
  const lc = isObj(p.lc) ? p.lc : {};
  return { ...p, id: safeId(p.id), charId: safeId(p.charId), lvFrom: safeInt(p.lvFrom, 1, 80, 1), lvTo: safeInt(p.lvTo, 1, 80, 80),
    tr: cleanTraces(p.tr, true), lc: { on: !!lc.on, lvTo: safeInt(lc.lvTo, 1, 80, 80) } };
}

const cleanSlots = list => arrOf(list).slice(0, 4).map(optId).concat([null, null, null, null]).slice(0, 4);

function cleanTeam(tm, teamTypes) {
  if (!isObj(tm) || !safeId(tm.id)) return null;
  return { ...tm, id: safeId(tm.id), name: safeStr(tm.name), note: safeStr(tm.note), members: cleanSlots(tm.members),
    main: !!tm.main, type: tm.type ? oneOf(tm.type, teamTypes || [], '') : tm.type };
}

/** État complet nettoyé (nouvel objet). base : valeurs par défaut (defaultState()), pour les réglages invalides. */
function sanitizeState(s, base) {
  const o = { teamTypes: TEAM_TYPES };
  const out = { ...s };
  const keep = (list, fn) => arrOf(list).map(fn).filter(Boolean);
  out.lang = oneOf(s.lang, ['fr', 'en'], base.lang);
  out.relics = keep(s.relics, cleanRelic);
  out.cones = keep(s.cones, cleanCone);
  out.history = keep(s.history, cleanWish);
  out.custom = keep(s.custom, cleanCustom);
  out.plans = keep(s.plans, cleanPlan);
  out.myTeams = keep(s.myTeams, x => cleanTeam(x, o.teamTypes));
  out.owned = cleanOwned(s.owned);
  // pièces de l'événement Aléas et reliques retenues (ids, sans doublon, les 300 dernières)
  out.eventRelicIds = [...new Set(arrOf(s.eventRelicIds).map(safeId).filter(Boolean))].slice(-300);
  // profil de reliques choisi pour un perso non possédé (celui d'un perso possédé est dans owned[id].profile)
  out.profiles = {};
  for (const k in isObj(s.profiles) ? s.profiles : {}) if (safeId(k) && PROFILE_IDS.includes(s.profiles[k])) out.profiles[safeId(k)] = s.profiles[k];
  delete out.weak;   // ancien choix global des faiblesses, remplacé par cycleWeak (par cycle et par moitié)
  out.cycleWeak = {};
  for (const m of ['moc', 'pf', 'as']) {
    const e = s.cycleWeak && s.cycleWeak[m];
    if (!e || typeof e !== 'object') continue;
    const start = Number.isFinite(e.start) ? e.start : null;
    const sides = [0, 1].map(i => [...new Set(arrOf(Array.isArray(e.sides) ? e.sides[i] : []).filter(x => ELEMENTS.includes(x)))]);
    out.cycleWeak[m] = { start, sides };
  }
  out.mergeDeclined = arrOf(s.mergeDeclined).map(safeStr);
  out.teams = {};
  for (const m of ['moc', 'pf', 'as']) {
    const sides = s.teams && Array.isArray(s.teams[m]) ? s.teams[m] : base.teams[m];
    out.teams[m] = [0, 1].map(i => cleanSlots(sides[i]));
  }
  out.builds = {};
  for (const k in isObj(s.builds) ? s.builds : {}) {
    const b = s.builds[k];
    if (!safeId(k) || !isObj(b)) continue;
    out.builds[safeId(k)] = Object.fromEntries(Object.entries(b).filter(([slot]) => SLOTS.includes(slot)).map(([slot, id]) => [slot, safeId(id)]));
  }
  out.rates = {};
  for (const k in base.rates) { const v = safeNum(s.rates && s.rates[k], base.rates[k]); out.rates[k] = v > 0 ? v : base.rates[k]; }
  const w = isObj(s.warp) ? s.warp : {}, bw = base.warp;
  out.warp = { ...bw };
  for (const k in bw) out.warp[k] = typeof bw[k] === 'boolean' ? !!w[k] : Math.max(0, safeNum(w[k], bw[k]));
  for (const k of ['egMoc', 'egPf', 'egAs']) if (k in out.warp) out.warp[k] = Math.min(900, out.warp[k]);   // jades d'endgame par cycle
  out.server = oneOf(s.server, ['', 'europe', 'america', 'asia', 'tw'], '');   // '' : d'après l'UID
  if (s.inventory != null) {
    out.inventory = {};
    for (const k in isObj(s.inventory) ? s.inventory : {}) if (safeId(k)) out.inventory[safeId(k)] = Math.max(0, safeNum(s.inventory[k]));
  }
  if (s.uid != null) out.uid = safeId(s.uid);
  if (s.plChar != null) out.plChar = optId(s.plChar);
  if (s.relicShow != null) out.relicShow = safeInt(s.relicShow, 1, 100000, 60);
  if (s.gachaAt != null) out.gachaAt = safeNum(s.gachaAt);
  if (isObj(s.lastArchive)) {
    const a = s.lastArchive;
    out.lastArchive = { at: safeNum(a.at), uid: a.uid == null ? a.uid : safeId(a.uid), chars: safeInt(a.chars, 0, 1e6),
      relics: safeInt(a.relics, 0, 1e6), lcs: safeInt(a.lcs, 0, 1e6), jades: a.jades == null ? null : safeNum(a.jades),
      unknown: arrOf(a.unknown).map(safeStr), live: !!a.live };
  } else delete out.lastArchive;
  out.newsSeen = safeStr(s.newsSeen);
  out.relicOwnerFilter = safeStr(s.relicOwnerFilter);
  out.teamFilter = safeStr(s.teamFilter) || base.teamFilter;
  out.rosterView = oneOf(s.rosterView, ['chars', 'cones'], base.rosterView);
  const rf = isObj(s.rosterFilter) ? s.rosterFilter : {};
  out.rosterFilter = { q: safeStr(rf.q), el: oneOf(rf.el, ELEMENTS, ''), path: oneOf(rf.path, PATHS, ''), rar: oneOf(String(rf.rar ?? ''), ['', '4', '5'], ''), owned: !!rf.owned };
  const cf = isObj(s.coneFilter) ? s.coneFilter : {};
  out.coneFilter = { path: oneOf(cf.path, PATHS, ''), rar: oneOf(String(cf.rar ?? ''), ['', '3', '4', '5'], ''), equipped: !!cf.equipped };
  return out;
}
