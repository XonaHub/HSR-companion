/* HSR Companion — onglet Vœux
   Jades, pity, estimation, simulateur, historique des 5★. */
'use strict';

/* ================================================================== VŒUX */
const availablePulls = () => {
  const w = S.warp;
  // nouveaux cycles d'endgame avant la date visée, selon ce que le joueur obtient d'habitude (js/endgame.js)
  const now = Date.now(), eg = endgameJadesBetween(egCycles(), now, now + w.days * 86400000, egPerMode());
  const income = w.days * (60 + (w.express ? 90 : 0)) + w.extra + eg.jades;
  return { pulls: pullsNow({ jades: w.jades + income, passes: w.passes }, JADE_PER_PULL), income, eg };   // même formule que « Aujourd'hui »
};

function renderWarps(v) {
  const w = S.warp;
  const num = (path, val, min, max, step = 1) => `<input type="number" data-bind="${path}" value="${val}" min="${min}" ${max != null ? `max="${max}"` : ''} step="${step}">`;
  const chk = (path, val) => `<input type="checkbox" data-bind="${path}" ${val ? 'checked' : ''}>`;
  v.innerHTML = `
  <div class="cols">
    <section class="panel">
      <h2>${t('warp_resources')}</h2>
      <div class="field-grid">
        <label class="field">${t('jades')}${num('warp.jades', w.jades, 0)}</label>
        <label class="field">${t('passes')}${num('warp.passes', w.passes, 0)}</label>
        <label class="field">${t('days_until')}${num('warp.days', w.days, 0, 365)}</label>
        <label class="field">${t('extra_income')}${num('warp.extra', w.extra, 0)}</label>
        <label class="check span2">${chk('warp.express', w.express)} ${t('express_pass')}</label>
      </div>
      <h4>${t('eg_warp_title')}</h4>
      <p class="hint small">${t('eg_warp_hint')}</p>
      <div class="field-grid eg-warp">${ENDGAME_MODES.map(m => {
        const k = EG_KEY[m], val = w[k], preset = val === 900 ? '900' : val === 800 ? '800' : 'custom';
        return `<label class="field">${t('mode_' + m)}
          <select data-action="egPreset" data-key="${k}">${opt('900', t('eg_opt_full'), preset)}${opt('800', t('eg_opt_stars'), preset)}${opt('custom', t('eg_opt_custom'), preset)}</select>
          ${num('warp.' + k, val, 0, 900, 10)}</label>`;
      }).join('')}</div>
      <div class="stat-big"><span>${t('pulls_available')}</span><b id="pullsAvail"></b><small id="incomeInfo"></small></div>
    </section>
    <section class="panel">
      <h2>${t('warp_pity')}</h2>
      <div class="field-grid">
        <label class="field">${t('char_pity')}${num('warp.charPity', w.charPity, 0, 89)}</label>
        <label class="check">${chk('warp.charGuar', w.charGuar)} ${t('guaranteed')}</label>
        <label class="field">${t('lc_pity')}${num('warp.lcPity', w.lcPity, 0, 79)}</label>
        <label class="check">${chk('warp.lcGuar', w.lcGuar)} ${t('guaranteed')}</label>
      </div>
      <div class="pity-bars" id="pityBars"></div>
      <p class="hint small">${t('pity_hint')}</p>
    </section>
  </div>
  <section class="panel">
    <h2>${t('warp_sim')}</h2>
    <p class="hint">${t('sim_hint')}</p>
    <div class="form-row">
      <label class="field">${t('target_char')}<select data-bind="warp.targetChar">${range(0, 7).map(i => opt(i, i === 0 ? t('none') : 'E' + (i - 1), w.targetChar)).join('')}</select></label>
      <label class="field">${t('target_lc')}<select data-bind="warp.targetLc">${range(0, 5).map(i => opt(i, i === 0 ? t('none') : 'S' + i, w.targetLc)).join('')}</select></label>
      <button class="btn primary" data-action="simulate">${t('simulate')}</button>
    </div>
    <div id="simOut"></div>
  </section>
  <section class="panel">
    <h2>${t('history')}</h2>
    <div class="import-box">
      <b>${t('gacha_import_title')}</b>
      <ol class="steps">
        <li>${t('gacha_step2')}</li>
        <li>${t('gacha_step3')}</li>
      </ol>
      <p class="hint small">${t('gacha_import_hint')}</p>
      <div class="form-row">
        <button class="btn primary" data-action="gachaAuto">${t('gacha_auto')}</button>
        <input id="gachaUrl" class="grow" placeholder="${esc(t('gacha_url_ph'))}">
        <button class="btn" data-action="gachaUrl">${t('gacha_import')}</button>
      </div>
      <div id="gachaOut">${S.gachaAt ? `<p class="hint small">${t('gacha_last', { d: new Date(S.gachaAt).toLocaleString(locale()) })}</p>` : ''}</div>
    </div>
    <p class="hint">${t('history_hint')}</p>
    <div class="form-row">
      <input type="date" id="whDate" value="${today()}">
      <select id="whBanner">${['char', 'lc', 'std'].map(b => opt(b, t('banner_' + b))).join('')}</select>
      <input id="whName" list="charList" placeholder="${esc(t('name'))}">
      <datalist id="charList">${allChars().map(c => `<option value="${esc(charName(c))}">`).join('')}</datalist>
      <input type="number" id="whPity" min="1" max="90" placeholder="${esc(t('pity'))}" class="w80">
      <select id="whResult">${['won', 'lost', 'guar', 'na'].map(r => opt(r, t('res_' + r))).join('')}</select>
      <label class="check"><input type="checkbox" id="whUpdate" checked> ${t('update_pity')}</label>
      <button class="btn primary" data-action="addWish">${t('add')}</button>
    </div>
    ${historyBlock()}
  </section>`;
  updateWarpDerived();
}

