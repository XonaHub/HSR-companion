/* HSR Companion — onglet Farm
   Planificateur : plans, matériaux manquants, énergie. */
'use strict';

/* ================================================================== PLANIFICATEUR */
/* Coûts exacts tirés des données du jeu (js/assets.js). Les tables estimées de data.js
   ne servent que pour un personnage personnalisé absent de ces données. */
const CREDIT_ID = G.special.credits || '2', TD_ID = G.special.td || '241';
const AB_KEYS = { Point01: 'basic', Point02: 'skill', Point03: 'ult', Point04: 'talent', Point19: 'memo_skill', Point20: 'memo_talent', Point22: 'elation_skill' };
const FALLBACK_AB = { Point01: 6, Point02: 10, Point03: 10, Point04: 10 };
const exactData = c => { const g = gameChar(c); return g && g.asc && g.asc.length ? g : null; };
const abilitiesOf = c => { const g = c && exactData(c); return g ? Object.keys(g.tr).sort().map(a => [a, g.tr[a].length + 1]) : Object.entries(FALLBACK_AB); };
const abLabel = (a, short) => t((short ? 'ab_short_' : 'ab_') + (AB_KEYS[a] || 'extra'));
const planTr = farmPlanTr;
const itemCat = id => farmItemCat(G.items, id);
const itemTier = id => farmItemTier(G.items, id);   // rareté 2/3/4 → T1/T2/T3

/* Calcul du farm : js/farm.js (fonctions pures). Le départ vient de l'état importé du perso (S.owned),
   sauf useOwned = false (coût complet depuis le niveau 1, fiche du perso). */
const equippedCone = charId => (S.cones || []).find(x => x.owner === charId) || null;
function computePlan(p, useOwned = true) {
  const c = charById(p.charId); if (!c) return null;
  const cone = equippedCone(c.id);
  return planNeeds(p, planStart(p, useOwned ? S.owned[c.id] : null), exactData(c), cone, cone && coneOf(G.lightCones || [], cone.id), c);
}
let families = null;
/* Ce qui manque à chaque plan (dans l'ordre de S.plans) une fois le stock partagé */
const missingOf = plans => allocate(plans.map(p => computePlan(p) || { exp: 0, lcExp: 0, items: {} }), S.inventory, families || (families = familiesOf(G))).map(x => x.missing);

function tpEstimate(missing) {
  const tp = farmTp(missing, S.rates, G.items);
  const tm = farmTimes([missing], S.rates, new Date(), G.items).total;
  return { ...tp, echoWeeks: Math.ceil(tp.weeklyRuns / 3), days: tm.days };
}

/* Regroupe les besoins par objet réel du jeu (ex. deux persos qui partagent le même boss) */
function aggregate(plans, useOwned = true, results = null) {   // results : besoins déjà calculés (parallèles à plans), p. ex. le manque après les plans précédents
  const tot = { exp: 0, lcExp: 0, credits: 0, pathT1: 0, boss: 0, weekly: 0, rows: new Map() };
  const ORDER = { path: 10, common: 20, boss: 30, weekly: 40, td: 50 };
  const add = (key, n, order, item, sub, emoji, name) => {
    if (!n) return;
    const row = tot.rows.get(key) || { n: 0, order, item, sub, emoji, names: new Set() };
    row.n += n; if (name) row.names.add(name);
    tot.rows.set(key, row);
  };
  for (const [pi, p] of plans.entries()) {
    const r = results ? results[pi] : computePlan(p, useOwned); if (!r) continue;
    const c = charById(p.charId), nm = charName(c);
    tot.exp += r.exp; tot.lcExp += r.lcExp;
    for (const id in r.items) {
      const n = r.items[id], cat = itemCat(id), tier = itemTier(id);
      if (cat === 'credit') { tot.credits += n; continue; }
      if (cat === 'path') tot.pathT1 += n * 3 ** (tier - 1);
      if (cat === 'boss') tot.boss += n;
      if (cat === 'weekly') tot.weekly += n;
      const sub = cat === 'path' || cat === 'common' ? t('cat_' + cat, { tier }) : cat === 'td' ? '' : t('cat_' + cat);
      add('i' + id, n, (ORDER[cat] || 60) + tier / 10, id, sub, '📦', cat === 'boss' || cat === 'weekly' ? nm : null);
    }
    const q = r.gen;   // repli : perso personnalisé sans données exactes
    [1, 2, 3].forEach(i => {
      add(`p-${c.path}-${i}`, q['p' + i], 10 + i / 10, null, t('mat_path', { path: t('path_' + c.path), tier: i }), '🔮');
      add(`c-${i}`, q['c' + i], 20 + i / 10, null, t('mat_common', { tier: i }), '🔩');
      tot.pathT1 += (q['p' + i] || 0) * 3 ** (i - 1);
    });
    add('b-' + c.id, q.boss, 30, null, t('mat_boss', { name: nm }), '💎'); tot.boss += q.boss || 0;
    add('w-' + c.id, q.weekly, 40, null, t('mat_weekly', { name: nm }), '👑'); tot.weekly += q.weekly || 0;
  }
  return tot;
}

