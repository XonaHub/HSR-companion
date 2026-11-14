/* HSR Companion — socle de l'interface
   État et sauvegarde, copies, statut des données, outils communs (t, esc, render…), animations.
   Chargé en premier ; les onglets (ui/*.js) puis main.js suivent, voir index.html. */
'use strict';

const KEY = 'hsr-companion-v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const today = () => new Date().toISOString().slice(0, 10);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ état */
const emptyTeams = () => ({ moc: [[null, null, null, null], [null, null, null, null]], pf: [[null, null, null, null], [null, null, null, null]], as: [[null, null, null, null], [null, null, null, null]] });
const defaultState = () => ({
  lang: (navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en',
  tab: 'roster',
  owned: {},
  custom: [],
  plans: [],
  // egMoc/egPf/egAs : jades obtenus d'habitude par cycle d'endgame (onglet Vœux)
  warp: { jades: 0, passes: 0, charPity: 0, charGuar: false, lcPity: 0, lcGuar: false, days: 0, express: false, extra: 0, targetChar: 1, targetLc: 0,
    egMoc: PULL_INCOME.endgameAllStarsJades, egPf: PULL_INCOME.endgameAllStarsJades, egAs: PULL_INCOME.endgameAllStarsJades },
  server: '',           // serveur du jeu pour les heures de reset : '' = d'après l'UID (endgame.js)
  history: [],
  relics: [],
  profiles: {},         // profil de reliques choisi pour un perso non possédé : { charId: profil }
  cones: [],            // cônes de lumière importés : { uid, id, name, level, asc, sup, owner }
  builds: {},           // builds gardés du simulateur : id de perso -> { emplacement: id de relique }
  relicOwnerFilter: '',
  teams: emptyTeams(),
  myTeams: [],          // équipes personnelles : { id, name, type, members[4], main, note }
  teamFilter: 'all',
  cycleWeak: {},        // faiblesses ennemies par mode : { moc: { start, sides: [[éléments], [éléments]] } } (endgame.js, cycleWeakSides)
  rates: { ...DEFAULT_RATES },
  rosterFilter: { q: '', el: '', path: '', rar: '', owned: false },
  rosterView: 'chars',  // 'chars' | 'cones' : sélecteur en haut de l'onglet Persos
  coneFilter: { path: '', rar: '', equipped: false },
  newsSeen: '',         // dernière annonce vue dans l'onglet Actus (point rouge sinon)
  mergeDeclined: []     // fusions de persos personnalisés refusées (« idPerso>idOfficiel »)
});
function merge(base, d) {
  for (const k in d) {
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
    base[k] = isObj(d[k]) && isObj(base[k]) ? merge(base[k], d[k]) : d[k];
  }
  return base;
}
/* Backend Rust de l'app de bureau (src-tauri/src) : système de fichiers, réseau, import des vœux */
const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);

/* Liens externes : la WebView de Tauri n'ouvre pas les target="_blank" ; on les passe au
   navigateur du système (plugin opener, http/https uniquement). Clic gauche et clic molette. */
function openExternal(e) {
  if (e.type === 'auxclick' && e.button !== 1) return;
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || !/^https?:\/\//i.test(a.href)) return;
  e.preventDefault();
  invoke('plugin:opener|open_url', { url: a.href }).catch(() => { /* hors app de bureau */ });
}
document.addEventListener('click', openExternal);
document.addEventListener('auxclick', openExternal);

