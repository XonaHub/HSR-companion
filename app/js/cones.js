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
