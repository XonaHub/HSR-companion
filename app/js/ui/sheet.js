/* HSR Companion — fiche perso
   Fenêtre ouverte depuis un perso : compétences, traces, cônes, reliques, simulateur. */
'use strict';

/* ================================================================== FICHE PERSO */
/* Les textes (compétences, traces, eidolons) sont chargés à la demande : version téléchargée par l'app
   si elle existe (commande game_details), sinon js/details/<langue>.js intégré. */
const detailsLoading = {};
function loadDetails(lang) {
  if (window.HSR_DETAILS && HSR_DETAILS[lang]) return Promise.resolve(HSR_DETAILS[lang]);
  if (!detailsLoading[lang]) detailsLoading[lang] = invoke('game_details', { lang }).catch(() => null).then(json => json
    ? ((window.HSR_DETAILS = window.HSR_DETAILS || {})[lang] = JSON.parse(json))
    : loadDetailsScript(lang));
  return detailsLoading[lang];
}
function loadDetailsScript(lang) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `js/details/${lang}.js`;
    s.onload = () => resolve(window.HSR_DETAILS && HSR_DETAILS[lang]);
    s.onerror = () => { delete detailsLoading[lang]; s.remove(); reject(new Error('details')); };
    document.head.appendChild(s);
  });
}

let sheet = null;   // { id, tab, lv: { indexCompétence: niveau }, err }
const DEFAULT_SKILL_LV = { Normal: 6, BPSkill: 10, Ultra: 10, Talent: 10, MemospriteSkill: 6, MemospriteTalent: 6, ElationDamage: 10 };
const SHEET_TABS = ['skills', 'traces', 'eidolons', 'cones', 'relics', 'mats'];

/* Remplace les marqueurs du jeu (#1[i]%, #2[f1]…) par les valeurs du niveau choisi */
function fmtDesc(desc, params) {
  return esc(desc).replace(/\\n|\n/g, '<br>').replace(/#(\d+)\[(i|f(\d))\](%?)/g, (m, n, kind, dec, pc) => {
    const v = params ? params[+n - 1] : undefined;
    if (v == null) return '<b class="hl">?</b>';   // valeur absente des données source
    const d = kind === 'i' ? 0 : +dec;
    const x = (pc ? v * 100 : v).toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d });
    return `<b class="hl">${x}${pc ? '%' : ''}</b>`;
  });
}
const fmtProp = (type, v) => /Delta$/.test(type)
  ? (+v).toLocaleString(locale(), { maximumFractionDigits: 1 })
  : (v * 100).toLocaleString(locale(), { maximumFractionDigits: 1 }) + '%';
const fullPlan = c => ({ charId: c.id, lvFrom: 1, lvTo: 80, bonus: true, tr: Object.fromEntries(abilitiesOf(c).map(([a, max]) => [a, [1, max]])) });

async function openSheet(id) {
  sheet = { id, tab: 'skills', lv: {} };
  renderSheet();
  const opened = charById(id); if (opened) loadRanking(opened, true);
  try { await loadDetails(S.lang); } catch (e) { if (sheet) sheet.err = true; }
  if (sheet && sheet.id === id) renderSheet();
}
/* Perso précédent / suivant (flèches ← →, boutons ‹ ›) dans l'ordre de la grille Personnages ; si le perso
   ouvert n'y est pas (filtré, ou fiche ouverte depuis un autre onglet), dans l'ordre de tous les persos. */
function sheetStep(dir) {
  if (!sheet) return;
  let list = rosterOrder();
  if (!list.some(c => c.id === sheet.id)) list = allChars().sort((a, b) => b.rarity - a.rarity || byName(a, b));
  const i = list.findIndex(c => c.id === sheet.id);
  if (list.length < 2 || i < 0) return;
  const tab = sheet.tab, next = list[(i + dir + list.length) % list.length];
  openSheet(next.id); sheet.tab = tab; renderSheet();
}
function closeSheet() {
  sheet = null; upgradeTrack = null;
  // avant closeModal : le focus revient alors sur le bouton redessiné (retrouvé par ses data-*)
  if (todayStale && S.tab === 'today') renderToday($('#view'));
  todayStale = false;
  closeModal('sheet');
}

/* ---- classement des cônes (Prydwen, via la commande Rust prydwen_ranking) ----
   rankings : id de perso -> classement, ou 'error' (non sauvegardé). Les appels se font un par un :
   le côté Rust gère le cache de 24 h mais ne sérialise pas les appels en parallèle. */
