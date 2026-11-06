/* Cycles de l'endgame (Mémoire du chaos, Fiction pure, Ombre apocalyptique) : fonctions pures, sans accès au DOM
   ni aux variables globales de l'app. Les cycles viennent des patch notes officiels (fil d'actus, `versions[].endgame`,
   src-tauri/src/news/parse.rs), en heure du serveur ; `now` et le décalage du serveur arrivent en paramètres. */

const ENDGAME_MODES = ['moc', 'pf', 'as'];
/* Heure du serveur : décalage fixe toute l'année (les resets se décalent d'une heure en heure locale avec l'heure d'été) */
const SERVER_OFFSETS = { europe: 1, america: -5, asia: 8, tw: 8 };
const ENDGAME_CYCLE_MS = 42 * 86400000;   // chaque mode dure 6 semaines ; les trois sont décalés de 2 semaines

/** Serveur d'après le premier chiffre de l'UID (6 Amérique, 7 Europe, 8 Asie, 9 TW/HK/MO), sinon null. */
function serverOfUid(uid) {
  return { 6: 'america', 7: 'europe', 8: 'asia', 9: 'tw' }[String(uid || '').charAt(0)] || null;
}

/** « AAAA-MM-JJTHH:MM » en heure du serveur (décalage `offsetH` heures) -> ms UTC */
function serverTimeMs(text, offsetH) {
  return Date.parse(text + ':00Z') - offsetH * 3600000;
}

/** Cycles connus par mode, triés par début : { moc: Cycle[], pf, as }.
    Cycle = { mode, name, effect, startMs, endMs, version, deduced: false }. Un cycle sans début lisible est ignoré. */
function endgameCycles(versions, offsetH) {
  const out = { moc: [], pf: [], as: [] };
  for (const v of versions || []) {
    for (const c of (v && v.endgame) || []) {
      if (!out[c.mode] || !c.end) continue;
      const startMs = c.start ? serverTimeMs(c.start, offsetH) : Date.parse(v.start);   // sans date : début de la version
      const endMs = serverTimeMs(c.end, offsetH);
      if (!(startMs < endMs)) continue;
      if (out[c.mode].some(x => x.startMs === startMs)) continue;   // même cycle lu deux fois
      out[c.mode].push({ mode: c.mode, name: c.name || '', effect: c.effect || '', startMs, endMs, version: v.version, deduced: false });
    }
  }
  for (const m of ENDGAME_MODES) out[m].sort((a, b) => a.startMs - b.startMs);
  return out;
}

/* Cycle déduit qui suit `c` : début 1 minute après sa fin (03:59 -> 04:00), 6 semaines */
const deducedAfter = c => {
  const startMs = c.endMs + 60000;
  return { mode: c.mode, name: '', effect: '', startMs, endMs: startMs + ENDGAME_CYCLE_MS - 60000, version: null, deduced: true };
};

/* Cycles officiels du mode, puis la chaîne déduite jusqu'à `until` (ms) */
function chainUntil(list, until) {
  const all = list.slice();
  while (all.length && all[all.length - 1].endMs < until) all.push(deducedAfter(all[all.length - 1]));
  return all;
}

/** Cycle en cours et cycle suivant de chaque mode à l'instant `now` (officiels, sinon déduits) :
    { moc: { current, next }, pf: {…}, as: {…} }, chaque valeur null si rien n'est connu. */
function endgameStatus(cycles, now) {
  const out = {};
  for (const m of ENDGAME_MODES) {
    const all = chainUntil((cycles && cycles[m]) || [], now + ENDGAME_CYCLE_MS);
    // la fin « 03:59 » couvre toute sa minute : le cycle suivant commence à 04:00
    const current = all.find(c => c.startMs <= now && now < c.endMs + 60000) || null;
    const next = all.find(c => c.startMs > now) || null;
    out[m] = { current, next };
  }
  return out;
}

/** Prochain nouveau cycle, tous modes confondus : { mode, cycle } ou null. */
function nextEndgameReset(status) {
  let best = null;
  for (const m of ENDGAME_MODES) {
    const n = status && status[m] && status[m].next;
    if (n && (!best || n.startMs < best.cycle.startMs)) best = { mode: m, cycle: n };
  }
  return best;
}

/** Nouveaux cycles qui commencent dans ]from, to], triés : [{ mode, startMs, deduced }]. */
function endgameResetsBetween(cycles, from, to) {
  const out = [];
  for (const m of ENDGAME_MODES) {
    for (const c of chainUntil((cycles && cycles[m]) || [], to)) {
      if (c.startMs > from && c.startMs <= to) out.push({ mode: m, startMs: c.startMs, deduced: c.deduced });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** Jades des nouveaux cycles dans ]from, to] : perMode = { moc, pf, as } (jades obtenus par cycle). */
function endgameJadesBetween(cycles, from, to, perMode) {
  const resets = endgameResetsBetween(cycles, from, to);
  return { jades: resets.reduce((a, r) => a + ((perMode && perMode[r.mode]) || 0), 0), count: resets.length };
}
