/* HSR Companion — onglet Paramètres
   Réglages, statut des données, copies, mise à jour de l'app. */
'use strict';

/* ================================================================== PARAMÈTRES */
function renderSettings(v) {
  const R = S.rates;
  const num = (k) => `<input type="number" data-bind="rates.${k}" value="${R[k]}" min="0.1" step="0.1">`;
  v.innerHTML = `
  <section class="panel">
    <h2>${t('settings_title')}</h2>
    <label class="field">${t('language')}<select id="langSelect2" data-action="lang">${opt('fr', 'Français', S.lang)}${opt('en', 'English', S.lang)}</select></label>
    <label class="field">${t('server')}<select data-action="setServer">
      ${opt('', t('server_auto', { s: t('server_' + (serverOfUid(S.uid) || 'europe')) }), S.server)}
      ${['europe', 'america', 'asia', 'tw'].map(k => opt(k, t('server_' + k), S.server)).join('')}</select></label>
    <p class="hint small">${t('server_hint')}</p>
  </section>
  <section class="panel">
    <h3>${t('rates_title')}</h3>
    <p class="hint">${t('rates_hint')}</p>
    <div class="field-grid">
      <label class="field">${t('rate_exp')}${num('exp')}</label>
      <label class="field">${t('rate_lc_exp')}${num('lcExp')}</label>
      <label class="field">${t('rate_credits')}${num('credits')}</label>
      <label class="field">${t('rate_crimson')}${num('crimson')}</label>
      <label class="field">${t('rate_shadow')}${num('shadow')}</label>
      <label class="field">${t('rate_echo')}${num('echo')}</label>
    </div>
    <button class="btn sm" data-action="resetRates">${t('reset_rates')}</button>
  </section>
  <section class="panel">
    <h3>${t('data_title')}</h3>
    <p class="hint">${t('data_hint')}</p>
    <div class="form-row">
      <button class="btn" data-action="exportData">${svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>')}${t('export')}</button>
      <label class="btn">${svg('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>')}${t('import')}<input type="file" id="importFile" accept=".json,application/json" hidden></label>
      <button class="btn danger" data-action="resetData">${t('reset_all')}</button>
    </div>
  </section>
  ${dataStatusPanel()}
  <section class="panel">
    <h3>${t('backups_title')}</h3>
    <p class="hint">${t('backups_hint')}</p>
    ${backupList()}
  </section>
  <section class="panel">
    <h3>${t('app_update_title')}</h3>
    <p class="hint">${appVersion ? esc(t(APP.dev ? 'app_version_dev' : 'app_version', { v: appVersion })) : ''} ${t('app_update_hint')}</p>
    <button class="btn sm" data-action="checkAppUpdate">${t('app_update_check')}</button>
  </section>
  <section class="panel">
    <h3>${t('about_title')}</h3>
    <p class="hint">${t('about_text')}</p>
  </section>`;
}

function dataStatusPanel() {
  const st = gameStatus, fmtDay = ts => new Date(ts).toLocaleDateString(locale());
  let game = t('status_loading'), gameExtra = '';
  if (st) {
    game = (st.downloaded && st.updatedAt ? t('status_game_downloaded', { date: fmtDay(st.updatedAt) }) : t('status_game_embedded'))
      + ' · ' + t('status_checked', { ago: ago(st.checkedAt) });
    if (st.failedAt && (!st.checkedAt || st.failedAt > st.checkedAt)) gameExtra += `<p class="note warn">${esc(t('status_failed', { ago: ago(st.failedAt), e: st.error || t('err_unknown') }))}</p>`;
    if (gameDataAlert(st, Date.now(), STARTED_AT) === 'pending') gameExtra += `<p class="note warn">${t('status_pending')} <button class="btn sm" data-action="restartApp">${t('status_restart')}</button></p>`;
  }
  const newsLine = news && news.fetchedAt ? t('status_fetched_f', { ago: ago(news.fetchedAt) }) + (news.stale ? ' · ' + t('cones_offline') : '')
    : newsError ? t('status_news_error') : t('status_loading');
  const pr = prydwenSummary(rankings.values());
  const prLine = pr.fetchedAt ? t('status_fetched_m', { ago: ago(pr.fetchedAt) }) + (pr.stale ? ' · ' + t('cones_offline') : '') : t('status_prydwen_none');
  const row = (label, line, extra = '') => `<li><b>${t(label)}</b><span>${esc(line)}</span>${extra}</li>`;
  return `<section class="panel" id="dataStatus">
    <h3>${t('status_title')}</h3>
    <p class="hint">${t('status_hint')}</p>
    <ul class="status-list">${row('status_game', game, gameExtra)}${row('status_news', newsLine)}${row('status_prydwen', prLine)}</ul>
    <button class="btn sm" data-action="checkDataNow" ${checkingData ? 'disabled' : ''}>${t(checkingData ? 'status_checking' : 'status_check')}</button>
  </section>`;
}
function backupList() {
  if (!backups) {
    invoke('list_backups').then(l => { backups = l; if (S.tab === 'settings') render(); }).catch(() => { backups = []; if (S.tab === 'settings') render(); });
    return `<p class="hint small">${t('backups_loading')}</p>`;
  }
  if (!backups.length) return `<p class="hint small">${t('backups_none')}</p>`;
  return `<ul class="backup-list">${backups.map(b => `<li>
    <span>${esc(new Date(b.at).toLocaleString(locale()))}</span>
    <span class="hint">${esc(t(b.kind === 'daily' ? 'backup_daily' : 'backup_r_' + b.reason))}</span>
    <button class="btn sm" data-action="restoreBackup" data-id="${esc(b.id)}">${t('backup_restore')}</button></li>`).join('')}</ul>`;
}
async function restoreBackup(id) {
  const b = (backups || []).find(x => x.id === id);
  if (!b || !await ask({ title: t('backup_restore'), text: t('backup_confirm', { date: new Date(b.at).toLocaleString(locale()) }), ok: t('backup_restore') })) return;
  try {
    const d = JSON.parse(await invoke('read_backup', { id }));   // lu avant la copie « restore » (qui peut supprimer la plus ancienne)
    await backup('restore');
    S = migrate(merge(defaultState(), d)); S.tab = 'settings';
    save(); render(); toast(t('backup_done'));
  } catch (e) { toast(String(e) || t('err_unknown')); }
}

