/* Cônes de lumière importés (export Reliquary Archiver) : fonctions pures, sans accès au DOM. */

/** Entrée de GAME.lightCones pour un id (nombre ou texte), ou null si le cône est inconnu des données du jeu. */
function coneOf(lightCones, id) {
  const key = String(id);
  return (lightCones || []).find(c => String(c.id) === key) || null;
}

/** Cônes de l'archive -> S.cones. Un cône absent des données du jeu est gardé avec le nom de l'archive.
    charIdOf : id de perso du jeu -> id de perso de l'app, ou null. */
function importCones(list, lightCones, charIdOf) {
  return (list || []).map(c => {
    const known = coneOf(lightCones, c.id);
    return {
      uid: String(c._uid),
      id: String(c.id),
      name: (known && known.en) || c.name || String(c.id),
      level: c.level || 0,
      asc: c.ascension || 0,
      sup: Math.min(5, Math.max(1, c.superimposition || 1)),
      owner: c.location && Number(c.location) ? (charIdOf(c.location) || null) : null
    };
  });
}

/** Rapproche le classement Prydwen d'un perso et l'inventaire. Nécessite normName (gamechars.js).
    Renvoie { mine, target, equipped, better } ; Entry = { lc, rank, score, testedSup, owned }. */
function coneAdvice(ranking, cones, lightCones, charId) {
  const TOP = 5;
  const owned = cones || [];
  const byName = new Map((lightCones || []).map(lc => [normName(lc.en), lc]));
  // entrées du classement par cône du jeu (les noms inconnus sont ignorés), dans l'ordre du classement
  const groups = new Map();
  for (const e of ((ranking && ranking.cones) || []).slice().sort((a, b) => a.rank - b.rank)) {
    const lc = byName.get(normName(e.name));
    if (!lc) continue;
    if (!groups.has(lc.id)) groups.set(lc.id, { lc, list: [] });
    groups.get(lc.id).list.push(e);
  }
  const mine = [], target = [];
  for (const { lc, list } of groups.values()) {
    if (list[0].rank > TOP || mine.length + target.length >= TOP) continue;
    const copies = owned.filter(c => String(c.id) === String(lc.id));
    const best = (a, b) => (b.sup > a.sup ? b : a);
    const pool = [copies.filter(c => c.owner === charId), copies.filter(c => !c.owner), copies].find(p => p.length);
    const copy = pool ? pool.reduce(best) : null;
    let e = list[0];
    if (copy) {
      const under = list.filter(x => x.sup <= copy.sup);
      e = under.length ? under.reduce((a, b) => (b.sup > a.sup ? b : a)) : list.reduce((a, b) => (b.sup < a.sup ? b : a));
    }
    const entry = { lc, rank: e.rank, score: e.score == null ? null : e.score, testedSup: e.sup, owned: copy };
    (copy ? mine : target).push(entry);
  }
  mine.sort((a, b) => a.rank - b.rank); target.sort((a, b) => a.rank - b.rank); // tri stable, sur le rang affiché
  const equipped = owned.find(c => c.owner === charId) || null;
  let better = null;
  if (!equipped) better = mine[0] || null;
  else {
    const cur = mine.find(m => m.lc.id === String(equipped.id));
    better = cur ? mine.find(m => m.rank < cur.rank) || null : mine.find(m => m.owned.uid !== equipped.uid) || null;
  }
  return { mine, target, equipped, better };
}