/* ------------------------------------------------------------------ sauvegarde */
function load() {
  // localStorage et data.json (injecté avant le chargement par src-tauri/src/lib.rs) : on garde la copie la plus récente
  const found = [window.__HSR_STATE__];
  try { const raw = localStorage.getItem(KEY); if (raw) found.push(JSON.parse(raw)); } catch (e) { /* stockage indisponible */ }
  let best = null;
  for (const d of found) if (d && typeof d === 'object' && (!best || (d.savedAt || 0) > (best.savedAt || 0))) best = d;
  return migrate(best ? merge(defaultState(), best) : defaultState());
}
function migrate(s) {   // anciennes sauvegardes
  delete s.lastImport;   // import par vitrine (fonction retirée)
  for (const p of s.plans || []) if (!p.lc) p.lc = { on: false, lvTo: 80 };   // cône équipé : pas inclus par défaut
  return sanitizeState(s, defaultState());   // sauvegarde ou fichier importé : forme garantie (js/sanitize.js)
}
let S = load();
S.tab = 'today';   // l'app s'ouvre toujours sur « Aujourd'hui » (l'onglet choisi reste enregistré, sans effet au lancement suivant)
// save() est appelé à chaque saisie : l'écriture (JSON de tout l'état) est regroupée toutes les 300 ms
let saveTimer = null;
function flushSave() {
  clearTimeout(saveTimer); saveTimer = null;
  S.savedAt = Date.now();
  const json = JSON.stringify(S);
  try { localStorage.setItem(KEY, json); } catch (e) { /* ignore */ }
  invoke('save_state', { json, day: localDay() }).catch(() => { /* localStorage reste à jour */ });
}
/* Copies de la sauvegarde (storage.rs) : jour local (pas UTC) pour la « copie du jour » */
const localDay = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
let backups = null;   // liste des copies (Paramètres), relue après chaque nouvelle copie
/* Statut des données (js/status.js) */
const STARTED_AT = Date.now();
let gameStatus = null;     // game_data_status (gamedata/update.rs) : { downloaded, updatedAt, checkedAt, failedAt, error }
let checkingData = false;  // bouton « Vérifier maintenant » en cours
const net = {};            // dernier résultat réseau par source : 'ok' | 'offline' (repère de l'en-tête)
function setNet(src, ok) {
  const was = isOffline(net);
  net[src] = ok ? 'ok' : 'offline';
  if (isOffline(net) !== was) renderNetBadge();
}
function renderNetBadge() {
  const b = $('#netBadge');
  if (!b) return;
  b.hidden = !isOffline(net);
  b.textContent = t('net_offline'); b.title = t('net_offline_title');
}
function loadGameStatus() {
  return invoke('game_data_status').then(st => {
    const before = gameDataAlert(gameStatus, Date.now(), STARTED_AT);
    gameStatus = st;
    const changed = gameDataAlert(st, Date.now(), STARTED_AT) !== before;
    if ((S.tab === 'settings' || (changed && (S.tab === 'roster' || S.tab === 'planner'))) && !typing()) render();
  }).catch(() => { /* hors app de bureau */ });
}
/* une saisie est en cours : ne pas redessiner l'onglet (focus et texte perdus) */
const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.id !== 'langSelect'; };
const ago = ts => { const p = agoParts(ts, Date.now()); return p ? t(p[0], { n: p[1] }) : t('never'); };
/* Avertissement « données du jeu pas à jour » en haut de Personnages et Farm (rien quand tout va bien) */
function gameAlertNote() {
  const a = gameDataAlert(gameStatus, Date.now(), STARTED_AT);
  if (a === 'pending') return `<p class="note warn status-note">${t('status_pending')} <button class="btn sm" data-action="restartApp">${t('status_restart')}</button></p>`;
  if (a === 'failing') return `<p class="note warn status-note">${esc(t('status_game_failing', { ago: ago(gameStatus.checkedAt) }))} <button class="btn sm" data-action="openStatus">${t('status_title')}</button></p>`;
  return '';
}
/* Fenêtres (fiche perso, équipe, confirmation) : fond commun .sheet-backdrop */
/* Focus des fenêtres (clavier, lecteurs d'écran) : à l'ouverture le focus entre dans la fenêtre, à la fermeture il
   revient sur l'élément qui l'a ouverte. Chaque rendu remplace innerHTML (le focus tomberait sur <body>) : modalRoot
   note l'élément qui a le focus avant le rendu et le retrouve juste après (même data-action et mêmes data-*). */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const focusables = root => [...root.querySelectorAll(FOCUSABLE)].filter(el => !el.closest('[hidden]'));