function matRows(tot, noStock = false) {   // noStock : tot est déjà un manque, pas de comparaison au stock
  const ico = id => (id && itemImg(id)) || '<span class="emoji">◆</span>';
  const rows = [];
  // stock issu de l'export Reliquary Archiver : affiche ce qu'il manque vraiment
  const inv = noStock ? null : S.inventory;
  const have = id => inv && id && inv[id] != null ? inv[id] : (inv ? 0 : null);
  const qty = (need, h) => h == null ? fmt(need)
    : `${fmt(need)}<small class="${h >= need ? 'inv-ok' : 'inv-miss'}">${h >= need ? t('inv_ok', { n: fmt(h) }) : t('inv_missing', { n: fmt(need - h) })}</small>`;
  const expHave = inv ? Object.entries(EXP_ITEMS).reduce((s, [id, v]) => s + (inv[id] || 0) * v, 0) : null;
  if (tot.exp) rows.push([ico(G.special.exp), `${t('mat_exp')}<small>≈ ${fmt(Math.ceil(tot.exp / EXP_BOOK))} × ${t('mat_book')}</small>`, qty(tot.exp, expHave)]);
  if (tot.lcExp) rows.push([ico('223'), t('mat_lc_exp'), qty(tot.lcExp, inv ? Object.entries(LC_EXP_ITEMS).reduce((s, [id, v]) => s + (inv[id] || 0) * v, 0) : null)]);
  if (tot.credits) rows.push([ico(CREDIT_ID), t('mat_credits'), qty(tot.credits, inv && inv[CREDIT_ID] != null ? inv[CREDIT_ID] : null)]);
  [...tot.rows.values()].sort((a, b) => a.order - b.order).forEach(r => {
    const title = (r.item && itemName(r.item)) || r.sub;
    const sub = [r.item ? r.sub : '', [...r.names].join(', ')].filter(Boolean).join(' · ');
    rows.push([ico(r.item), `${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}`, qty(r.n, r.item ? have(r.item) : null)]);
  });
  return rows;
}
const matTable = rows => rows.length
  ? `<table class="mat-table">${rows.map(([i, l, n]) => `<tr><td class="mi">${i}</td><td>${l}</td><td class="num">${n}</td></tr>`).join('')}</table>`
  : `<p class="empty">${t('nothing_needed')}</p>`;

function abilityFields(c) {
  const cur = (c && S.owned[c.id] && S.owned[c.id].tr) || {};   // niveaux actuels (import du compte)
  const sel = (a, which, max, v) => `<select id="pl_${a}_${which}" ${which === 'from' ? `data-ab="${a}"` : ''}>${range(1, max).map(l => opt(l, l, v)).join('')}</select>`;
  return abilitiesOf(c).map(([a, max]) => `<label class="field">${abLabel(a)}${cur[a] ? `<span class="cur-tag">${t('current_tag')}</span>` : ''}<span class="range-sel">${sel(a, 'from', max, clamp(cur[a] || 1, 1, max))}<span>→</span>${sel(a, 'to', max, max)}</span></label>`).join('');
}
/* Remplit le formulaire avec l'état actuel du perso (s'il a été importé depuis la vitrine) */
function setPlannerChar(c) {
  $('#plAbilities').innerHTML = abilityFields(c);
  const o = c && S.owned[c.id];
  $('#plLvFrom').value = o && o.lvl ? Math.max(...LEVELS.filter(L => L <= o.lvl)) : 1;
  $('#plBonus').checked = !(o && o.bonusAll);
  $('#plLvCur').textContent = o && o.lvl ? t('current_tag') : '';
  // cône : celui équipé sur le perso (S.cones), avec ses données du jeu
  const eq = c && equippedCone(c.id), gC = eq && coneOf(G.lightCones || [], eq.id);
  $('#plLc').disabled = $('#plLcTo').disabled = !gC;
  if (!gC) $('#plLc').checked = false;
  $('#plLcHint').textContent = gC ? `${coneName(gC, eq.name)} · ${t('lvl')} ${eq.level}` : t(eq ? 'lc_unknown' : 'lc_no_cone');
}