function historyBlock() {
  const h = S.history.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  if (!h.length) return `<p class="empty">${t('no_history')}</p>`;
  const withPity = h.filter(x => x.pity > 0);
  const avg = withPity.length ? withPity.reduce((s, x) => s + x.pity, 0) / withPity.length : 0;
  const fifty = h.filter(x => x.result === 'won' || x.result === 'lost');
  const won = fifty.filter(x => x.result === 'won').length;
  return `<div class="stats-row">
    <div class="stat"><b>${h.length}</b><span>${t('total_5')}</span></div>
    <div class="stat"><b>${avg ? avg.toFixed(1) : '—'}</b><span>${t('avg_pity')}</span></div>
    <div class="stat"><b>${fifty.length ? pct(won / fifty.length, 0) : '—'}</b><span>${t('winrate', { w: won, n: fifty.length })}</span></div>
    ${S.gachaTotals ? `<div class="stat"><b>${fmt(Object.values(S.gachaTotals).reduce((a, b) => a + b, 0))}</b><span>${t('total_pulls')}</span></div>` : ''}
  </div>
  <table class="data-table"><thead><tr><th>${t('date')}</th><th>${t('banner')}</th><th>${t('name')}</th><th>${t('pity')}</th><th>${t('result')}</th><th></th></tr></thead>
  <tbody>${h.map(x => `<tr><td>${esc(x.date)}</td><td>${t('banner_' + x.banner)}</td><td><b>${esc(x.name)}</b></td>
    <td><span class="pity-pill ${x.pity >= 75 ? 'hi' : x.pity && x.pity <= 50 ? 'lo' : ''}">${x.pity || '—'}</span></td>
    <td><span class="res res-${x.result}">${t('res_' + x.result)}</span></td>
    <td><button class="btn sm danger" data-action="delWish" data-id="${x.id}">×</button></td></tr>`).join('')}</tbody></table>`;
}

function updateWarpDerived() {
  const el = $('#pullsAvail'); if (!el) return;
  const { pulls, income, eg } = availablePulls();
  el.textContent = fmt(pulls); el.dataset.count = pulls;
  $('#incomeInfo').textContent = (income ? t('income_info', { j: fmt(income) }) : '')
    + (eg.count ? ' · ' + t('income_endgame', { j: fmt(eg.jades), n: eg.count }) : '');
  const w = S.warp;
  const bar = (label, val, max, soft) => `<div class="pity-bar"><div class="pb-label"><span>${label}</span><b>${val} / ${max}</b></div>
    <div class="pb-track"><div class="pb-soft" style="left:${soft / max * 100}%"></div><div class="pb-fill ${val >= soft ? 'soft' : ''}" style="width:${val / max * 100}%"></div></div></div>`;
  $('#pityBars').innerHTML = bar(t('banner_char'), w.charPity, 90, 74) + bar(t('banner_lc'), w.lcPity, 80, 66);
}

