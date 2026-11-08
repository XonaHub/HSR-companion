/* HSR Companion — onglet Personnages
   Grille des persos, inventaire des cônes, persos personnalisés. */
'use strict';

/* ================================================================== PERSONNAGES */
function rosterSwitch() {
  return `<div class="seg" role="group">${['chars', 'cones'].map(k =>
    `<button class="${S.rosterView === k ? 'on' : ''}" data-action="rosterView" data-view="${k}" aria-pressed="${S.rosterView === k}">${t('rv_' + k)}</button>`).join('')}</div>`;
}
function renderRoster(v) {
  if (S.rosterView === 'cones') return renderConeInventory(v);
  const f = S.rosterFilter;
  v.innerHTML = rosterSwitch() + gameAlertNote() + `
  <section class="panel">
    <h3>${t('acc_title')}</h3>
    <div class="import-box">
      <b>${t('arch_title')}</b>
      <ol class="steps">
        <li>${t('arch_step1')}</li>
        <li>${t('arch_step2')}</li>
        <li>${t('arch_step3')}</li>
      </ol>
      <div class="form-row">
        <button class="btn primary" data-action="archLive">${live ? t('arch_live_stop') : t('arch_live')}</button>
        <label class="btn">${t('arch_file')}<input type="file" id="archFile" accept=".json,application/json" hidden></label>
        <span class="live-status ${live ? live.state : ''}">${live ? t('arch_state_' + live.state) : ''}</span>
      </div>
      <div id="archOut">${S.lastArchive ? archiveSummary(S.lastArchive) : ''}</div>
      <p class="hint small">${t('arch_note')}</p>
    </div>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>${t('roster_title')}</h2><span class="badge" id="ownedBadge"></span></div>
    <p class="hint">${t('roster_hint')}</p>
    <div class="toolbar">
      <input type="search" placeholder="${esc(t('search'))}" value="${esc(f.q)}" data-filter="q">
      <select data-filter="el">${opt('', t('all_elements'), f.el)}${ELEMENTS.map(e => opt(e, t('el_' + e), f.el)).join('')}</select>
      <select data-filter="path">${opt('', t('all_paths'), f.path)}${PATHS.map(p => opt(p, t('path_' + p), f.path)).join('')}</select>
      <select data-filter="rar">${opt('', t('all_rarities'), f.rar)}${opt('5', '5★', f.rar)}${opt('4', '4★', f.rar)}</select>
      <label class="check"><input type="checkbox" data-filter="owned" ${f.owned ? 'checked' : ''}> ${t('owned_only')}</label>
    </div>
    <div id="rosterGrid" class="char-grid"></div>
  </section>
  <section class="panel">
    <h3>${t('custom_title')}</h3>
    <p class="hint">${t('custom_hint')}</p>
    <div class="form-row">
      <input id="cuName" placeholder="${esc(t('name'))}">
      <select id="cuRar">${opt(5, '5★', 5)}${opt(4, '4★')}</select>
      <select id="cuEl">${ELEMENTS.map(e => opt(e, t('el_' + e))).join('')}</select>
      <select id="cuPath">${PATHS.map(p => opt(p, t('path_' + p))).join('')}</select>
      <button class="btn primary" data-action="addCustom">${t('add')}</button>
    </div>
    ${S.custom.length ? `<div class="chip-list">${S.custom.map(c => `<span class="tag">${esc(c.name)} · ${c.rarity}★ · ${t('el_' + c.element)} · ${t('path_' + c.path)} <button class="x" data-action="delCustom" data-id="${c.id}" title="${esc(t('delete'))}" aria-label="${esc(t('delete'))} — ${esc(c.name)}">×</button></span>`).join('')}</div>` : ''}
  </section>`;
  renderRosterGrid();
}