function renderPlanner(v) {
  const active = S.plans.filter(p => p.on !== false && charById(p.charId));
  const tot = aggregate(active);
  const miss = missingOf(active);   // énergie et temps : sur ce qui manque vraiment, stock partagé dans l'ordre des plans
  const tp = tpEstimate(miss.reduce((a, m) => {
    a.exp += m.exp; a.lcExp += m.lcExp;
    for (const id in m.items) a.items[id] = (a.items[id] || 0) + m.items[id];
    for (const k in m.gen) a.gen[k] = (a.gen[k] || 0) + m.gen[k];
    return a;
  }, { exp: 0, lcExp: 0, items: {}, gen: {} }));
  const ft = farmTimes(miss, S.rates, new Date(), G.items);   // par plan actif (cumulé) et total : mêmes chiffres partout
  const info = new Map(active.map((p, i) => [p.id, { ...ft.perPlan[i], miss: miss[i] }]));
  v.innerHTML = gameAlertNote() + `
  <section class="panel">
    <div class="panel-head"><h2>${t('planner_title')}</h2></div>
    <p class="hint">${t('planner_hint')}</p>
    <div class="planner-form">
      <label class="field span2">${t('character')}<select id="plChar" data-action="plChar">${charOptions(S.plChar)}</select></label>
      <label class="field">${t('level_from')}<span id="plLvCur" class="cur-tag"></span><select id="plLvFrom">${LEVELS.map(l => opt(l, l, 1)).join('')}</select></label>
      <label class="field">${t('level_to')}<select id="plLvTo">${LEVELS.map(l => opt(l, l, 80)).join('')}</select></label>
      <div id="plAbilities" class="planner-abilities"></div>
      <label class="check"><input type="checkbox" id="plBonus" checked> ${t('bonus_traces')}</label>
      <div class="lc-opt">
        <label class="check"><input type="checkbox" id="plLc"> ${t('include_lc')}</label>
        <label class="field">${t('lc_to')}<select id="plLcTo">${LEVELS.map(l => opt(l, l, 80)).join('')}</select></label>
        <small id="plLcHint" class="hint small"></small>
      </div>
      <button class="btn primary" data-action="addPlan">${t('add_plan')}</button>
    </div>
  </section>
  <div class="cols">
    <section class="panel">
      <h3>${t('plans')} <span class="badge">${S.plans.length}</span></h3>
      ${S.plans.length ? `<p class="hint small">${t('drag_hint')}</p>${S.plans.map(p => planCard(p, info.get(p.id))).join('')}` : `<p class="empty">${t('no_plans')}</p>`}
    </section>
    <section class="panel">
      <h3>${t('totals')}</h3>
      ${matTable(matRows(tot))}
      ${active.length ? `<div class="tp-box">
        <div class="tp-main"><span>${t('tp_total')}</span><b>${fmt(ft.total.tp)}</b><small>${etaText(ft.total.days, ft.total.date)}</small></div>
        <p class="hint small">${ft.total.limitedByWeekly ? t('limited_weekly', { n: Math.ceil(ft.total.weeklyRuns / 3) }) : t('at_240')}${S.inventory ? '' : ' · ' + t('no_inventory')}</p>
        <ul class="tp-detail">
          <li>${t('tp_exp')} : ${fmt(tp.expTP)}</li><li>${t('tp_lc_exp')} : ${fmt(tp.lcExpTP)}</li><li>${t('tp_credits')} : ${fmt(tp.crTP)}</li>
          <li>${t('tp_path')} : ${fmt(tp.pathTP)}</li><li>${t('tp_boss')} : ${fmt(tp.bossTP)}</li>
          <li>${t('tp_echo', { w: tp.echoWeeks })} : ${fmt(tp.echoTP)}</li>
        </ul>
        <p class="hint small">${t('tp_hint')}</p>
      </div>` : ''}
    </section>
  </div>`;
  setPlannerChar(charById($('#plChar').value));
}

const fmtDate = d => d.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });
const etaText = (days, date) => days > 0 ? t('eta', { days: t('days', { n: Math.ceil(days) }), date: fmtDate(date) }) : t('eta_none');

/* actions des boutons et listes (data-action), branchées dans main.js */
Object.assign(actions, {
  addPlan: () => {
    const lvFrom = +$('#plLvFrom').value, lvTo = +$('#plLvTo').value;
    const tr = {};
    for (const el of $$('#plAbilities select[data-ab]')) {
      const ab = el.dataset.ab, a = +el.value, b = +$(`#pl_${ab}_to`).value;
      tr[ab] = [a, Math.max(a, b)];
    }
    S.plans.push({ id: uid(), charId: $('#plChar').value, lvFrom, lvTo: Math.max(lvFrom, lvTo), tr, bonus: $('#plBonus').checked, lc: { on: $('#plLc').checked && !$('#plLc').disabled, lvTo: +$('#plLcTo').value }, on: true });
    save(); render(); toast(t('added'));
  },
  delPlan: (b, e) => { e.preventDefault(); S.plans = S.plans.filter(p => p.id !== b.dataset.id); save(); render(); },
  plChar: el => { S.plChar = el.value; save(); setPlannerChar(charById(el.value)); },
  togglePlanLc: el => { const p = S.plans.find(x => x.id === el.dataset.id); if (p) { p.lc = { ...(p.lc || { lvTo: 80 }), on: el.checked }; save(); render(); } },
  planLcTo: el => { const p = S.plans.find(x => x.id === el.dataset.id); if (p) { p.lc = { ...(p.lc || { on: false }), lvTo: +el.value }; save(); render(); } },
  togglePlan: el => { const p = S.plans.find(x => x.id === el.dataset.id); if (p) { p.on = el.checked; save(); render(); } },
});
