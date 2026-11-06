/* Page « Aujourd'hui » : fonctions pures, sans état de l'app (tout arrive en paramètres, now en ms).
   Les onglets Actus et Vœux utilisent les mêmes fonctions : les chiffres sont identiques partout.
   Forme d'une version d'Actus : { version, name, start, end, phases: [{ start, end, items: [{ name, rarity, kind, rerun }] }] },
   liste triée de la plus récente à la plus ancienne. */

const todayStarted = (x, now) => !!x.start && Date.parse(x.start) <= now;
/* Fin d'une période : une date sans heure (« 2026-11-10 », comme le parseur d'Actus en donne pour les phases)
   compte jusqu'à la fin de ce jour, pas jusqu'à son début. */
const todayEndMs = iso => Date.parse(iso) + (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? 86400000 : 0);

/** Version en cours, choisie comme l'onglet Actus : commencée et pas finie, sinon la dernière commencée. */
function currentVersion(versions, now) {
  const list = versions || [];
  return list.find(x => todayStarted(x, now) && (!x.end || now < Date.parse(x.end)))
    || list.find(x => todayStarted(x, now)) || null;
}

/** Version à venir la plus proche (la dernière des non commencées, la liste allant de la plus récente à la plus ancienne). */
function nextVersion(versions, now) {
  const future = (versions || []).filter(x => !todayStarted(x, now));
  return future.length ? future[future.length - 1] : null;
}

/** Phase de bannière en cours d'une version : { items, end } ; la version entière si ses phases n'ont pas de dates. */
function currentPhase(version, now) {
  if (!version || !(version.phases || []).length) return null;
  const dated = version.phases.filter(p => p.start && p.end);
  if (!dated.length) return { items: version.phases.flatMap(p => p.items || []), end: version.end || null };
  const live = dated.filter(p => Date.parse(p.start) <= now && now < todayEndMs(p.end))
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  return live.length ? { items: live[0].items || [], end: live[0].end } : null;
}

/** Jours restants jusqu'à une date (arrondi au-dessus, jamais négatif) ; null sans date. */
function daysUntil(iso, now) {
  if (!iso) return null;
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 86400000));
}

/** Jours restants jusqu'à la fin d'une période (date sans heure = fin de ce jour) ; null sans date. */
function daysLeft(iso, now) {
  if (!iso) return null;
  return Math.max(0, Math.ceil((todayEndMs(iso) - now) / 86400000));
}

/** Dernière actu : la version la plus récente connue, avec le nombre de nouveaux persos 5★ (hors reruns),
    comme les listes d'Actus qui ne comptent que les persos. */
function latestNews(versions) {
  const x = (versions || [])[0];
  if (!x) return null;
  const items = (x.phases || []).flatMap(p => p.items || []);
  const fresh = new Set(items.filter(i => i.rarity === 5 && i.kind === 'char' && !i.rerun).map(i => i.name));
  return { version: x.version, name: x.name || '', newFive: fresh.size, announced: items.length > 0 };
}

/** Vœux disponibles maintenant : jades convertis + passes, sans revenu futur. */
function pullsNow(warp, jadePerPull) {
  return Math.floor((warp.jades || 0) / jadePerPull) + (warp.passes || 0);
}

/** Poste du jour : ce qui demande le plus d'énergie restante (détail de farmTp). Égalité : ordre ci-dessous. */
function topPost(tp) {
  const posts = [
    ['exp', (tp.expTP || 0) + (tp.lcExpTP || 0)],
    ['credits', tp.crTP || 0],
    ['path', tp.pathTP || 0],
    ['boss', tp.bossTP || 0],
    ['weekly', tp.echoTP || 0]
  ];
  let best = null;
  for (const [key, v] of posts) if (v > 0 && (!best || v > best.tp)) best = { key, tp: v };
  return best;
}

/** Plan « actuellement farmé » : le premier plan actif à qui il manque encore quelque chose (perPlan de farmTimes). */
function farmFocus(perPlan) {
  return (perPlan || []).findIndex(p => p.tp > 0);
}