/* Persos de la grille, filtrés et triés comme affichés (aussi l'ordre des flèches dans la fiche) */
function rosterOrder() {
  const f = S.rosterFilter, q = f.q.trim().toLowerCase();
  return allChars().filter(c =>
    (!q || charName(c).toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) &&
    (!f.el || c.element === f.el) && (!f.path || c.path === f.path) &&
    (!f.rar || c.rarity === +f.rar) && (!f.owned || S.owned[c.id])
  ).sort((a, b) => b.rarity - a.rarity || byName(a, b));
}
function renderRosterGrid() {
  const list = rosterOrder();
  const ownedCount = ownedChars().length;
  $('#ownedBadge').textContent = t('owned_count', { n: ownedCount, total: allChars().length });
  $('#rosterGrid').innerHTML = list.length ? list.map(charCard).join('') : `<p class="empty">${t('no_results')}</p>`;
}

/* Inventaire des cônes : tous les cônes importés, filtrés par Voie, rareté, équipés. Les cônes absents
   des données du jeu gardent le nom de l'archive, sans icône ni Voie/rareté (ils sortent des filtres Voie et rareté). */
function renderConeInventory(v) {
  const f = S.coneFilter;
  v.innerHTML = rosterSwitch() + `
  <section class="panel">
    <div class="panel-head"><h2>${t('rv_cones')}</h2><span class="badge" id="coneBadge"></span></div>
    <div class="toolbar">
      <select data-cfilter="path">${opt('', t('all_paths'), f.path)}${PATHS.map(p => opt(p, t('path_' + p), f.path)).join('')}</select>
      <select data-cfilter="rar">${opt('', t('all_rarities'), f.rar)}${opt('5', '5★', f.rar)}${opt('4', '4★', f.rar)}${opt('3', '3★', f.rar)}</select>
      <label class="check"><input type="checkbox" data-cfilter="equipped" ${f.equipped ? 'checked' : ''}> ${t('cones_equipped_only')}</label>
    </div>
    <div id="coneGrid" class="cone-grid"></div>
  </section>`;
  renderConeGrid();
}
/* Meilleurs classements Prydwen déjà en mémoire (aucune requête ici) : lcId → [{ rank, c, updated }] dans l'ordre des persos possédés.
   coneAdvice n'est calculé qu'une fois par perso, pas une fois par cône. */
function coneTops() {
  const map = new Map();
  for (const c of ownedChars()) {
    const r = rankings.get(c.id);
    if (!r || r === 'error') continue;
    const adv = coneAdvice(r, S.cones, G.lightCones || [], c.id);
    for (const e of adv.mine.concat(adv.target)) {
      if (!map.has(e.lc.id)) map.set(e.lc.id, []);
      map.get(e.lc.id).push({ rank: e.rank, c, updated: r.updated || '' });
    }
  }
  return map;
}
const coneTopOf = (tops, lc) => (tops.get(lc.id) || []).reduce((best, e) => (!best || e.rank < best.rank ? e : best), null);
function renderConeGrid() {
  const f = S.coneFilter;
  const list = S.cones.map(o => ({ o, lc: coneOf(G.lightCones || [], o.id) })).filter(({ o, lc }) =>
    (!f.path || (lc && lc.path === f.path)) && (!f.rar || (lc && lc.rarity === +f.rar)) && (!f.equipped || o.owner)
  ).sort((a, b) => ((b.lc ? b.lc.rarity : 0) - (a.lc ? a.lc.rarity : 0)) ||
    coneName(a.lc, a.o.name).localeCompare(coneName(b.lc, b.o.name), S.lang));
  $('#coneBadge').textContent = t('cones_count', { n: list.length, total: S.cones.length });
  const tops = coneTops(), shown = [];
  $('#coneGrid').innerHTML = list.length ? list.map(({ o, lc }) => {
    const owner = o.owner && charById(o.owner), top = lc && coneTopOf(tops, lc);
    if (top) shown.push(top);
    const sub = [`S${o.sup}`, t('lvl') + ' ' + o.level, lc && lc.path ? t('path_' + lc.path) : ''].filter(Boolean).join(' · ');
    return `<div class="cone-card${lc ? ' r' + lc.rarity : ''}">
      <span class="lc-ic">${lc ? img(lc.icon, 'lc-img', coneName(lc)) : ''}</span>
      <div><b>${esc(coneName(lc, o.name))}${lc ? `<span class="cone-star">${lc.rarity}★</span>` : ''}</b><small>${esc(sub)}</small>
        ${o.owner ? `<span class="ctag eq">${esc(owner ? charName(owner) : t('cone_tag_equipped'))}</span>` : `<span class="ctag free">${t('cone_free')}</span>`}
        ${top ? `<span class="cone-rec">${esc(t('cone_top', { n: top.rank, name: charName(top.c) }))}</span>` : ''}</div>
    </div>`;
  }).join('') : `<p class="empty">${t(S.cones.length ? 'no_results' : 'cones_none')}</p>`;
  // source (et date la plus ancienne) des classements affichés
  const oldest = shown.map(x => x.updated).filter(Boolean).sort()[0];
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(oldest || '');
  const note = !shown.length ? '' : m ? t('cones_rank_src_date', { date: new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(locale()) }) : t('cones_rank_src');
  let el = $('#coneRankSrc');
  if (!el) { el = document.createElement('p'); el.id = 'coneRankSrc'; el.className = 'lc-src'; $('#coneGrid').after(el); }
  el.textContent = note;
}

