/* HSR Companion — persos du jeu absents de la liste écrite à la main (data.js : CHARACTERS)
   et fusion des persos personnalisés devenus officiels. Fonctions pures, testées dans tests/. */

/* Même normalisation que app.js et gamedata::norm (Rust) : décomposition, ASCII, minuscules, lettres et chiffres */
function normName(s) {
  return String(s || '').normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/* Clés possibles d'un perso de l'app dans les données du jeu (même règle que findGameChar dans app.js) */
function charKeys(c) {
  const el = '|' + c.element;
  return [normName(c.name) + el, normName(c.fr) + el, normName(String(c.name || '').replace(/\s*\(.*\)\s*$/, '')) + el];
}

/* Ajoute à `chars` les persos des données du jeu qui n'y sont pas encore (nouvelles versions du jeu).
   Leur profil de reliques est celui par défaut de leur Voie. */
function mergeGameChars(chars, gameChars, defaultProfileByPath) {
  const known = new Set(chars.flatMap(charKeys));
  const ids = new Set(chars.map(c => c.id));
  const added = [];
  for (const g of gameChars || []) {
    if (known.has(g.key)) continue;
    let id = g.en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (ids.has(id)) id += '-' + g.element;   // homonyme (autre élément) : id distinct
    ids.add(id);
    known.add(g.key);
    added.push({ id, name: g.en, fr: g.fr, rarity: g.rarity, element: g.element, path: g.path, profile: defaultProfileByPath[g.path] });
  }
  return added.length ? chars.concat(added) : chars;
}

/* Persos personnalisés qui correspondent à un perso officiel (même nom EN ou FR, même élément).
   `declined` : fusions déjà refusées par le joueur (« idPerso>idOfficiel »), qu'on ne repropose pas. */
function findCustomDuplicates(custom, chars, declined) {
  const out = [];
  for (const cu of custom || []) {
    const n = normName(cu.name);
    const official = chars.find(c => !c.custom && c.element === cu.element && (normName(c.name) === n || normName(c.fr) === n));
    if (official && !(declined || []).includes(cu.id + '>' + official.id)) out.push({ customId: cu.id, officialId: official.id });
  }
  return out;
}

/* Reporte tout ce qui référence le perso personnalisé sur le perso officiel, puis le supprime.
   Un « possédé » officiel déjà présent n'est jamais écrasé. */
function mergeCustomInto(state, customId, officialId) {
  const swap = id => id === customId ? officialId : id;
  if (state.owned && state.owned[customId]) {
    if (!state.owned[officialId]) state.owned[officialId] = state.owned[customId];
    delete state.owned[customId];
  }
  for (const p of state.plans || []) p.charId = swap(p.charId);
  for (const tm of state.myTeams || []) tm.members = tm.members.map(swap);
  for (const sides of Object.values(state.teams || {})) for (const side of sides) side.forEach((id, i) => { side[i] = swap(id); });
  for (const r of state.relics || []) r.owner = swap(r.owner);
  if (state.plChar === customId) state.plChar = officialId;
  state.custom = (state.custom || []).filter(c => c.id !== customId);
}
