/* HSR Companion — onglet Aujourd'hui
   Cartes de la page d'accueil (calculs dans js/today.js). */
'use strict';

/* ================================================================== AUJOURD'HUI
   Résumé des autres onglets (js/today.js) : mêmes calculs, donc mêmes chiffres. */
const todayCard = (tab, cls, icon, label, body) => `<button class="today-card ${cls}" data-action="tab" data-tab="${tab}">
    <small class="today-label">${icon}${esc(label)}</small>${body}</button>`;

function todayFarm() {
  const active = S.plans.filter(p => p.on !== false && charById(p.charId));   // même filtre que renderPlanner
  if (!active.length) return `<p class="today-big">${t('today_no_plan')}</p><span class="today-link">${t('today_go_planner')}</span>`;
  const miss = missingOf(active);
  const ft = farmTimes(miss, S.rates, new Date(), G.items);
  const i = farmFocus(ft.perPlan);
  if (i < 0) return `<p class="today-big">${t('today_all_done')}</p><span class="today-link">${t('today_go_planner')}</span>`;
  const c = charById(active[i].charId), f = ft.perPlan[i];
  const post = topPost(farmTp(miss[i], S.rates, G.items));
  const postText = post ? t('today_post_' + post.key, { path: t('path_' + c.path) }) : '';
  return `<div class="today-farm">${avatar(c)}
      <div class="today-who"><b>${esc(charName(c))}</b>${postText ? `<small>${t('today_do')} : ${esc(postText)}</small>` : ''}
        ${f.cumLimitedByWeekly ? `<small>${t('limited_weekly', { n: Math.ceil(f.cumWeeklyRuns / 3) })}</small>` : ''}</div>
      <div class="today-eta"><b>${etaText(f.cumDays, f.cumDate)}</b><small>${t('plan_energy_left')} : ${fmt(f.tp)}</small></div>
    </div>`;
}

function todayWarps() {
  const w = S.warp;
  return `<p class="today-big">${fmt(pullsNow(w, JADE_PER_PULL))} <small>${t('pulls')}</small></p>
    <small>${t('today_pity', { n: w.charPity })}${w.charGuar ? ' · ' + t('today_guaranteed') : ''}</small>`;
}

/* ---- Cycles de l'endgame (js/endgame.js) : mêmes fonctions pour Aujourd'hui, Actus et Vœux ---- */
const serverKey = () => S.server || serverOfUid(S.uid) || 'europe';
const egCycles = () => endgameCycles((news && news.versions) || [], SERVER_OFFSETS[serverKey()]);
const egPerMode = () => ({ moc: S.warp.egMoc, pf: S.warp.egPf, as: S.warp.egAs });
const EG_KEY = { moc: 'egMoc', pf: 'egPf', as: 'egAs' };
const fmtWhen = ms => new Date(ms).toLocaleString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDay = ms => new Date(ms).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });
const egIn = (ms, now) => { const h = (ms - now) / 3600000; return h < 24 ? t('eg_in_h', { n: Math.max(1, Math.ceil(h)) }) : t('eg_in_d', { n: Math.ceil(h / 24) }); };
const egServer = () => t('eg_server', { s: t('server_' + serverKey()) });

function todayEndgame(card) {
  const now = Date.now(), n = nextEndgameReset(endgameStatus(egCycles(), now));
  if (!n) return card('', t('eg_today'), `<small>${t('eg_unavailable')}</small>`);
  const c = n.cycle;
  return card('', t('eg_today'), `<p class="today-big">${esc(t('mode_' + n.mode))}</p>
    <small>${c.deduced ? t('eg_deduced') : esc(c.name)}</small>
    <small>${esc(fmtWhen(c.startMs))} · ${esc(egIn(c.startMs, now))} · ${t('eg_jades', { n: fmt(egPerMode()[n.mode] || 0) })}</small>
    <small class="eg-server">${esc(egServer())}</small>`);
}

