/* Statut des données (fraîcheur des sources) : fonctions pures, testées dans tests/status.test.mjs.
   Utilisées par app.js : panneau « Statut des données » de Paramètres, avertissements des onglets, repère « hors ligne ». */

const STATUS_WARN_MS = 24 * 3600 * 1000;   // données du jeu non vérifiées depuis plus longtemps : on prévient

/* Temps écoulé depuis ts, en [clé i18n, n] : ago_now (< 1 min), ago_min, ago_h, ago_d ; null sans date */
function agoParts(ts, now) {
  if (!ts) return null;
  const min = Math.max(0, Math.floor((now - ts) / 60000));
  if (min < 1) return ['ago_now', 0];
  if (min < 60) return ['ago_min', min];
  const h = Math.floor(min / 60);
  if (h < 24) return ['ago_h', h];
  return ['ago_d', Math.floor(h / 24)];
}

/* Données du jeu : 'pending' (nouvelles données téléchargées pendant cette session, relancer l'app),
   'failing' (la dernière vérification a échoué et la dernière réussie date de plus de 24 h, ou n'a jamais eu lieu),
   sinon null. startedAt = heure de lancement de la page. */
function gameDataAlert(st, now, startedAt) {
  if (!st) return null;
  if (st.downloaded && st.updatedAt && st.updatedAt > startedAt) return 'pending';
  const failing = st.failedAt && (!st.checkedAt || st.failedAt > st.checkedAt);
  if (failing && (!st.checkedAt || now - st.checkedAt > STATUS_WARN_MS)) return 'failing';
  return null;
}

/* Classements Prydwen chargés (valeurs de la Map rankings : objet ou 'error') → { fetchedAt le plus récent, stale } */
function prydwenSummary(rankings) {
  let fetchedAt = 0, stale = false, errors = 0, n = 0;
  for (const r of rankings) {
    if (r === 'error') { errors++; continue; }
    if (!r || typeof r !== 'object') continue;
    n++;
    if (r.fetchedAt > fetchedAt) fetchedAt = r.fetchedAt;
    if (r.stale) stale = true;
  }
  return { n, errors, fetchedAt: fetchedAt || null, stale };
}

/* Repère « hors ligne » de l'en-tête : une des sources vient d'échouer (net = { game, news, prydwen } : 'ok' | 'offline' | undefined) */
function isOffline(net) {
  return Object.values(net || {}).some(v => v === 'offline');
}