function charCard(c) {
  const o = S.owned[c.id];
  const g = gameChar(c);
  // clic sur la carte : fiche du perso ; le bouton en coin marque le perso comme possédé (ou le retire)
  const tip = `${charName(c)} · ${t('el_' + c.element)} · ${t('path_' + c.path)} — ${t('open_sheet')}`;
  const own = o ? t('unmark_owned') : t('mark_owned');
  return `<div class="char-card ${o ? 'owned' : ''}" style="--el:${EL_COLORS[c.element]}">
    <button class="tile r${c.rarity}" data-action="openSheet" data-id="${c.id}" title="${esc(tip)}">
      <div class="tile-art">
        <span class="ini">${esc(initials(c))}</span>
        ${g ? img(g.icon, 'av-img') : ''}
        ${img(G.elements[c.element], 'tile-el')}${img(G.paths[c.path], 'tile-path')}
        <span class="tile-stars">${'★'.repeat(c.rarity)}</span>
        ${o ? '<span class="tile-check"></span>' : ''}
      </div>
      <div class="tile-name">${esc(charName(c))}</div>
    </button>
    <button class="tile-info tile-own" data-action="toggleOwned" data-id="${c.id}" title="${esc(own)}" aria-label="${esc(own)} — ${esc(charName(c))}" aria-pressed="${!!o}">${o ? '−' : '+'}</button>
    ${o ? `<div class="char-extra">
      <label>${t('eidolon')}<select data-action="setEidolon" data-id="${c.id}">${range(0, 6).map(i => opt(i, 'E' + i, o.e || 0)).join('')}</select></label>
      <label>${t('relic_profile')}<select data-action="setProfile" data-id="${c.id}">${PROFILE_IDS.map(p => opt(p, t('prof_' + p), profileOf(c))).join('')}</select></label>
    </div>` : ''}
  </div>`;
}

/* actions des boutons et listes (data-action), branchées dans main.js */
Object.assign(actions, {
  rosterView: b => { S.rosterView = b.dataset.view; save(); render(); },
  toggleOwned: b => {
    const id = b.dataset.id;
    if (S.owned[id]) delete S.owned[id]; else S.owned[id] = { e: 0 };
    save();
    if ($('#rosterGrid')) renderRosterGrid();
    if (sheet) renderSheet();
  },
  addCustom: () => {
    const name = $('#cuName').value.trim();
    if (!name) return toast(t('err_name'));
    S.custom.push({ id: 'custom-' + uid(), name, rarity: +$('#cuRar').value, element: $('#cuEl').value, path: $('#cuPath').value, custom: true });
    save(); render(); toast(t('added'));
  },
  delCustom: b => {
    const id = b.dataset.id;
    S.custom = S.custom.filter(c => c.id !== id); delete S.owned[id];
    save(); render();
  },
});