function newsEndgame() {
  const now = Date.now(), st = endgameStatus(egCycles(), now);
  const cur = currentVersion((news && news.versions) || [], now);
  const theme = cur && cur.arbitration;
  const span = c => `${fmtDay(c.startMs)} – ${fmtDay(c.endMs)}`;
  const rows = ENDGAME_MODES.map(m => {
    const { current: c, next: x } = st[m];
    if (!c && !x) return '';
    return `<div class="eg-row">
      <b class="eg-mode">${esc(t('mode_' + m))}</b>
      <div>${c ? `<div class="eg-cur"><span>${c.deduced ? esc(t('eg_deduced')) : esc(c.name)}</span> <small>${span(c)} · ${t('eg_ends', { when: esc(egIn(c.endMs + 60000, now)) })}</small></div>
        ${c.effect ? `<p class="eg-effect">${esc(c.effect).replace(/\n/g, '<br>')}</p>` : ''}` : ''}
        ${x ? `<div class="eg-next"><small>${t('eg_next')} : ${x.deduced ? esc(t('eg_deduced')) : esc(x.name)} · ${esc(fmtWhen(x.startMs))} · ${esc(egIn(x.startMs, now))}</small></div>` : ''}</div>
    </div>`;
  }).join('');
  if (!rows && !theme) return `<section class="panel"><h3>${t('eg_title')}</h3><p class="hint small">${t('eg_unavailable')}</p></section>`;
  return `<section class="panel eg-panel"><h3>${t('eg_title')}</h3>
    ${rows || `<p class="hint small">${t('eg_unavailable')}</p>`}
    ${theme ? `<div class="eg-row"><b class="eg-mode">${t('eg_arbitration')}</b><div><span>${esc(theme)}</span> <small>${t('eg_no_jades')}</small></div></div>` : ''}
    <p class="lc-src">${t('eg_source')} · ${esc(egServer())}</p>
  </section>`;
}

/* Cartes tirées d'Actus (bannière, prochaine version, dernière actu) */
function todayNewsCards() {
  const card = (cls, label, body) => todayCard('news', cls, TAB_ICONS.news, label, body);
  if (!news) {   // pas encore chargé, ou hors ligne sans cache : l'accueil se redessine à l'arrivée (newsArrived)
    const msg = `<small>${newsError ? t('news_error', { e: esc(newsError) }) : t('news_loading')}</small>`;
    return card('', t('today_banner'), msg) + card('', t('today_next'), msg) + card('', t('eg_today'), msg) + card('wide', t('today_latest'), msg);
  }
  const now = Date.now(), vers = news.versions || [];
  const cur = currentVersion(vers, now), phase = currentPhase(cur, now);
  const five = phase ? phase.items.filter(i => i.rarity === 5).sort((a, b) => (a.kind === 'char' ? 0 : 1) - (b.kind === 'char' ? 0 : 1))
    .filter((i, k, l) => l.findIndex(j => j.name === i.name) === k) : [];
  const left = phase ? daysLeft(phase.end || (cur && cur.end), now) : null;
  const banner = five.length
    ? `<div class="today-tags">${five.map(warpItemTag).join('')}</div>${left != null ? `<small>${t('today_ends_in', { n: left })}</small>` : ''}`
    : `<small>${t('today_banner_none')}</small>`;
  const next = nextVersion(vers, now);
  const nextBody = next && (next.start
    ? `<p class="today-big">${esc(next.version)}</p><small>${t('today_next_on', { d: dayOf(next.start).slice(0, 5), n: daysUntil(next.start, now) })}</small>`
    : `<p class="today-big">${esc(next.version)}</p><small>${t('today_next_undated')}</small>`);
  const last = latestNews(vers);
  const lastBody = last
    ? `<p><b>${t('news_version', { v: esc(last.version) })}</b>${last.name ? ` « ${esc(last.name)} »` : ''} · ${last.announced ? t('today_latest_five', { n: last.newFive }) : t('today_latest_later')}</p><span class="today-link">${t('today_go_news')}</span>`
    : `<small>${t('news_none')}</small>`;
  return card('', t('today_banner'), banner) + (next ? card('', t('today_next'), nextBody) : '') + todayEndgame(card) + card('wide', t('today_latest'), lastBody);
}

function renderToday(v) {
  v.innerHTML = `<section class="panel today">
    <div class="panel-head"><h2>${t('tab_today')}</h2></div>
    <div class="today-grid">
      ${todayCard('planner', 'wide', TAB_ICONS.planner, t('today_farm'), todayFarm())}
      ${todayCard('warps', '', TAB_ICONS.warps, t('today_warps'), todayWarps())}
      ${todayNewsCards()}
    </div>
  </section>`;
}