const focusKey = el => el && el.dataset ? JSON.stringify(el.dataset) : null;
const modalOpener = new Map();   // id de fenêtre -> élément qui avait le focus à l'ouverture
function modalRoot(id) {
  let root = document.getElementById(id);
  if (!root) {
    modalOpener.set(id, document.activeElement);
    root = document.createElement('div'); root.id = id; root.className = 'sheet-backdrop';
    document.body.appendChild(root); document.body.classList.add('no-scroll');
  }
  const before = root.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  queueMicrotask(() => {   // après le rendu synchrone qui suit l'appel
    if (!root.isConnected || root.contains(document.activeElement)) return;
    const list = focusables(root);
    const same = before && list.find(el => focusKey(el) === before);
    const first = list.find(el => !el.classList.contains('sheet-close')) || list[0];
    if (same || first) (same || first).focus({ preventScroll: true });
  });
  return root;
}
function closeModal(id) {
  const el = document.getElementById(id); if (el) el.remove();
  if (!$('.sheet-backdrop')) document.body.classList.remove('no-scroll');   // plus aucune fenêtre ouverte
  const opener = modalOpener.get(id); modalOpener.delete(id);
  // l'onglet derrière a pu être redessiné pendant que la fenêtre était ouverte : même bouton retrouvé par ses data-*
  const key = opener && opener.isConnected === false ? focusKey(opener) : null;
  const back = key ? focusables(document).find(el => focusKey(el) === key) : opener;
  if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
}
/** Redessine `root` avec render() en gardant le focus sur le même élément (même data-*), s'il y était */
function keepFocus(root, render) {
  const before = root && root.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  render();
  const same = before && focusables(root).find(el => focusKey(el) === before);
  if (same) same.focus({ preventScroll: true });
}
/* Tab reste dans la fenêtre du dessus (la dernière ouverte) */
function trapTab(e) {
  const backs = $$('.sheet-backdrop'); if (!backs.length) return;
  const list = focusables(backs[backs.length - 1]); if (!list.length) return;
  const first = list[0], last = list[list.length - 1], inside = backs[backs.length - 1].contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
}

/* Confirmation dans l'app, à la place de confirm() : dans l'app de bureau, le plugin dialog de Tauri remplace
   window.confirm par une fonction asynchrone (une promesse, donc toujours « vraie » dans un if), et la page n'a pas
   la permission d'afficher sa fenêtre : confirm() ne demandait rien et répondait oui. Ne jamais utiliser
   confirm/alert/prompt (tests/ui-load.test.mjs le vérifie).
   ask({ title, text, html, ok, cancel, danger }) → Promise<boolean> ; Échap, Annuler ou clic sur le fond = non.
   html est inséré tel quel : n'y mettre que du texte passé par esc(). */
let askPending = null;
function ask({ title, text = '', html = '', ok = t('ok_btn'), cancel = t('cancel'), danger = false }) {
  if (askPending) answerAsk(false);   // une seule question à la fois
  return new Promise(resolve => {
    askPending = resolve;
    const root = modalRoot('askDialog');
    root.innerHTML = `<div class="team-editor ask-dialog" role="alertdialog" aria-modal="true" aria-labelledby="askTitle">
      <h2 id="askTitle">${esc(title)}</h2>
      ${text ? `<p class="ask-text">${esc(text)}</p>` : ''}${html}
      <div class="form-row te-actions">
        <button class="btn" data-action="askNo">${esc(cancel)}</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-action="askYes">${esc(ok)}</button>
      </div></div>`;
    // action dangereuse : le focus va sur « Annuler », pour qu'Entrée ne détruise rien
    root.querySelector(danger ? '[data-action=askNo]' : '[data-action=askYes]').focus();
  });
}
function answerAsk(yes) {
  const resolve = askPending; askPending = null;
  closeModal('askDialog');
  if (resolve) resolve(yes);
}
function offerGameRestart(u) {
  const names = (u.newChars || []).join(', ');
  return ask({ title: t('gamedata_title'), text: t(names ? 'gamedata_new_chars' : 'gamedata_updated', { names }), ok: t('restart_now'), cancel: t('later') })
    .then(yes => { if (yes) { flushSave(); invoke('restart_app'); } });
}
/* Copie « avant opération » de l'état actuel : appeler AVANT de modifier S (l'état est figé ici) */
function backup(reason) {
  const json = JSON.stringify(S);
  backups = null;
  return invoke('backup_state', { reason, json }).catch(() => { /* la copie ne doit pas bloquer l'opération */ });
}
function save() {
  resetCaches();   // l'état a changé (persos possédés, profils, reliques, langue…)
  clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 300);
}
const flushPending = () => { if (saveTimer) flushSave(); };
window.addEventListener('pagehide', flushPending);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushPending(); });