const rankings = new Map();
const rankPending = new Set();
let rankQueue = Promise.resolve();
function loadRanking(c, retryError) {
  const g = gameChar(c), cur = rankings.get(c.id);
  if (!g || !g.en) { rankings.set(c.id, 'error'); return; }   // perso sans données du jeu : pas de classement
  if (rankPending.has(c.id) || (cur && !(retryError && cur === 'error'))) return;
  rankPending.add(c.id);
  rankQueue = rankQueue
    .then(() => invoke('prydwen_ranking', { nameEn: g.en, force: false }))
    .then(r => { setNet('prydwen', !r.stale); rankings.set(c.id, r); }, () => rankings.set(c.id, 'error'))
    .then(() => {
      rankPending.delete(c.id);
      if (sheet && sheet.id === c.id) renderSheet();
      else if (S.tab === 'today') { if (sheet) todayStale = true; else refreshToday(); }   // carte « Reliques à revoir »
    });
}
/* l'accueil attend un conseil arrivé pendant qu'une fiche était ouverte : redessiné à la fermeture (closeSheet) */
let todayStale = false;
const coneName = (lc, fallback) => (lc && (S.lang === 'fr' ? lc.fr : lc.en)) || (lc && lc.en) || fallback || '?';
const ownerLabel = (cone, charId) => cone.owner === charId ? t('cone_tag_equipped')
  : cone.owner ? t('cone_carried', { name: charName(charById(cone.owner)) }) : '';