/* Déplace le plan from avant ou après le plan to */
function movePlan(plans, from, to, after) {
  if (from === to) return plans;
  const moved = plans.find(p => p.id === from);
  if (!moved) return plans;
  const rest = plans.filter(p => p.id !== from), i = rest.findIndex(p => p.id === to);
  if (i < 0) return plans;
  rest.splice(i + (after ? 1 : 0), 0, moved);
  return rest;
}

/* f : temps et manque de ce plan dans l'ordre des plans actifs (renderPlanner), absent si le plan est désactivé */
function planCard(p, f) {
  const c = charById(p.charId);
  if (!c) return `<div class="plan-card off" draggable="true" data-id="${p.id}"><span>${t('unknown_char')}</span><button class="btn sm danger" data-action="delPlan" data-id="${p.id}">${t('delete')}</button></div>`;
  const st = planStart(p, S.owned[c.id]), res = computePlan(p);
  const part = (label, from, to) => from >= to ? `${label} ${to} ✓ ${t('done')}` : `${label} ${from}→${to}`;
  const tr = Object.entries(planTr(p)).map(([a, [fr, to]]) => part(abLabel(a, true), st.tr[a] != null ? st.tr[a] : fr, to)).join(' · ') + (p.bonus !== false ? ' · ' + t('bonus_short') : '');
  const eq = equippedCone(c.id), gC = eq && coneOf(G.lightCones || [], eq.id), lcOk = !!gC;
  const lcOn = !!(p.lc && p.lc.on) && lcOk;
  let time = '';
  if (f) {
    if (res && res.done) time = `<b class="plan-done">${t('done')}</b>`;
    else {
      const lim = f.cumLimitedByWeekly ? `<small>${t('limited_weekly', { n: Math.ceil(f.cumWeeklyRuns / 3) })}</small>` : '';
      time = `<span class="plan-tp">${t('plan_energy_left')} : <b>${fmt(f.tp)}</b></span>
        <span class="plan-eta">${f.tp <= 0 && f.cumDays <= 0 ? t('covered') : etaText(f.cumDays, f.cumDate)} <em>(${t('cumulative')})</em></span>${lim}`;
    }
  }
  const tot = f ? aggregate([p], true, [f.miss]) : aggregate([p]);
  const lcWhy = t(eq ? 'lc_unknown' : 'lc_no_cone');
  return `<details class="plan-card ${p.on === false ? 'off' : ''}" draggable="true" data-id="${p.id}">
    <summary>
      <span class="drag-grip" aria-hidden="true">⋮⋮</span>
      ${avatar(c, 'sm')}
      <div class="plan-info"><b>${esc(charName(c))}</b><small>${part(t('lvl'), st.lvl, p.lvTo)} · ${tr}${lcOn ? ` · ${esc(t('lc_short'))} → ${p.lc.lvTo}` : ''}</small>${time ? `<div class="plan-time">${time}</div>` : ''}</div>
      <label class="check" title="${esc(t('include'))}"><input type="checkbox" data-action="togglePlan" data-id="${p.id}" ${p.on !== false ? 'checked' : ''}></label>
      <button class="btn sm danger" data-action="delPlan" data-id="${p.id}" title="${esc(t('delete'))}">×</button>
    </summary>
    <label class="check lc-card"><input type="checkbox" data-action="togglePlanLc" data-id="${p.id}" ${lcOn ? 'checked' : ''} ${lcOk ? '' : 'disabled'}> ${t('include_lc')} <small>${esc(lcOk ? coneName(gC, eq.name) : lcWhy)}</small></label>
    <label class="field lc-card">${t('lc_to')} <select data-action="planLcTo" data-id="${p.id}" ${lcOn ? '' : 'disabled'}>${LEVELS.map(l => opt(l, l, p.lc ? p.lc.lvTo : 80)).join('')}</select></label>
    ${f ? `<p class="hint small">${t('plan_mats_hint')}</p>` : ''}
    ${matTable(matRows(tot, !!f))}
  </details>`;
}