/* ------------------------------------------------------------------ helpers */
function t(k, vars) {
  let s = (I18N[S.lang] && I18N[S.lang][k]) ?? I18N.en[k] ?? k;
  if (vars) for (const v in vars) s = s.split('{' + v + '}').join(vars[v]);
  return s;
}
const locale = () => S.lang === 'fr' ? 'fr-FR' : 'en-US';
const fmt = n => Math.round(n).toLocaleString(locale()).replace(/ /g, ' ');  // la police n'a pas l'espace fine
const pct = (n, d = 1) => (n * 100).toLocaleString(locale(), { maximumFractionDigits: d }) + ' %';
const allChars = () => BASE_CHARS.concat(S.custom);
const charById = id => BASE_CHARS.find(c => c.id === id) || S.custom.find(c => c.id === id);
const ownedChars = () => allChars().filter(c => S.owned[c.id]);

/* ---- images & données du jeu (js/assets.js intégré, ou version téléchargée : src-tauri/src/gamedata) ---- */
// données téléchargées par l'app (injectées par src-tauri/src/lib.rs) ou, à défaut, celles intégrées à l'exe
const G = window.__HSR_GAME__ || (typeof GAME !== 'undefined' ? GAME : { chars: [], elements: {}, paths: {}, pathMats: {}, items: {}, relicSets: {}, special: {}, aliases: {} });
// liste écrite à la main + persos sortis depuis (js/gamechars.js)
const BASE_CHARS = mergeGameChars(CHARACTERS, G.chars, DEFAULT_PROFILE_BY_PATH);
const norm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const gameIndex = new Map(G.chars.map(g => [g.key, g]));
const findGameChar = c => gameIndex.get(norm(c.name) + '|' + c.element) || gameIndex.get(norm(c.fr) + '|' + c.element)
  || gameIndex.get(norm(c.name.replace(/\s*\(.*\)\s*$/, '')) + '|' + c.element);  // ex. « March 7th (Hunt) » → March 7th Imaginaire
// mémorisé par perso : appelé très souvent (noms, tris, avatars) et les persos ne sont jamais modifiés
const gameCharCache = new WeakMap();
const gameChar = c => {
  if (!c) return c;
  if (!gameCharCache.has(c)) gameCharCache.set(c, findGameChar(c));
  return gameCharCache.get(c);
};
const imgUrl = p => (typeof ASSET_BASE !== 'undefined' ? ASSET_BASE : '') + p;
const img = (p, cls, alt = '') => p ? `<img class="${cls}" src="${esc(imgUrl(p))}" alt="${esc(alt)}" loading="lazy">` : '';
// image introuvable : retirée (écouteur global plutôt qu'un onerror en ligne, que la CSP interdit)
document.addEventListener('error', e => { if (e.target instanceof HTMLImageElement) e.target.remove(); }, true);
const itemName = id => G.items[id] ? G.items[id][S.lang === 'fr' ? 1 : 0] : '';
const itemImg = id => G.items[id] ? img(G.items[id][2], 'item-ico', itemName(id)) : '';
const elIcon = e => img(G.elements[e], 'ico');
const pathIcon = p => img(G.paths[p], 'ico path-ico');

