/* HSR Companion — onglet Reliques
   Évaluateur et liste des reliques. */
'use strict';

/* ================================================================== RELIQUES */
const gradeOf = ratio => ratio >= 0.7 ? 'S' : ratio >= 0.55 ? 'A' : ratio >= 0.4 ? 'B' : ratio >= 0.25 ? 'C' : 'D';
function relicScore(r, prof) {
  const P = PROFILES[prof]; if (!P) return null;
  const subs = r.subs.filter(s => s.stat && s.val > 0);
  let useful = 0;
  for (const s of subs) useful += (s.val / SUBSTATS[s.stat].roll[2]) * (P.weights[s.stat] || 0);
  const expected = Math.min(9, Math.max(subs.length, 3) + Math.floor(r.level / 3));
  const ratio = expected ? useful / expected : 0;
  const grade = gradeOf(ratio);
  let mainOk = true;
  const allowed = P.main[r.slot];
  if (allowed) {
    const owner = r.owner && charById(r.owner);
    mainOk = allowed.includes(r.main) || (allowed.includes('elem') && r.main.startsWith('dmg_') && (!owner || r.main === 'dmg_' + owner.element));
  }
  return { useful, ratio, grade, mainOk };
}
const bestProfile = r => PROFILE_IDS.map(p => [p, relicScore(r, p)]).filter(([, s]) => s.mainOk || r.slot === 'head' || r.slot === 'hands').sort((a, b) => b[1].ratio - a[1].ratio)[0] || [PROFILE_IDS[0], relicScore(r, PROFILE_IDS[0])];
const fmtStat = (stat, val) => (stat.startsWith('dmg_') || SUBSTATS[stat]?.pct || ['heal', 'err', 'be', 'cr', 'cd', 'ehr'].includes(stat)) ? `${(+val).toLocaleString(locale(), { maximumFractionDigits: 1 })} %` : (+val).toLocaleString(locale(), { maximumFractionDigits: 1 });

function readRelicForm() {
  return {
    slot: $('#rlSlot').value, set: $('#rlSet').value.trim(), main: $('#rlMain').value,
    level: clamp(parseInt($('#rlLevel').value, 10) || 0, 0, 15), owner: $('#rlOwner').value || null,
    subs: range(0, 3).map(i => ({ stat: $('#rlSub' + i).value, val: parseFloat(String($('#rlVal' + i).value).replace(',', '.')) || 0 }))
  };
}

function renderRelics(v) {
  const owned = ownedChars().sort(byName);
  const filt = S.relicOwnerFilter;
  const all = S.relics.filter(r => !filt || (filt === '_none' ? !r.owner : r.owner === filt))
    .filter(r => !S.relicSlotFilter || r.slot === S.relicSlotFilter);
  // tri : meilleure note d'abord (pratique avec des centaines de reliques importées)
  if (S.relicSort === 'score') all.sort((a, b) => scoreFor(b)[1].ratio - scoreFor(a)[1].ratio);
  else if (S.relicSort === 'worst') all.sort((a, b) => scoreFor(a)[1].ratio - scoreFor(b)[1].ratio);
  const shown = S.relicShow || 60;
  const list = all.slice(0, shown);
  v.innerHTML = `
  <section class="panel">
    <h2>${t('relics_title')}</h2>
    <p class="hint">${t('relics_hint')}</p>
    <div class="relic-form">
      <label class="field">${t('slot')}<select id="rlSlot" data-action="relicSlot">${SLOTS.map(s => opt(s, t('slot_' + s), 'body')).join('')}</select></label>
      <label class="field span2">${t('set')}<input id="rlSet" list="setList" placeholder="${esc(t('set_ph'))}"><datalist id="setList">${RELIC_SETS.concat(PLANAR_SETS).map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
      <label class="field">${t('main_stat')}<select id="rlMain">${MAIN_STATS.body.map(s => opt(s, statLabel(s))).join('')}</select></label>
      <label class="field">${t('level')}<input type="number" id="rlLevel" min="0" max="15" value="15"></label>
      <label class="field">${t('owner')}<select id="rlOwner">${opt('', t('nobody'))}${owned.map(c => opt(c.id, charName(c))).join('')}</select></label>
      <div class="subs span-all">${range(0, 3).map(i => `<div class="sub-row"><select id="rlSub${i}">${opt('', t('substat') + ' ' + (i + 1))}${SUBSTAT_IDS.map(s => opt(s, statLabel(s))).join('')}</select><input id="rlVal${i}" type="text" inputmode="decimal" placeholder="${esc(t('value'))}"></div>`).join('')}</div>
      <div id="relicPreview" class="relic-preview span-all"></div>
      <button class="btn primary" data-action="addRelic">${t('add_relic')}</button>
    </div>
  </section>
  <section class="panel">
    <div class="panel-head"><h3>${t('my_relics')} <span class="badge">${S.relics.length}</span></h3>
      <div class="toolbar">
        <select data-action="relicFilter">${opt('', t('all_owners'), filt)}${opt('_none', t('nobody'), filt)}${owned.map(c => opt(c.id, charName(c), filt)).join('')}</select>
        <select data-action="relicSlotFilter">${opt('', t('all_slots'), S.relicSlotFilter || '')}${SLOTS.map(s => opt(s, t('slot_' + s), S.relicSlotFilter || '')).join('')}</select>
        <select data-action="relicSort">${['recent', 'score', 'worst'].map(k => opt(k, t('sort_' + k), S.relicSort || 'recent')).join('')}</select>
      </div></div>
    ${list.length ? `<div class="relic-grid">${list.map(relicCard).join('')}</div>` : `<p class="empty">${t('no_relics')}</p>`}
    ${all.length > shown ? `<button class="btn" data-action="relicMore">${t('show_more', { n: shown, total: all.length })}</button>` : ''}
  </section>`;
  updateRelicPreview();
}