/* ---------------------------------------------------------- mise à jour de l'app (appupdate.rs) */
const APP = window.__HSR_APP__ || {};   // injecté par lib.rs : { version, dev }
let appVersion = APP.version || '';   // version installée (aussi renvoyée par la vérification en ligne)
/* Vérifie s'il existe une version plus récente sur GitHub et propose de l'installer.
   manual : clic sur « Rechercher une mise à jour » (on dit aussi quand l'app est à jour ou hors ligne).
   Renvoie true si une mise à jour a été proposée (pour ne pas enchaîner une autre question au lancement). */
function checkAppUpdate(manual) {
  return invoke('app_update_check').then(u => {
    setNet('app', true);
    if (u.current && u.current !== appVersion) { appVersion = u.current; if (S.tab === 'settings') render(); }
    if (!u.available) { if (manual) toast(t('app_update_none')); return false; }
    // notes de la release : texte brut, échappé (retours à la ligne gardés par .ask-notes)
    const notes = u.notes ? `<p class="ask-notes">${esc(u.notes.slice(0, 600))}</p>` : '';
    ask({ title: t('app_update_ask_title'), text: t('app_update_found', { v: u.available, cur: u.current }), html: notes, ok: t('app_update_install'), cancel: t('later') })
      .then(yes => {
        if (!yes) return;
        flushSave(); toast(t('app_update_downloading'));
        invoke('app_update_install').catch(e => toast(String(e)));
      });
    return true;
  }).catch(e => { setNet('app', false); if (manual) toast(String(e)); return false; });   // hors ligne : on réessaiera au prochain lancement
}

/* actions des boutons et listes (data-action), branchées dans main.js */
Object.assign(actions, {
  setServer: el => { S.server = el.value; save(); render(); },
  checkAppUpdate: () => checkAppUpdate(true),
  restoreBackup: b => restoreBackup(b.dataset.id),
  openStatus: () => { S.tab = 'settings'; save(); render(); const el = $('#dataStatus'); if (el) el.scrollIntoView({ block: 'start' }); },
  restartApp: () => { flushSave(); invoke('restart_app'); },
  checkDataNow: () => {
    if (checkingData) return;
    checkingData = true; render();
    loadNews(true);
    invoke('game_data_update', { force: true })
      .then(u => { setNet('game', true); if (u && u.updated) offerGameRestart(u); else toast(t('status_game_uptodate')); })
      .catch(() => { setNet('game', false); toast(t('status_check_failed')); })
      .finally(() => { checkingData = false; loadGameStatus(); });
  },
  resetRates: () => { S.rates = { ...DEFAULT_RATES }; save(); render(); },
  exportData: () => invoke('export_data', { name: `hsr-companion-${today()}.json`, content: JSON.stringify(S, null, 2) })   // « Enregistrer sous… »
    .then(p => p && toast(p)).catch(e => toast(String(e))),
  resetData: async () => {
    if (!await ask({ title: t('reset_all'), text: t('confirm_reset'), ok: t('reset_all'), danger: true })) return;
    backup('reset');
    const lang = S.lang; S = defaultState(); S.lang = lang; S.tab = 'settings'; save(); render();
  },
});
