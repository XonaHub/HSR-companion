/* HSR Companion — onglet Actus
   Annonces officielles HoYoLAB regroupées par version. */
'use strict';

/* ================================================================== ACTUS (annonces officielles HoYoLAB)
   Le fil est préparé par le backend (src-tauri/src/news) : versions avec bannières, événements, patch note.
   Rien ne vient de sites tiers ; l'estimation des vœux est calculée par js/estimate.js. */
let news = null;        // dernier fil reçu (NewsFeed) dans la langue de l'app
let newsError = '';
let newsLoading = false;
const idNewer = (a, b) => a.length !== b.length ? a.length > b.length : a > b;   // ids trop grands pour Number
const hasUnseenNews = () => !!(news && news.latestId && idNewer(news.latestId, S.newsSeen || ''));

/* Affiche d'abord le dernier fil enregistré (sans réseau), puis le rafraîchit.
   force : ignorer le cache récent (bouton « Actualiser ») */
/* Redessine ce qui affiche les actus : l'onglet Actus, l'accueil, ou seulement le point de l'onglet */
function newsArrived() {
  if (S.tab === 'news') renderNews($('#view'));
  else if (S.tab === 'today') { renderTabs(); refreshToday(); }
  else if (S.tab === 'settings' && !typing()) render();   // ligne « Actus » du statut des données
  else renderTabs();
}
function loadNews(force) {
  if (newsLoading) return;
  newsLoading = true; newsError = '';
  const lang = S.lang;
  const shown = news ? Promise.resolve() : invoke('news_cached', { lang }).then(f => {
    if (f && lang === S.lang && !news) { news = f; newsArrived(); }
  }).catch(() => { /* pas de cache lisible : on attend le réseau */ });
  shown.then(() => invoke('news_feed', { lang, force: !!force })).then(f => { setNet('news', !f.stale); if (lang === S.lang) news = f; })
    .catch(e => { setNet('news', false); newsError = String(e); })
    .finally(() => {
      newsLoading = false;
      if (lang !== S.lang) return loadNews(false);   // langue changée pendant le chargement
      newsArrived();
    });
}

const dayOf = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
const monthOf = iso => iso ? new Date(iso.slice(0, 10) + 'T12:00:00Z').toLocaleDateString(locale(), { month: 'long', year: 'numeric' }) : '';
const started = x => !!x.start && Date.parse(x.start) <= Date.now();

/* Perso de l'app correspondant à un nom d'annonce (dans la langue de l'app), même élément */
function charForNews(item) {
  const n = normName(item.name);
  return allChars().find(c => (!item.element || c.element === item.element) && [c.name, c.fr, charName(c)].some(x => x && normName(x) === n));
}

function warpItemTag(i) {
  return `<span class="tag news-item r${i.rarity}">${i.rarity}★ ${esc(i.name)}${i.element ? ' ' + elChip(i.element) : ''}${i.path ? ' ' + pathTag(i.path) : ''}${i.rerun ? ` <small class="news-rerun">${t('news_rerun')}</small>` : ''}</span>`;
}

/* Résumé (bannières, événements, vœux) + détails + patch note complet d'une version */
function newsVersionBody(x) {
  const items = x.phases.flatMap(p => p.items);
  const five = items.filter(i => i.rarity === 5 && i.kind === 'char');
  const uniq = list => list.filter((i, k) => list.findIndex(j => j.name === i.name) === k);
  const est = estimateVersionPulls(x, { express: S.warp.express });
  const evJades = x.events.reduce((a, e) => a + e.jades, 0);
  const planBtns = uniq(five.filter(i => !i.rerun)).map(i => charForNews(i)).filter(Boolean)
    .map(c => `<button class="btn sm" data-action="newsPlanChar" data-id="${esc(c.id)}">${t('news_plan', { name: esc(charName(c)) })}</button>`).join('');
  const group = (phaseItems, kind, rarity, key) => {
    const list = phaseItems.filter(i => i.kind === kind && i.rarity === rarity);
    return list.length ? `<div class="news-group"><small>${t(key)}</small>${uniq(list).map(warpItemTag).join('')}</div>` : '';
  };
  const phaseDates = p => p.start || p.end ? ` · ${dayOf(p.start)} → ${dayOf(p.end)}` : '';
  return `
    <div class="news-grid">
      <div><small>${t('news_banners')}</small>
        ${five.length ? uniq(five).map(warpItemTag).join('') : `<p class="hint small">${t('news_banners_later')}</p>`}
        ${x.phases.length ? `<div class="form-row news-actions"><button class="btn sm" data-action="newsOpenWarps">${t('news_sim')}</button>${planBtns}</div>` : ''}
      </div>
      <div><small>${t('news_events')}</small>
        <b>${t('news_events_count', { n: x.events.length })}</b>
        ${evJades ? `<p class="hint small">${t('news_jades_listed', { j: fmt(evJades) })}</p>` : ''}
      </div>
      <div><small>${t('news_pulls')}</small>
        ${est ? `<b class="news-pulls">≈ <span data-count="${est.pulls}">${fmt(est.pulls)}</span> ${t('pulls')}</b><p class="hint small">${t('news_total', { j: fmt(est.jades), p: fmt(est.passes) })} · ${t('news_estimate')}</p>`
          : `<p class="hint small">${t('news_no_dates')}</p>`}
      </div>
    </div>
    <details class="news-more"><summary>${t('news_details')}</summary>
      ${x.phases.map(p => `<h4>${t('news_phase', { n: p.phase })}${phaseDates(p)}</h4>
        ${group(p.items, 'char', 5, 'news_chars5')}${group(p.items, 'lc', 5, 'news_lcs5')}${group(p.items, 'char', 4, 'news_chars4')}${group(p.items, 'lc', 4, 'news_lcs4')}`).join('')}
      ${x.events.length ? `<h4>${t('news_events')}</h4><ul class="news-events">${x.events.map(e => `<li><b>${esc(e.name)}</b>${e.jades || e.passes ? ` <small>${[e.jades ? fmt(e.jades) + ' ' + t('jades') : '', e.passes ? fmt(e.passes) + ' ' + t('passes') : ''].filter(Boolean).join(' · ')}</small>` : ''}</li>`).join('')}</ul>` : ''}
      ${est ? `<h4>${t('news_pulls')}</h4><table class="news-est">${est.lines.map(l => `<tr><td>${t('est_' + l.key, { d: est.days })}</td><td>${l.jades ? fmt(l.jades) + ' ' + t('jades') : ''}</td><td>${l.passes ? fmt(l.passes) + ' ' + t('passes') : ''}</td></tr>`).join('')}
        <tr class="total"><td>${t('news_pulls')}</td><td colspan="2">≈ ${fmt(est.pulls)} ${t('pulls')}</td></tr></table>
        <p class="hint small">${t('news_estimate_hint')}</p>` : ''}
    </details>
    ${x.sections.length ? `<details class="news-more"><summary>${t('news_patch')}</summary>
      ${x.sections.map(s => `${s.title ? `<h4>${esc(s.title)}</h4>` : ''}${s.items.map(i => `${i.title ? `<h5>${esc(i.title)}</h5>` : ''}${i.text ? `<p>${esc(i.text).replace(/\n/g, '<br>')}</p>` : ''}`).join('')}`).join('')}
    </details>` : ''}`;
}

