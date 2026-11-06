/* Stats d'un perso comme sur l'écran du jeu (hors combat) : fonctions pures, sans accès au DOM.
   Valeurs en ratios du jeu (0.05 = 5 %), sauf PV/ATQ/DÉF/VIT. Données : GAME de assets.js (Rust, gamedata/mod.rs). */

/** Traces de l'archive (Reliquary Archiver, export « fribbels ») -> ancres des points de trace du jeu.
    ability_N = Point0(5+N), stat_N = Point(08+N), special = Point21 (src/export/fribbels/converters.rs). */
function archiveTracePoints(tr) {
  const t = tr || {}, pts = [];
  const pad = n => 'Point' + String(n).padStart(2, '0');
  for (let i = 1; i <= 3; i++) if (t['ability_' + i]) pts.push(pad(5 + i));
  for (let i = 1; i <= 10; i++) if (t['stat_' + i]) pts.push(pad(8 + i));
  if (t.special) pts.push(pad(21));
  return pts;
}

/* Sous-stats données en % par l'archive (le reste est une valeur fixe) */
const STAT_PCT_SUBS = ['hp_pct', 'atk_pct', 'def_pct', 'cr', 'cd', 'ehr', 'res', 'be'];

/** Valeur de la stat principale d'une relique 5★ : base + pas × niveau (null si inconnue) */
function relicMainValue(relicMain, r) {
  const m = relicMain && relicMain[r.slot] && relicMain[r.slot][r.main];
  return m ? m[0] + m[1] * (r.level || 0) : null;
}

/** Stats du perso.
    input = { char: { stats, trStats, element, path }, level, promo, points: [ancres] | null,
              cone: { stats, passive, path, level, promo, sup } | null,
              relics: [{ slot, main, level, subs, set }], relicMain, setBonus: id -> [[2p], [4p]], setIdOf: nom -> id }
    Renvoie { base: { hp, atk, def, spd }, total: { hp, atk, def, spd, cr, cd, be, heal, err, ehr, res, dmg }, missing: [...] } ;
    `missing` liste ce qui manque pour un calcul exact ('char', 'relicMain'). */
function charStats(input) {
  const add = {}, missing = [];
  const put = (k, v) => { add[k] = (add[k] || 0) + v; };
  const putAll = pairs => (pairs || []).forEach(([k, v]) => put(k, v));
  const lvl = Math.max(1, input.level || 1);
  const cs = input.char && input.char.stats && input.char.stats[Math.min(input.promo || 0, input.char.stats.length - 1)];
  if (!cs) missing.push('char');
  const s = cs || [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const base = { hp: s[0] + s[1] * (lvl - 1), atk: s[2] + s[3] * (lvl - 1), def: s[4] + s[5] * (lvl - 1), spd: s[6] };
  const cone = input.cone;
  if (cone && cone.stats && cone.stats.length) {
    const c = cone.stats[Math.min(cone.promo || 0, cone.stats.length - 1)], cl = Math.max(1, cone.level || 1);
    base.hp += c[0] + c[1] * (cl - 1); base.atk += c[2] + c[3] * (cl - 1); base.def += c[4] + c[5] * (cl - 1);
    // bonus fixe du cône : seulement s'il est de la même Voie que le perso, comme dans le jeu
    if (cone.path === (input.char && input.char.path) && cone.passive) putAll(cone.passive[Math.min(5, Math.max(1, cone.sup || 1)) - 1]);
  }
  put('cr', s[7]); put('cd', s[8]);
  const tr = (input.char && input.char.trStats) || {};
  for (const p of input.points || []) putAll(tr[p]);
  const counts = {};
  for (const r of input.relics || []) {
    const v = relicMainValue(input.relicMain, r);
    if (v == null) { if (!missing.includes('relicMain')) missing.push('relicMain'); } else put(r.main, v);
    for (const x of r.subs || []) if (x.stat && x.val) put(x.stat, STAT_PCT_SUBS.includes(x.stat) ? x.val / 100 : x.val);
    const id = input.setIdOf ? input.setIdOf(r.set) : null;
    if (id != null) counts[id] = (counts[id] || 0) + 1;
  }
  for (const [id, n] of Object.entries(counts)) {
    const b = input.setBonus && input.setBonus[id];
    if (!b) continue;
    if (n >= 2) putAll(b[0]);
    if (n >= 4) putAll(b[1]);
  }
  const g = k => add[k] || 0;
  const el = input.char && input.char.element;
  const total = {
    hp: base.hp * (1 + g('hp_pct')) + g('hp'),
    atk: base.atk * (1 + g('atk_pct')) + g('atk'),
    def: base.def * (1 + g('def_pct')) + g('def'),
    spd: base.spd * (1 + g('spd_pct')) + g('spd'),
    cr: g('cr'), cd: g('cd'), be: g('be'), heal: g('heal'), err: g('err'), ehr: g('ehr'), res: g('res'),
    dmg: g('dmg_' + el) + g('dmg_all')
  };
  return { base, total, missing };
}
