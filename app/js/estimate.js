/* HSR Companion — estimation des vœux obtenables pendant une version (onglet Actus).
   Maximum possible : revenus réguliers (data.js : PULL_INCOME) sur la durée de la version, plus les
   jades et Passes stellaires spéciaux écrits dans le patch note. Fonction pure, testée dans tests/. */

/* v : { start, end, rewards: [{jades, passes}], events: [{jades, passes}] } (fil d'actus, src-tauri/src/news)
   opts.express : passe Express coché dans l'onglet Vœux.
   Renvoie null si la version n'a pas de dates, sinon le détail ligne par ligne et le total en vœux. */
function estimateVersionPulls(v, opts) {
  if (!v || !v.start || !v.end) return null;
  const days = Math.round((Date.parse(v.end) - Date.parse(v.start)) / 864e5);
  if (!(days > 0)) return null;
  const I = PULL_INCOME;
  // une période commencée compte entière : on vise le maximum
  const periods = len => Math.floor(days / len) + 1;
  const sum = (list, k) => (list || []).reduce((a, x) => a + (x[k] || 0), 0);
  const lines = [];
  const add = (key, jades, passes = 0) => { if (jades || passes) lines.push({ key, jades, passes }); };
  add('daily', days * I.dailyJades);
  if (opts && opts.express) add('express', days * I.expressJades);
  add('weekly', periods(7) * I.weeklyJades);
  add('endgame', periods(I.endgameCycleDays) * I.endgameJadesPerCycle);
  add('embers', 0, periods(30) * I.embersPassesPerMonth);
  add('rewards', sum(v.rewards, 'jades'), sum(v.rewards, 'passes'));
  add('events', sum(v.events, 'jades'), sum(v.events, 'passes'));
  const jades = lines.reduce((a, l) => a + l.jades, 0);
  const passes = lines.reduce((a, l) => a + l.passes, 0);
  return { days, lines, jades, passes, pulls: Math.floor(jades / JADE_PER_PULL) + passes };
}