function renderNews(v) {
  if (news && news.latestId && S.newsSeen !== news.latestId) { S.newsSeen = news.latestId; save(); }
  renderTabs();
  if (!news && !newsLoading && !newsError) loadNews(false);
  const head = `<div class="panel-head"><h2>${t('tab_news')}</h2>
    <button class="btn sm" data-action="newsRefresh" ${newsLoading ? 'disabled' : ''}>${t(newsLoading ? 'news_loading' : 'news_refresh')}</button></div>
    ${news && news.fetchedAt ? `<p class="hint small">${esc(t('news_fetched', { ago: ago(news.fetchedAt) }))}</p>` : ''}
    ${news && news.stale ? `<p class="note warn">${t('news_offline')}</p>` : ''}
    ${newsError && news ? `<p class="note warn">${t('news_error', { e: esc(newsError) })}</p>` : ''}`;
  if (!news) {
    v.innerHTML = `<section class="panel">${head}<p class="${newsError ? 'note warn' : 'hint'}">${newsError ? t('news_error', { e: esc(newsError) }) : t('news_loading')}</p></section>`;
    return;
  }
  const vers = news.versions;
  const current = currentVersion(vers, Date.now());   // même choix que « Aujourd'hui » (js/today.js)
  const upcoming = current ? vers.slice(0, vers.indexOf(current)) : vers.filter(x => !started(x));
  const previous = current ? vers.slice(vers.indexOf(current) + 1, vers.indexOf(current) + 11) : [];
  const soon = upcoming.reverse().map(x => `
    <h3>${t('news_soon')} · ${t('news_version', { v: x.version })}${x.start ? ' · ' + dayOf(x.start) : ''}</h3>
    ${x.name ? `<p class="news-name">« ${esc(x.name)} »</p>` : ''}
    ${x.phases.length ? newsVersionBody(x) : `<p class="hint small">${t('news_banners_later')}</p>`}`).join('');
  const announced = news.unattached.length ? `<div class="news-group"><small>${t('news_announced')}</small>${news.unattached.map(a => warpItemTag({ ...a, rarity: 5, kind: 'char' })).join('')}</div>` : '';
  v.innerHTML = `
  <section class="panel">${head}${!vers.length ? `<p class="empty">${t('news_none')}</p>` : ''}</section>
  ${newsEndgame()}
  ${soon || announced ? `<section class="panel news-soon">${soon}${announced}</section>` : ''}
  ${current ? `<section class="panel">
    <h3>${t('news_current')} · ${t('news_version', { v: current.version })}${current.end ? ' · ' + t('news_until', { d: dayOf(current.end) }) : ''}</h3>
    ${current.name ? `<p class="news-name">« ${esc(current.name)} »</p>` : ''}
    ${newsVersionBody(current)}
  </section>` : ''}
  ${previous.length ? `<section class="panel"><h3>${t('news_previous')}</h3>
    ${previous.map(x => `<details class="news-old"><summary><b>${esc(x.version)}</b> <span class="hint small">${esc(monthOf(x.start))}${x.name ? ' · « ' + esc(x.name) + ' »' : ''}</span>
      <span class="news-old-five">${[...new Set(x.phases.flatMap(p => p.items).filter(i => i.rarity === 5 && i.kind === 'char' && !i.rerun).map(i => i.name))].map(esc).join(', ')}</span></summary>
      ${newsVersionBody(x)}</details>`).join('')}
  </section>` : ''}`;
}

/* actions des boutons et listes (data-action), branchées dans main.js */
Object.assign(actions, {
  newsRefresh: () => loadNews(true),
  newsOpenWarps: () => { S.tab = 'warps'; save(); render(); window.scrollTo({ top: 0 }); },
  newsPlanChar: b => { S.plChar = b.dataset.id; S.tab = 'planner'; save(); render(); window.scrollTo({ top: 0 }); },
});
