/* HSR Companion — branchement et démarrage
   Chargé en dernier : relie les onglets au rendu, branche clics et saisies, lance l'app. */
'use strict';

Object.assign(RENDERERS, { today: renderToday, roster: renderRoster, planner: renderPlanner, warps: renderWarps, relics: renderRelics, teams: renderTeams, news: renderNews, settings: renderSettings });

/* ------------------------------------------------------------------ binding */
function setPath(path, value) {
  const keys = path.split('.'); let o = S;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}
function bindValue(el) {
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.type === 'number' || el.tagName === 'SELECT') {
    v = parseFloat(el.value); if (isNaN(v)) v = 0;
    if (el.min !== '') v = Math.max(+el.min, v);
    if (el.max !== '') v = Math.min(+el.max, v);
  } else v = el.value;
  setPath(el.dataset.bind, v); save();
  if (S.tab === 'warps') updateWarpDerived();
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (sheet) closeSheet(); else if (teamEdit) closeTeamEditor();
});
document.addEventListener('click', e => {
  if (e.target.id === 'sheet') return closeSheet();   // clic sur le fond
  if (e.target.id === 'teamEditor') return closeTeamEditor();
  const b = e.target.closest('[data-action]');
  if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
  actions[b.dataset.action] && actions[b.dataset.action](b, e);
});
/* Glisser-déposer des cartes de plan : réordonne S.plans (le premier est prioritaire). Les boutons et cases
   de la carte gardent leurs clics : seul un déplacement de la carte lance le glisser. */
let dragId = null;
const planCardOf = e => e.target.closest && e.target.closest('.plan-card[data-id]');
const clearDrop = () => $$('.plan-card.drop-before, .plan-card.drop-after, .plan-card.dragging').forEach(x => x.classList.remove('drop-before', 'drop-after', 'dragging'));
const dropAfter = (card, e) => { const r = card.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; };
document.addEventListener('dragstart', e => {
  const card = planCardOf(e);
  if (!card) return;
  dragId = card.dataset.id; card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId);
});
document.addEventListener('dragover', e => {
  const card = planCardOf(e);
  if (!dragId || !card) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  $$('.plan-card.drop-before, .plan-card.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  if (card.dataset.id !== dragId) card.classList.add(dropAfter(card, e) ? 'drop-after' : 'drop-before');
});
document.addEventListener('drop', e => {
  const card = planCardOf(e);
  if (!dragId || !card) return;
  e.preventDefault();
  const after = dropAfter(card, e), from = dragId, to = card.dataset.id;
  dragId = null; clearDrop();
  S.plans = movePlan(S.plans, from, to, after);
  save(); render();
});
document.addEventListener('dragend', () => { dragId = null; clearDrop(); });
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'langSelect') return setLang(el.value);
  if (el.id === 'archFile' && el.files[0]) return importArchiveFile(el.files[0]);
  if (el.id === 'importFile' && el.files[0]) {
    return readJsonFile(el.files[0], d => { backup('import'); S = migrate(merge(defaultState(), d)); save(); render(); toast(t('import_ok')); }, 'import_err');
  }
  if (el.dataset.cfilter) {
    S.coneFilter[el.dataset.cfilter] = el.type === 'checkbox' ? el.checked : el.value;
    save(); return renderConeGrid();
  }
  if (el.dataset.filter) {
    S.rosterFilter[el.dataset.filter] = el.type === 'checkbox' ? el.checked : el.value;
    save(); return renderRosterGrid();
  }
  if (el.dataset.bind) return bindValue(el);
  if (el.dataset.action && actions[el.dataset.action]) return actions[el.dataset.action](el, e);
  if (el.closest('.relic-form')) updateRelicPreview();
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.filter === 'q') { S.rosterFilter.q = el.value; save(); return renderRosterGrid(); }
  if (el.dataset.bind && el.type === 'number') return bindValue(el);
  if (el.closest('.relic-form')) updateRelicPreview();
});

window.addEventListener('resize', () => { tabBarPos = null; renderTabs(); });
render();
startSky();
// classements de cônes des persos possédés, en arrière-plan et un par un (le cache de 24 h est côté Rust)
if (S.cones.length) setTimeout(() => ownedChars().forEach(c => loadRanking(c)), 1500);
loadNews(false);   // en arrière-plan : point rouge sur l'onglet Actus s'il y a du nouveau
loadGameStatus();  // statut des données du jeu (Paramètres, avertissement de Personnages et Farm)

/* Persos créés à la main avant leur sortie officielle : on propose de fusionner (rien sans accord) */
for (const d of findCustomDuplicates(S.custom, BASE_CHARS, S.mergeDeclined)) {
  const cu = S.custom.find(c => c.id === d.customId);
  if (!cu) continue;
  if (confirm(t('merge_custom', { name: cu.name }))) mergeCustomInto(S, d.customId, d.officialId);
  else S.mergeDeclined = (S.mergeDeclined || []).concat(d.customId + '>' + d.officialId);   // ne plus redemander
  save(); render();
}

/* D'abord la mise à jour de l'app ; si elle est proposée, pas de seconde question sur les données du jeu
   (une nouvelle version les rapporte de toute façon). */
checkAppUpdate(false).then(proposed => {
  if (proposed) return;
  /* Données du jeu : vérification en arrière-plan (au plus toutes les 6 h, voir gamedata/update.rs) ;
     les nouvelles données sont chargées au prochain lancement */
  invoke('game_data_update').then(u => {
    setNet('game', true);
    if (u && u.updated) offerGameRestart(u);
  }).catch(() => { setNet('game', false); /* hors ligne : on garde les données actuelles */ })
    .finally(loadGameStatus);   // l'échec ou la réussite vient d'être noté dans meta.json
});