function simulate() {
  const w = S.warp, N = 20000, P = availablePulls().pulls;
  const tc = +w.targetChar, tl = +w.targetLc;
  const out = $('#simOut');
  const charAt = Array.from({ length: 8 }, () => new Int32Array(N));
  const need = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    let pity = w.charPity, g = w.charGuar, pulls = 0, got = 0;
    while (got < 7) {
      pulls++; pity++;
      if (Math.random() < charRate(pity)) { pity = 0; if (g || Math.random() < 0.5) { got++; g = false; charAt[got][i] = pulls; } else g = true; }
    }
    let lp = w.lcPity, lg = w.lcGuar, lpulls = 0, lgot = 0;
    while (lgot < tl) {
      lpulls++; lp++;
      if (Math.random() < lcRate(lp)) { lp = 0; if (lg || Math.random() < 0.75) { lgot++; lg = false; } else lg = true; }
    }
    need[i] = (tc > 0 ? charAt[tc][i] : 0) + lpulls;
  }
  const probAt = arr => { let c = 0; for (let i = 0; i < N; i++) if (arr[i] <= P) c++; return c / N; };
  const jadesFor = n => fmt(Math.max(0, n - P) * JADE_PER_PULL);
  let html = '';
  if (tc > 0 || tl > 0) {
    const sorted = need.slice().sort(), quant = q => sorted[Math.min(N - 1, Math.floor(q * N))];
    const p = probAt(need), mean = need.reduce((a, b) => a + b, 0) / N, med = quant(0.5), p90 = quant(0.9);
    const goal = [tc > 0 ? 'E' + (tc - 1) : '', tl > 0 ? 'S' + tl : ''].filter(Boolean).join(' + ');
    html += `<div class="sim-result">
      <div class="gauge" style="--p:${p * 100}"><span data-count="${p}" data-fmt="pct">${pct(p, 1)}</span></div>
      <div><h4>${t('sim_goal', { goal, n: fmt(P) })}</h4>
        <ul class="sim-list">
          <li>${t('sim_mean')} : <b>${fmt(mean)}</b> ${t('pulls')}</li>
          <li>${t('sim_median')} : <b>${fmt(med)}</b> ${t('pulls')} ${med > P ? `<small>(${t('missing_jades', { j: jadesFor(med) })})</small>` : ''}</li>
          <li>${t('sim_p90')} : <b>${fmt(p90)}</b> ${t('pulls')} ${p90 > P ? `<small>(${t('missing_jades', { j: jadesFor(p90) })})</small>` : ''}</li>
        </ul></div></div>`;
  }
  html += `<h4>${t('sim_table', { n: fmt(P) })}</h4><div class="e-table">${range(1, 7).map(k => {
    const p = probAt(charAt[k]);
    return `<div class="e-cell"><b>E${k - 1}</b><div class="e-bar"><div style="height:${p * 100}%"></div></div><span>${pct(p, 0)}</span></div>`;
  }).join('')}</div><p class="hint small">${t('sim_model')}</p>`;
  out.innerHTML = html;
  countUpIn(out);
}

/* actions des boutons et listes (data-action), branchées dans main.js */
Object.assign(actions, {
  // endgame : préréglage des jades par cycle (onglet Vœux) et serveur du jeu (Paramètres)
  egPreset: el => { if (el.value !== 'custom') { S.warp[el.dataset.key] = +el.value; save(); render(); } },
  simulate: () => { $('#simOut').innerHTML = `<p class="hint">${t('computing')}</p>`; setTimeout(simulate, 20); },
  addWish: () => {
    const name = $('#whName').value.trim();
    if (!name) return toast(t('err_name'));
    const banner = $('#whBanner').value, result = $('#whResult').value;
    S.history.push({ id: uid(), date: $('#whDate').value, banner, name, pity: parseInt($('#whPity').value, 10) || 0, result });
    if ($('#whUpdate').checked) {
      if (banner === 'char') { S.warp.charPity = 0; S.warp.charGuar = result === 'lost'; }
      if (banner === 'lc') { S.warp.lcPity = 0; S.warp.lcGuar = result === 'lost'; }
    }
    save(); render(); toast(t('added'));
  },
  delWish: b => { S.history = S.history.filter(x => x.id !== b.dataset.id); save(); render(); },
});