function coneRow(e, best) {
  const o = e.owned, lbl = o ? ownerLabel(o, sheet.id) : '';
  const tags = o ? `<span class="ctag own">S${o.sup}</span>${lbl ? `<span class="ctag ${o.owner === sheet.id ? 'eq' : 'warn'}">${esc(lbl)}</span>` : ''}` : '';
  const sub = e.testedSup != null ? t('cone_tested', { n: e.testedSup }) : '';
  return `<div class="lc-row r${e.lc.rarity} ${o ? '' : 'missing'} ${best ? 'best' : ''}">
    <span class="lc-rk">${e.rank != null ? e.rank : ''}</span>
    <span class="lc-ic">${img(e.lc.icon, 'lc-img', coneName(e.lc))}</span>
    <div><b>${esc(coneName(e.lc))}${tags}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    <span class="lc-sc">${e.score != null ? pct(e.score / 100, 1) : ''}</span></div>`;
}
function sheetCones(c) {
  const r = rankings.get(c.id);
  if (!r) return `<p class="empty">${t('cones_loading')}</p>`;
  const adv = r !== 'error' ? coneAdvice(r, S.cones, G.lightCones || [], c.id) : null;
  if (!adv || !(adv.mine.length || adv.target.length)) {   // classement indisponible : cônes possédés de la même Voie, sans rang
    const same = S.cones.map(o => ({ lc: coneOf(G.lightCones, o.id), owned: o })).filter(e => e.lc && e.lc.path === c.path)
      .sort((a, b) => b.lc.rarity - a.lc.rarity || b.owned.sup - a.owned.sup)
      .map(e => ({ lc: e.lc, rank: null, score: null, testedSup: null, owned: e.owned }));
    return `<p class="hint small">${t('cones_unavailable')}</p>
      ${same.length ? `<h3>${t('cones_same_path')}</h3>${same.map(e => coneRow(e, false)).join('')}` : ''}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.updated || '');
  const date = m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(locale()) : (r.updated || '');
  return `<h3>${t('cones_mine')}</h3>
    ${adv.mine.length ? adv.mine.map((e, i) => coneRow(e, i === 0)).join('') : `<p class="hint small">${t('cones_no_owned')}</p>`}
    ${adv.target.length ? `<h3>${t('cones_target')}</h3>${adv.target.map(e => coneRow(e, false)).join('')}` : ''}
    <p class="lc-src">${esc(t('cones_source', { date }))}${r.stale ? ' · ' + esc(t('cones_offline')) : ''}</p>`;
}
/* ---- onglet Reliques : bilan d'après Prydwen (même page que les cônes), sinon profil du perso (relics.js) ---- */
const prydwenDate = r => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((r && r.updated) || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(locale()) : ((r && r.updated) || '');
};
/* ---- simulateur : reliques telles que l'essai les place (sheet.trial : emplacement -> id de relique) ---- */
const trialOf = () => (sheet && sheet.trial) || {};
function trialRelics(charId) {
  const tr = trialOf(), ids = new Set(Object.values(tr));
  if (!ids.size) return S.relics;
  return S.relics.map(r => ids.has(r.id) ? { ...r, owner: charId, from: r.owner }
    : r.owner === charId && tr[r.slot] ? { ...r, owner: null } : r);
}
// ordre de l'écran « Détails des stats » du jeu ; Allégresse seulement pour les persos qui en ont
const STAT_ROWS = ['hp', 'atk', 'def', 'spd', 'cr', 'cd', 'be', 'heal', 'err', 'ehr', 'res', 'elation', 'dmg'];
function statsFor(c, relics) {
  const g = gameChar(c), o = S.owned[c.id] || {};
  const eq = S.cones.find(x => x.owner === c.id), lc = eq && coneOf(G.lightCones, eq.id);
  const points = o.pts || (o.bonusAll && g && g.trStats ? Object.keys(g.trStats) : []);
  return charStats({
    char: { stats: g && g.stats, trStats: g && g.trStats, element: c.element, path: c.path },
    level: o.lvl || 80, promo: o.lvl ? o.promo || 0 : 6, points,
    cone: lc && lc.stats ? { stats: lc.stats, passive: lc.passive, path: lc.path, level: eq.level, promo: eq.asc, sup: eq.sup } : null,
    relics: relics.filter(r => r.owner === c.id), relicMain: G.relicMain, setBonus: G.relicSetBonus,
    setIdOf: name => (G.relicSets[norm(name)] || [])[1] ?? null
  });
}
// comme l'écran du jeu : PV/ATQ/DÉF entiers, VIT au dixième, pourcentages au dixième (régén. d'énergie = 100 % + bonus) ;
// `diff` : un écart (pas de 100 % ajouté)
const fmtTotal = (k, v, diff) => ['hp', 'atk', 'def'].includes(k) ? Math.floor(v + 1e-9).toLocaleString(locale())
  : k === 'spd' ? (Math.floor(v * 10 + 1e-9) / 10).toLocaleString(locale(), { maximumFractionDigits: 1 })
  : ((Math.floor(v * 1000 + 1e-9) / 10) + (k === 'err' && !diff ? 100 : 0)).toLocaleString(locale(), { maximumFractionDigits: 1 }) + ' %';
const rowLabel = (k, c) => k === 'dmg' ? statLabel('dmg_' + c.element) : t('stat_' + k);
function simulator(c, advice) {
  const g = gameChar(c), o = S.owned[c.id] || {};
  if (!g || !g.stats || !G.relicMain) return `<h3>${t('sim_title')}</h3><p class="hint small">${t('sim_no_data')}</p>`;
  const tr = trialOf(), trying = Object.keys(tr).length > 0;
  const cur = statsFor(c, S.relics), tri = trying ? statsFor(c, trialRelics(c.id)) : null;
  const targets = new Map(((advice && advice.targets) || []).map(x => [x.key, x]));
  const warn = [];
  if (!o.lvl) warn.push(t('sim_warn_level'));
  if (!o.pts) warn.push(t('sim_warn_traces'));
  if (S.relics.some(r => r.owner === c.id && !r.exact)) warn.push(t('sim_warn_rounded'));
  if (cur.missing.length) warn.push(t('sim_no_data'));
  // PV/ATQ/DÉF/VIT : « base + bonus », comme dans le jeu (bonus = total affiché − base affichée)
  const baseOf = (k, s) => s.base[k] != null ? `<small class="sim-base">${fmtTotal(k, s.base[k])} + ${fmtTotal(k, Math.max(0, (k === 'spd' ? Math.floor(s.total[k] * 10 + 1e-9) / 10 - Math.floor(s.base[k] * 10 + 1e-9) / 10 : Math.floor(s.total[k] + 1e-9) - Math.floor(s.base[k] + 1e-9))), true)}</small>` : '';
  const rows = STAT_ROWS.filter(k => k !== 'elation' || c.path === 'elation' || cur.total.elation > 0 || (tri && tri.total.elation > 0)).map(k => {
    const a = cur.total[k], b = tri ? tri.total[k] : null, tg = targets.get(k);
    // écart entre les valeurs affichées (arrondies comme dans le jeu), pas entre les valeurs exactes
    const q = ['hp', 'atk', 'def'].includes(k) ? x => Math.floor(x + 1e-9) : k === 'spd' ? x => Math.floor(x * 10 + 1e-9) / 10 : x => Math.floor(x * 1000 + 1e-9) / 1000;
    const d = b == null ? 0 : q(b) - q(a), eps = ['hp', 'atk', 'def'].includes(k) ? 0.5 : k === 'spd' ? 0.05 : 0.0005;
    const val = tri ? b : a, reached = tg ? val + 1e-9 >= tg.min : null;
    return `<tr><th>${esc(rowLabel(k, c))}</th><td>${fmtTotal(k, a)}${baseOf(k, cur)}</td>
      ${trying ? `<td class="${d > eps ? 'up' : d < -eps ? 'down' : ''}">${fmtTotal(k, b)}${Math.abs(d) > eps ? ` <small>(${d > 0 ? '+' : '−'}${fmtTotal(k, Math.abs(d), true)})</small>` : ''}</td>` : ''}
      <td class="tgt ${reached === true ? 'ok' : reached === false ? 'bad' : ''}">${tg ? `${reached ? '✓' : '✗'} ${esc(tg.text)}` : ''}</td></tr>`;
  }).join('');
  const prof = profileOf(c), score = x => relicScore(x, prof).ratio;
  const picks = SLOTS.map(slot => {
    const list = S.relics.filter(r => r.slot === slot).sort((a, b) => score(b) - score(a)).slice(0, 40);
    const eq = S.relics.find(r => r.owner === c.id && r.slot === slot);
    const label = r => `${r.set || t('unknown_set')} · ${statLabel(r.main)} +${r.level} · ${gradeOf(score(r))}${r.owner && r.owner !== c.id ? ' · ' + t('cone_carried', { name: charName(charById(r.owner)) }) : r.owner === c.id ? ' · ' + t('cone_tag_equipped') : ''}`;
    return `<label class="field">${t('slot_' + slot)}<select data-action="trySlot" data-slot="${slot}">
      ${opt('', eq ? label(eq) : t('rl_empty'), tr[slot] || '')}
      ${list.filter(r => r !== eq).map(r => opt(r.id, label(r), tr[slot] || '')).join('')}</select></label>`;
  }).join('');
  const build = S.builds[c.id];
  const buildList = build ? SLOTS.filter(slot => build[slot]).map(slot => {
    const r = S.relics.find(x => x.id === build[slot]);
    if (!r) return '';
    const where = r.owner === c.id ? t('cone_tag_equipped') : r.owner ? t('sim_now_on', { name: charName(charById(r.owner)) }) : t('cone_free');
    return `<li class="${r.owner === c.id ? 'ok' : ''}"><span>${t('slot_' + slot)}</span><b>${esc(r.set)} · ${statLabel(r.main)} +${r.level}</b><small>${esc(where)}</small></li>`;
  }).join('') : '';
  return `<h3>${t('sim_title')}</h3>
    ${warn.map(w => `<p class="warn-txt small">${esc(w)}</p>`).join('')}
    <table class="sim-stats"><thead><tr><th></th><th>${t('sim_current')}</th>${trying ? `<th>${t('sim_trial')}</th>` : ''}<th>${t('sim_target')}</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="hint small">${t('sim_scope')}</p>
    <h4>${t('sim_try')}</h4>
    <div class="sim-picks">${picks}</div>
    <div class="sim-actions">
      <button class="btn" data-action="resetTrial" ${trying ? '' : 'disabled'}>${t('sim_reset')}</button>
      <button class="btn primary" data-action="keepBuild" data-id="${c.id}" ${trying ? '' : 'disabled'}>${t('sim_keep')}</button>
    </div>
    ${buildList ? `<h4>${t('sim_kept')}</h4><ul class="rl-check">${buildList}</ul>
      <button class="btn sm" data-action="dropBuild" data-id="${c.id}">${t('sim_drop')}</button>` : ''}`;
}
/* Un build gardé disparaît dès que le jeu l'a appliqué (toutes ses pièces portées par le perso) */
function pruneBuilds() {
  let changed = false;
  for (const [id, b] of Object.entries(S.builds || {})) {
    const done = Object.values(b).every(rid => { const r = S.relics.find(x => x.id === rid); return !r || r.owner === id; });
    if (done) { delete S.builds[id]; changed = true; }
  }
  return changed;
}

function sheetRelics(c) {
  if (!S.relics.length) return `<p class="empty">${t('rl_none_imported')}</p>`;
  const r = rankings.get(c.id);
  if (!r) return `<p class="empty">${t('rl_loading')}</p>`;
  const advice = r !== 'error' && r.relics ? r.relics : null;
  const prof = profileOf(c);
  const score = x => relicScore(x, prof).ratio;
  const rev = relicReview(advice, trialRelics(c.id), c.id, { element: c.element, profileMain: PROFILES[prof].main, score, grade: x => gradeOf(score(x)) });
  const line = (ok, label, text) => `<li class="${ok === true ? 'ok' : ok === false ? 'bad' : ''}"><span>${label}</span><b>${esc(text)}</b></li>`;
  const setText = st => st.kind === 'rec' ? t('rl_set_rec', { rank: st.rank, set: st.target.join(' + ') })
    : st.kind === 'mix' ? t('rl_set_mix', { a: st.target[0], b: st.target[1] })
    : st.kind === 'unknown' ? t('rl_set_unknown') : t('rl_set_' + st.kind, { set: st.target.join(' + ') });
  const setOk = st => st.kind === 'rec' || st.kind === 'mix' ? true : st.kind === 'unknown' ? null : false;
  const mains = rev.mains.map(m => !m.relic ? line(false, '', t('rl_main_empty', { slot: t('slot_' + m.slot) }))
    : m.ok ? line(true, '', t('rl_main_ok', { slot: t('slot_' + m.slot), stat: statLabel(m.relic.main) }))
    : line(false, '', t('rl_main_bad', { slot: t('slot_' + m.slot), stat: statLabel(m.relic.main), best: m.best ? statLabel(m.best) : '?' }))).join('');
  const empty = SLOTS.filter(s => !rev.slots[s]);
  const pieces = SLOTS.map(s => rev.slots[s] ? relicCard(rev.slots[s], { readOnly: true })
    : `<div class="relic-card rl-empty"><b>${t('slot_' + s)}</b><small>${t('rl_empty')}</small></div>`).join('');
  const equippedCount = SLOTS.length - empty.length;
  const trying = Object.keys(trialOf()).length > 0;
  return `${trying ? `<p class="sim-banner">${t('sim_banner')} <button class="btn sm" data-action="resetTrial">${t('sim_reset')}</button></p>` : ''}
    <h3>${t('rl_review')}</h3>
    ${equippedCount ? '' : `<p class="hint small">${t('rl_none_equipped')}</p>`}
    <ul class="rl-check">
      ${line(setOk(rev.cavern), t('rl_cavern'), setText(rev.cavern))}
      ${line(setOk(rev.planar), t('rl_planar'), setText(rev.planar))}
    </ul>
    <h4>${t('rl_main')}</h4><ul class="rl-check">${mains}</ul>
    ${loadoutBlock(c, advice, prof)}
    ${eventBlock(c, advice, prof)}
    ${simulator(c, advice)}
    <h3>${t('rl_pieces')}</h3><div class="relic-grid">${pieces}</div>
    <p class="lc-src">${advice ? esc(t('rl_source', { date: prydwenDate(r) })) + (r.stale ? ' · ' + esc(t('cones_offline')) : '') : esc(t('rl_no_advice', { profile: t('prof_' + prof) }))}</p>`;
}

/* ---- Équipement conseillé (relicLoadout, upgradeCandidates : relics.js) : tableau avant / après ---- */
/** Les `n` sous-stats les plus utiles de la pièce pour ce profil (poids × part d'un roll maximal) */
function topSubs(relic, prof, n = 2) {
  const w = (PROFILES[prof] && PROFILES[prof].weights) || {};
  return (relic.subs || []).filter(s => s.stat && s.val > 0 && SUBSTATS[s.stat])
    .map(s => ({ ...s, k: (w[s.stat] || 0) * s.val / SUBSTATS[s.stat].roll[2] }))
    .sort((a, b) => b.k - a.k).slice(0, n);
}
/* Une pièce, repérable en jeu : set · stat principale · +niveau · 2 sous-stats utiles ; dépliable (4 sous-stats) */
function loadoutPiece(r, prof) {
  const top = topSubs(r, prof);
  const subs = (r.subs || []).filter(s => s.stat && s.val > 0 && SUBSTATS[s.stat]);
  return `<details class="lo-piece"><summary>${esc(r.set || t('unknown_set'))} · ${esc(statLabel(r.main))} · +${r.level}
      ${top.map(s => `· <b>${esc(statLabel(s.stat))} ${esc(fmtStat(s.stat, s.val))}</b>`).join(' ')}</summary>
    <small>${subs.map(s => `${esc(statLabel(s.stat))} ${esc(fmtStat(s.stat, s.val))}`).join(' · ') || esc(t('rl_lo_no_subs'))}</small></details>`;
}
const upgradeCache = new Map();   // upgradeCandidates : chances déjà calculées (pièce, niveau, sous-stats, cible)
const UPGRADE_CACHE_MAX = 3000;   // au-delà (longue session en direct) : vidé, recalculé à la demande
/* Suivi en direct des pièces « à monter » de la fiche ouverte : niveau et chances au rendu précédent, par id.
   Une pièce déjà affichée reste suivie (keep) tant que la fiche de ce perso est ouverte, même sous le seuil ou à +15. */
let upgradeTrack = null;   // { charId, seen: Map id -> { level, chance, from } } (from : chances avant la dernière amélioration)
/** Équipement conseillé et pièces à monter d'un perso : partagé par la fiche et la carte « Reliques à revoir »
    d'Aujourd'hui (mêmes chiffres partout). keep : ids suivis en direct (fiche seulement). */
function loadoutFor(c, advice, prof, relics, keep) {
  const value = x => relicScore(x, prof).useful;
  const opts = { element: c.element, profileMain: PROFILES[prof].main, value, grade: x => gradeOf(relicScore(x, prof).ratio) };
  const lo = relicLoadout(advice, relics, c.id, opts);
  if (upgradeCache.size > UPGRADE_CACHE_MAX) upgradeCache.clear();
  // graine fixe et résultats gardés entre deux rendus : les chances affichées ne bougent pas d'un rendu à l'autre
  const ups = upgradeCandidates(lo, relics, c.id, { ...opts, valueOf: value, correctValue: () => RELIC_CORRECT_AT_15, rng: seededRng(1), cache: upgradeCache, keep });
  return { lo, ups };
}
function loadoutBlock(c, advice, prof) {
  if (!upgradeTrack || upgradeTrack.charId !== c.id) upgradeTrack = { charId: c.id, seen: new Map() };
  const seen = upgradeTrack.seen;
  const { lo, ups } = loadoutFor(c, advice, prof, trialRelics(c.id), new Set(seen.keys()));
  const comboText = !advice ? t('rl_lo_no_sets')
    : [lo.combo.cavern.map(p => `${p.name} (${p.pieces})`).join(' + '), lo.combo.planar ? `${lo.combo.planar} (2)` : ''].filter(Boolean).join(' + ');
  const farmText = f => t('rl_lo_farm', { what: [f.set, f.mains.map(statLabel).join(' / ')].filter(Boolean).join(' · ') || t('rl_lo_farm_any') });
  const rows = SLOTS.map(slot => {
    const s = lo.slots[slot], gone = s.state === 'swap' || s.state === 'swap_farm';
    const worn = s.worn ? `<span class="${gone ? 'lo-old' : ''}">${loadoutPiece(s.worn, prof)}</span>` : `<small class="hint">${t('rl_empty')}</small>`;
    const by = s.pick && s.pick.owner === c.id ? '' : s.pick ? `<button class="btn sm" data-action="tryRelic" data-slot="${slot}" data-id="${esc(s.pick.id)}">${t('sim_try_it')}</button>` : '';
    const pick = s.state === 'keep' ? `<span class="lo-st lo-keep">✓ ${t('rl_lo_keep')}</span>`
      : `${gone ? `<span class="lo-st lo-swap">⇄ ${t('rl_lo_swap')}</span>${loadoutPiece(s.pick, prof)} ${by}` : ''}
         ${s.farm ? `<span class="lo-st lo-farm">⚒ ${esc(farmText(s.farm))}</span>` : ''}`;
    return `<tr class="lo-${s.state}"><th>${t('slot_' + slot)}</th><td>${worn}</td><td>${pick}</td></tr>`;
  }).join('');
  const pct = x => Math.round(x * 100);
  const upRows = ups.map(u => {
    // « avant → après » gardé jusqu'à l'amélioration suivante (pas effacé par un autre rendu) ; l'éclat, seulement au moment où elle arrive
    const prev = seen.get(u.relic.id), moved = !!prev && u.relic.level > prev.level;
    const from = moved ? prev.chance : prev ? prev.from : null;
    seen.set(u.relic.id, { level: u.relic.level, chance: u.chance, from });
    const done = u.relic.level >= 15;
    const good = done ? u.chance >= 1 : u.chance >= UPGRADE_STOP;
    const verdict = t(done ? (good ? 'rl_lo_up_done_ok' : 'rl_lo_up_done_ko') : (good ? 'rl_lo_up_go' : 'rl_lo_up_stop'));
    const n = (from != null ? pct(from) + ' % → ' : '') + pct(u.chance);
    return `<div class="lo-up ${moved ? 'lo-up-moved' : ''}"><span class="lo-st lo-upg">⬆ ${t('slot_' + u.slot)}</span> ${loadoutPiece(u.relic, prof)}
      ${done ? '' : `<small>${t(u.rival ? 'rl_lo_up_beat' : 'rl_lo_up_correct', { n })}</small>`}
      <b class="lo-verdict ${good ? 'lo-go' : 'lo-stop'}">${verdict}</b>
      ${done ? '' : `<div class="lo-bar" role="img" aria-label="${pct(u.chance)} %"><i style="width:${pct(u.chance)}%"></i></div>`}</div>`;
  }).join('');
  const liveNote = liveNoteHtml('rl_lo_live_on', 'rl_lo_live_off', 'rl_lo_live_step3');
  return `<h3>${t('rl_loadout')}</h3>
    <p class="lo-sum"><span>${esc(comboText)}</span> <small>${t('rl_lo_counts', { swap: lo.counts.swap, farm: lo.counts.farm, up: ups.length })}</small></p>
    <table class="lo-table"><thead><tr><th></th><th>${t('rl_lo_worn')}</th><th>${t('rl_lo_pick')}</th></tr></thead><tbody>${rows}</tbody></table>
    ${upRows ? `<h4>${t('rl_lo_upgrade')}</h4>${upRows}<p class="hint small">${t('rl_lo_up_hint')}</p>${liveNote}` : ''}`;
}

/* État du suivi en direct (flux live de Reliquary Archiver, imports.js) : actif, ou comment l'activer.
   Les clés de texte changent selon ce qui est suivi (pièces à monter, coffres d'Aléas et reliques). */
function liveNoteHtml(onKey, offKey, step3Key) {
  const liveOn = typeof live !== 'undefined' && live && live.state === 'connected';
  return liveOn ? `<p class="lo-live on">● ${t(onKey)}</p>`
    : `<div class="lo-live"><p>${t(offKey)}</p><ol class="steps"><li>${t('rl_lo_live_step1')}</li><li>${t('rl_lo_live_step2')}</li><li>${t(step3Key)}</li></ol>
      <button class="btn sm" data-action="archLive">${t('arch_live')}</button></div>`;
}

/* ---- Aléas et reliques (Relic Recon) : sets à choisir, apport d'une Garantie, pièces tirées en direct ----
   (relicEventPlan, pulledRelics, pullVerdicts : relics.js ; spec 2026-11-14-aleas-reliques) */
/* Pièces tirées : d'après relicArrivals (imports.js), tenu à chaque import pour toute l'app ; rien avant le premier
   import en direct de la session. */
function eventBlock(c, advice, prof) {
  if (!relicEventActive(new Date()) || !S.relics.length) return '';
  const tr = relicArrivals;
  const relics = trialRelics(c.id);
  const value = x => relicScore(x, prof).useful;
  const opts = { element: c.element, profileMain: PROFILES[prof].main, value, grade: x => gradeOf(relicScore(x, prof).ratio) };
  const relevant = Object.entries(PROFILES[prof].weights).filter(([, w]) => w >= RELIC_RELEVANT_WEIGHT).map(([id]) => id);
  const current = advice ? loadoutFor(c, advice, prof, relics).lo.combo : null;
  if (upgradeCache.size > UPGRADE_CACHE_MAX) upgradeCache.clear();
  const plan = relicEventPlan(advice, relics, c.id, { ...opts, relevant, cache: upgradeCache, cacheTag: prof, currentCombo: current });
  const pulls = tr.base == null ? [] : pulledRelics(relics, tr.base, id => tr.first.get(id), plan.sets);
  const verdicts = pullVerdicts(advice, relics, pulls, c.id, opts);

  const sets = plan.sets;
  const setsHtml = !advice || !sets.cavern ? `<p>${t('ev_no_advice')}</p>`
    : `<p class="lo-sum"><span>${esc(t('ev_sets', { cavern: `${sets.cavern} (${sets.fourPiece ? 4 : 2})`, planar: sets.planar ? `${sets.planar} (2)` : '—' }))}</span></p>
       <p class="hint small">${t('ev_custom')}${sets.fourPiece ? '' : ' ' + t('ev_two_plus_two')}${plan.differs ? ' ' + t('ev_differs') : ''}</p>`;
  const pct = x => Math.round(x * 100);
  const vClass = { sure: 'lo-go', likely: 'lo-go', gamble: 'ev-gamble', useless: 'lo-stop' };
  const rows = SLOTS.map(slot => {
    const s = plan.slots[slot];
    const rival = s.rival ? loadoutPiece(s.rival, prof) : `<small class="hint">${t('rl_empty')}</small>`;
    const odds = s.rival ? `<small>${t('ev_chance', { n: pct(s.chance) })}</small>
      <div class="lo-bar" role="img" aria-label="${pct(s.chance)} %"><i style="width:${pct(s.chance)}%"></i></div>` : '';
    return `<tr><th>${t('slot_' + slot)}</th><td>${rival}</td><td>${odds}<b class="lo-verdict ${vClass[s.verdict]}">${t('ev_v_' + s.verdict)}</b></td></tr>`;
  }).join('');
  const pClass = { better: 'lo-go', worse: 'lo-stop', bad_main: 'lo-stop' };
  const pullRows = pulls.map(r => `<div class="lo-up"><span class="lo-st lo-upg">${t('slot_' + r.slot)}</span> ${loadoutPiece(r, prof)}
      <b class="lo-verdict ${pClass[verdicts[r.id]]}">${t('ev_p_' + verdicts[r.id])}</b></div>`).join('');
  return `<h3>${t('ev_title')}</h3>
    ${setsHtml}
    <table class="lo-table"><thead><tr><th></th><th>${t('ev_now')}</th><th>${t('ev_guarantee')}</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="lo-sum"><span>${t('ev_useful', { n: plan.useful })}</span></p>
    <p class="hint small">${t('ev_main_hint')}</p>
    <h4>${t('ev_pulls')}</h4>
    ${pullRows || `<p class="hint small">${t('ev_pulls_empty')}</p>`}
    ${liveNoteHtml('ev_live_on', 'ev_live_off', 'ev_live_step3')}`;
}

/* Bandeau sous le portrait : cône équipé et, s'il y a mieux dans l'inventaire, un lien vers l'onglet Cônes */
function coneBar(c) {
  if (!S.cones.length) return '';   // pas d'archive importée : on ne sait rien des cônes
  const r = rankings.get(c.id);
  const adv = r && r !== 'error' ? coneAdvice(r, S.cones, G.lightCones || [], c.id) : null;
  const eq = S.cones.find(o => o.owner === c.id), lc = eq && coneOf(G.lightCones, eq.id);
  const better = adv && adv.better;
  const by = better && better.owned.owner && better.owned.owner !== c.id ? ' · ' + t('cone_carried', { name: charName(charById(better.owned.owner)) }) : '';
  return `<div class="cone-bar">
    ${eq ? `<span class="lc-ic sm">${img(lc && lc.icon, 'lc-img')}</span><div><small>${t('cone_equipped_label')}</small><b>${esc(coneName(lc, eq.name))} S${eq.sup}</b></div>`
      : `<div><small>${t('cone_equipped_label')}</small><b class="none">${t('cone_none_equipped')}</b></div>`}
    ${better ? `<button class="cone-hint" data-action="sheetTab" data-tab="cones">${esc(t('cone_better', { name: coneName(better.lc) }) + by)}</button>` : ''}
  </div>`;
}

function renderSheet() {
  const c = charById(sheet.id); if (!c) return closeSheet();
  const g = gameChar(c), D = window.HSR_DETAILS && HSR_DETAILS[S.lang], d = g && D && D.chars[g.id];
  const root = modalRoot('sheet');
  const scroll = root.querySelector('.sheet') ? root.querySelector('.sheet').scrollTop : 0;
  const o = S.owned[c.id];
  let body;
  if (sheet.tab === 'cones') body = sheetCones(c);
  else if (sheet.tab === 'relics') body = sheetRelics(c);
  else if (sheet.tab === 'mats') body = g ? `<p class="hint small">${t('sheet_mats_hint')}</p>${matTable(matRows(aggregate([fullPlan(c)], false)))}` : `<p class="empty">${t('sheet_nodata')}</p>`;
  else if (!g) body = `<p class="empty">${t('sheet_nodata')}</p>`;
  else if (!d) body = `<p class="empty">${sheet.err ? t('sheet_error') : t('computing')}</p>`;
  else body = ({ skills: sheetSkills, traces: sheetTraces, eidolons: sheetRanks })[sheet.tab](d, D);
  root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(charName(c))}">
    <button class="sheet-close" data-action="closeSheet" title="${esc(t('close'))}" aria-label="${esc(t('close'))}">×</button>
    <div class="sheet-step">
      <button data-action="sheetStep" data-dir="-1" title="${esc(t('prev_char'))} (←)" aria-label="${esc(t('prev_char'))}">‹</button>
      <button data-action="sheetStep" data-dir="1" title="${esc(t('next_char'))} (→)" aria-label="${esc(t('next_char'))}">›</button>
    </div>
    <header class="sheet-hero r${c.rarity}">
      <div class="hero-art">${g ? img(g.preview || g.icon, 'hero-img', charName(c)) : `<span class="ini">${esc(initials(c))}</span>`}</div>
      <div class="hero-info">
        <span class="hero-stars">${'★'.repeat(c.rarity)}</span>
        <h2 class="hero-name">${esc(charName(c))}</h2>
        <div class="hero-meta">${elChip(c.element)} ${pathTag(c.path)}</div>
        <div class="hero-actions">
          <button class="btn ${o ? 'ok' : ''}" data-action="toggleOwned" data-id="${c.id}">${o ? t('owned') : t('add')}</button>
          ${g ? `<button class="btn" data-action="planFromSheet" data-id="${c.id}">${t('add_plan')}</button>` : ''}
        </div>
      </div>
    </header>
    ${coneBar(c)}
    <nav class="sheet-tabs">${SHEET_TABS.map(k => `<button class="${sheet.tab === k ? 'active' : ''}" data-action="sheetTab" data-tab="${k}">${t('sheet_' + k)}</button>`).join('')}</nav>
    <div class="sheet-body">${body}</div>
  </div>`;
  root.querySelector('.sheet').scrollTop = scroll;
}

function sheetSkills(d) {
  return d.skills.map(([name, type, eff, desc, params, icon, kind], i) => {
    const max = Math.max(1, params.length);
    const lv = Math.min(max, sheet.lv[i] || DEFAULT_SKILL_LV[kind] || 1);
    return `<article class="skill">
      <div class="skill-head">${img(icon, 'skill-ico')}
        <div class="skill-title"><b>${esc(name)}</b><small>${esc(type)}${eff ? ' · ' + esc(eff) : ''}</small></div>
        ${max > 1 ? `<label class="skill-lv">${t('lvl')}<select data-action="skillLv" data-i="${i}">${range(1, max).map(l => opt(l, l, lv)).join('')}</select></label>` : ''}
      </div>
      <p>${fmtDesc(desc, params[lv - 1])}</p>
    </article>`;
  }).join('');
}

function sheetTraces(d, D) {
  const stats = Object.entries(d.stats).map(([k, v]) => `<li><span>${esc(D.props[k] || k)}</span><b>+${fmtProp(k, v)}</b></li>`).join('');
  return `<h3>${t('sheet_major')}</h3>
    ${d.major.map(([n, desc, params, icon]) => `<article class="skill"><div class="skill-head">${img(icon, 'skill-ico')}<div class="skill-title"><b>${esc(n)}</b></div></div><p>${fmtDesc(desc, params)}</p></article>`).join('')}
    ${stats ? `<h3>${t('sheet_stats_bonus')}</h3><ul class="stat-bonus">${stats}</ul>` : ''}`;
}

function sheetRanks(d) {
  return d.ranks.map(([n, desc, icon], i) => `<article class="skill eidolon ${S.owned[sheet.id] && (S.owned[sheet.id].e || 0) > i ? 'unlocked' : ''}">
    <div class="skill-head">${img(icon, 'skill-ico')}<div class="skill-title"><small>E${i + 1}</small><b>${esc(n)}</b></div></div>
    <p>${fmtDesc(desc, [])}</p></article>`).join('');
}

/* actions des boutons et listes (data-action), branchées dans main.js */
Object.assign(actions, {
  openSheet: b => openSheet(b.dataset.id),
  openSheetRelics: b => { openSheet(b.dataset.id); sheet.tab = 'relics'; renderSheet(); },
  closeSheet: () => closeSheet(),
  sheetStep: b => sheetStep(+b.dataset.dir),
  sheetTab: b => { sheet.tab = b.dataset.tab; renderSheet(); },
  // simulateur de build (onglet Reliques) : l'essai ne change rien d'autre que l'affichage
  trySlot: el => { sheet.trial = { ...trialOf() }; if (el.value) sheet.trial[el.dataset.slot] = el.value; else delete sheet.trial[el.dataset.slot]; renderSheet(); },
  tryRelic: b => { sheet.trial = { ...trialOf(), [b.dataset.slot]: b.dataset.id }; renderSheet(); },
  resetTrial: () => { sheet.trial = {}; renderSheet(); },
  keepBuild: b => {
    const id = b.dataset.id, cur = {};
    for (const r of S.relics) if (r.owner === id) cur[r.slot] = r.id;
    S.builds[id] = { ...cur, ...trialOf() };
    sheet.trial = {}; save(); renderSheet(); toast(t('sim_kept_toast'));
  },
  dropBuild: b => { delete S.builds[b.dataset.id]; save(); renderSheet(); },
  skillLv: el => { sheet.lv[+el.dataset.i] = +el.value; renderSheet(); },
  planFromSheet: b => {
    const c = charById(b.dataset.id);
    S.plans.push({ id: uid(), ...fullPlan(c), lc: { on: false, lvTo: 80 }, on: true });
    save(); toast(t('plan_added'));
  },
  setEidolon: el => { S.owned[el.dataset.id].e = +el.value; save(); },
  setProfile: el => { S.owned[el.dataset.id].profile = el.value; save(); },
});