function scoreFor(r) {   // appelé dans les tris et pour chaque perso d'équipe : mémorisé
  let res = relicScores.get(r);
  if (!res) {
    const owner = r.owner && charById(r.owner);
    if (owner) { const p = profileOf(owner); res = [p, relicScore(r, p), false]; }
    else { const [p, s] = bestProfile(r); res = [p, s, true]; }
    relicScores.set(r, res);
  }
  return res;
}

function relicCard(r, o = {}) {   // o.readOnly : sans bouton de suppression (fiche du perso)
  const owner = r.owner && charById(r.owner);
  const [prof, s, isBest] = scoreFor(r);
  const w = PROFILES[prof].weights;
  return `<div class="relic-card grade-${s.grade}">
    <div class="rc-head"><span class="slot-ico">${relicPieceImg(r) || esc(t('slot_' + r.slot).slice(0, 2).toUpperCase())}</span>
      <div><b>${t('slot_' + r.slot)} +${r.level}</b><small>${esc(r.set || t('unknown_set'))}</small></div>
      <span class="grade">${s.grade}</span></div>
    <div class="rc-main ${s.mainOk ? '' : 'bad'}">${statIcon(r.main)}${statLabel(r.main)} ${s.mainOk ? '' : `<small>${t('main_bad')}</small>`}</div>
    <ul class="rc-subs">${r.subs.filter(x => x.stat).map(x => `<li class="${(w[x.stat] || 0) >= 0.75 ? 'good' : (w[x.stat] || 0) > 0 ? 'mid' : 'dead'}">${statIcon(x.stat)}<span>${statLabel(x.stat)}</span><b>${fmtStat(x.stat, x.val)}</b></li>`).join('')}</ul>
    <div class="rc-foot"><small>${owner ? esc(charName(owner)) : t('nobody')} · ${isBest ? t('best_for') + ' ' : ''}${t('prof_' + prof)}</small>
      <small>${t('useful_rolls', { n: s.useful.toFixed(1) })}</small>
      ${o.readOnly ? '' : `<button class="btn sm danger" data-action="delRelic" data-id="${r.id}" title="${esc(t('delete'))}" aria-label="${esc(t('delete'))}">×</button>`}</div>
  </div>`;
}
/* Icône de la pièce : icon/relic/{set}_{index} (tête/sphère 0, mains/corde 1, torse 2, pieds 3) */
const PIECE_INDEX = { head: 0, hands: 1, body: 2, feet: 3, sphere: 0, rope: 1 };
const relicPieceImg = r => { const s = G.relicSets[norm(r.set)]; return s ? img(`icon/relic/${s[1]}_${PIECE_INDEX[r.slot]}.png`, 'set-ico', r.set) : ''; };
const statIcon = s => G.stats && G.stats[s] ? img(G.stats[s], 'stat-ico') : '';

function updateRelicPreview() {
  const box = $('#relicPreview'); if (!box) return;
  const r = readRelicForm();
  if (!r.subs.some(s => s.stat && s.val)) { box.innerHTML = `<span class="hint small">${t('preview_hint')}</span>`; return; }
  const [prof, s, isBest] = scoreFor(r);
  const verdict = s.grade === 'S' || s.grade === 'A' ? t('verdict_keep') : s.grade === 'B' ? t('verdict_ok') : t('verdict_trash');
  box.innerHTML = `<span class="grade-pill grade-${s.grade}"><span>${s.grade}</span></span> <b>${verdict}</b> — ${t('useful_rolls', { n: s.useful.toFixed(1) })} · ${isBest ? t('best_for') + ' ' : ''}${t('prof_' + prof)}${s.mainOk ? '' : ` · <span class="warn-txt">${t('main_bad')}</span>`}`;
}

/* actions des boutons et listes (data-action), branchées dans main.js */
Object.assign(actions, {
  relicSlotFilter: el => { S.relicSlotFilter = el.value; S.relicShow = 60; save(); render(); },
  relicSort: el => { S.relicSort = el.value; save(); render(); },
  relicMore: () => { S.relicShow = (S.relicShow || 60) + 120; save(); render(); },
  relicSlot: el => {
    $('#rlMain').innerHTML = MAIN_STATS[el.value].map(s => opt(s, statLabel(s))).join('');
    updateRelicPreview();
  },
  addRelic: () => {
    const r = readRelicForm();
    if (!r.subs.some(s => s.stat)) return toast(t('err_subs'));
    S.relics.unshift({ id: uid(), ...r });
    save(); render(); toast(t('added'));
  },
  delRelic: b => { S.relics = S.relics.filter(r => r.id !== b.dataset.id); save(); render(); },
  relicFilter: el => { S.relicOwnerFilter = el.value; S.relicShow = 60; save(); render(); },
});