const charName = c => {
  if (!c) return '?';
  if (S.lang === 'fr') { const g = gameChar(c); return (g && g.fr) || c.fr || c.name; }
  return c.name;
};
const byName = (a, b) => charName(a).localeCompare(charName(b));
const profileOf = c => (S.owned[c.id] && S.owned[c.id].profile) || (S.profiles && S.profiles[c.id]) || c.profile || DEFAULT_PROFILE_BY_PATH[c.path];
const statLabel = s => s.startsWith('dmg_') ? t('dmg_boost', { el: t('el_' + s.slice(4)) }) : t('stat_' + s);
const opt = (val, label, sel) => `<option value="${esc(val)}" ${String(val) === String(sel) ? 'selected' : ''}>${esc(label)}</option>`;
const elChip = e => `<span class="el-chip ${G.elements[e] ? 'has-ico' : ''}" style="--el:${EL_COLORS[e]}">${elIcon(e)}${t('el_' + e)}</span>`;
const pathTag = p => `<span class="path-tag">${pathIcon(p)}${t('path_' + p)}</span>`;
const initials = c => charName(c).replace(/[^A-Za-zÀ-ÿ0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const avatar = (c, cls = '') => {
  const g = gameChar(c);
  return `<div class="avatar ${cls} r${c.rarity}" style="--el:${EL_COLORS[c.element]}" title="${esc(charName(c))}"><span>${esc(initials(c))}</span>${g ? img(g.icon, 'av-img') : ''}</div>`;
};

/* Caches de calculs coûteux, valables tant que l'état ne change pas (vidés par save() et render()) */
let charOptionsCache = null;        // <option> de tous les persos, triés et groupés
let relicScores = new WeakMap();    // relique → [profil, note, profil deviné ?]
let relicGrades = null;             // id de perso → note moyenne de ses reliques
let gameIdIndex = null;             // id du jeu → perso
function resetCaches() { charOptionsCache = null; relicScores = new WeakMap(); relicGrades = null; gameIdIndex = null; }

// la liste des persos est construite une fois, puis on coche juste l'option choisie
function charOptions(selected, { allowEmpty = false, emptyLabel = '—' } = {}) {
  if (!charOptionsCache) {
    const owned = ownedChars().sort(byName);
    const others = allChars().filter(c => !S.owned[c.id]).sort(byName);
    charOptionsCache = (owned.length ? `<optgroup label="${esc(t('owned_group'))}">${owned.map(c => opt(c.id, charName(c))).join('')}</optgroup>` : '')
      + `<optgroup label="${esc(owned.length ? t('others_group') : t('all_chars'))}">${others.map(c => opt(c.id, charName(c))).join('')}</optgroup>`;
  }
  let h = charOptionsCache;
  if (selected) h = h.replace(`<option value="${esc(selected)}" >`, `<option value="${esc(selected)}" selected>`);
  return (allowEmpty ? opt('', emptyLabel, selected || '') : '') + h;
}

/* ------------------------------------------------------------------ rendu global */
const TABS = ['today', 'roster', 'planner', 'warps', 'relics', 'teams', 'news', 'settings'];
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TAB_ICONS = {
  today: svg('<rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><circle cx="12" cy="14.5" r="2"/>'),
  roster: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.8 14.2c2.4.1 4.1 1.7 4.7 4.3"/>'),
  planner: svg('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>'),
  warps: svg('<path d="M12 2.5 14 10l7.5 2-7.5 2-2 7.5-2-7.5L2.5 12 10 10z"/>'),
  relics: svg('<path d="M12 3 19 8l-2.6 9H7.6L5 8z"/><path d="M5 8h14M9.5 8 12 17l2.5-9"/>'),
  teams: svg('<path d="M4 20 15 9M15 9l1.5-4.5L21 3l-1.5 4.5zM6 14l4 4M20 20 9 9M9 9 7.5 4.5 3 3l1.5 4.5zM18 14l-4 4"/>'),
  news: svg('<path d="M4 5h12v14H6a2 2 0 0 1-2-2z"/><path d="M16 9h4v8a2 2 0 0 1-2 2h-2M7 9h6M7 12h6M7 15h4"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>')
};
const RENDERERS = {};   // onglet → fonction de rendu, rempli par main.js (les onglets sont dans leurs fichiers)

let shownTab = null;    // onglet affiché : la cascade d'entrée ne se joue qu'en changeant d'onglet
function render() {
  document.documentElement.lang = S.lang;
  $('#langSelect').value = S.lang;
  renderTabs();
  resetCaches();
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  renderNetBadge();
  RENDERERS[S.tab]($('#view'));
  if (shownTab !== S.tab) { shownTab = S.tab; enterView(); }
}

/* ------------------------------------------------------------------ animations
   Tout est désactivé si Windows est réglé sur « réduire les animations » (voir aussi style.css). */
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let enterTimer = null;
/* Panneaux de l'onglet qui apparaissent en cascade, puis grands chiffres qui défilent */
function enterView() {
  const v = $('#view');
  v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
  clearTimeout(enterTimer); enterTimer = setTimeout(() => v.classList.remove('enter'), 900);
  countUpIn(v);
}
/* Les éléments [data-count] montent de 0 à leur valeur (data-fmt="pct" : probabilité affichée en %) */
function countUpIn(root) {
  if (reduceMotion()) return;
  for (const el of root.querySelectorAll('[data-count]')) {
    const to = Number(el.dataset.count), pctFmt = el.dataset.fmt === 'pct';
    if (!isFinite(to) || to <= 0) continue;
    const show = x => { el.textContent = pctFmt ? pct(x, 1) : fmt(x); };
    const t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / 700), e = 1 - Math.pow(1 - p, 3);
      show(p < 1 ? (pctFmt ? to * e : Math.round(to * e)) : to);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
/* Ciel étoilé vivant : petites étoiles qui scintillent lentement, chacune à son rythme */
function startSky() {
  if (reduceMotion() || $('#sky')) return;
  const sky = document.createElement('div'); sky.id = 'sky'; sky.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 46; i++) {
    const st = document.createElement('i');
    if (i % 7 === 0) st.className = 'gold';
    st.style.left = (Math.random() * 100).toFixed(2) + '%';
    st.style.top = (Math.random() * 100).toFixed(2) + '%';
    st.style.animationDelay = (Math.random() * 6).toFixed(2) + 's';
    st.style.animationDuration = (4 + Math.random() * 5).toFixed(2) + 's';
    sky.appendChild(st);
  }
  document.body.prepend(sky);
}
let tabBarPos = null;   // position du trait doré sous l'onglet actif, pour le faire glisser au changement
/* barre d'onglets (point rouge sur Actus s'il y a du nouveau : hasUnseenNews, ui/news.js) */
function renderTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = TABS.map(k => `<button class="tab ${S.tab === k ? 'active' : ''}" data-action="tab" data-tab="${k}" title="${esc(t('tab_' + k))}">${TAB_ICONS[k]}<span>${t('tab_' + k)}</span>${k === 'news' && hasUnseenNews() && S.tab !== 'news' ? '<i class="tab-dot" aria-hidden="true"></i>' : ''}</button>`).join('') + '<span class="tab-bar" aria-hidden="true"></span>';
  const active = tabs.querySelector('.tab.active'), bar = tabs.querySelector('.tab-bar');
  if (!active) return;
  const to = { left: active.offsetLeft, width: active.offsetWidth, top: active.offsetTop + active.offsetHeight - 2 };
  if (tabBarPos && !reduceMotion()) {   // part de l'ancien onglet puis glisse vers le nouveau
    bar.style.transition = 'none';
    bar.style.left = tabBarPos.left + 'px'; bar.style.width = tabBarPos.width + 'px'; bar.style.top = tabBarPos.top + 'px';
    void bar.offsetWidth;
    bar.style.transition = '';
  }
  bar.style.left = to.left + 'px'; bar.style.width = to.width + 'px'; bar.style.top = to.top + 'px';
  tabBarPos = to;
}

function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el); setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2200);
}
function setLang(l) {
  S.lang = l; news = null; save(); render(); loadNews(false);   // les actus dépendent de la langue
  if (sheet) { const tab = sheet.tab; openSheet(sheet.id); sheet.tab = tab; renderSheet(); }
}

/* actions (data-action) : chaque fichier ajoute les siennes avec Object.assign ; main.js les branche */
const actions = {};

/* actions des boutons et listes (data-action), branchées dans main.js */
Object.assign(actions, {
  askYes: () => answerAsk(true),
  askNo: () => answerAsk(false),
  tab: b => { S.tab = b.dataset.tab; save(); render(); window.scrollTo({ top: 0 }); },
  lang: el => setLang(el.value),
});
