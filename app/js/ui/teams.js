/* HSR Companion — onglet Équipes
   Constructeur par mode, Mes équipes, fenêtre de création. */
'use strict';

/* ================================================================== ÉQUIPES */
/* Survie : Voie Abondance/Préservation, ou rôle de soigneur/bouclier hors de ces Voies
   (ex. Perle, Allégresse ; Hyacine, Souvenir). Le rôle vient du profil de reliques du perso. */
const isSustainChar = c => SUSTAIN_PATHS.includes(c.path) || ['healer', 'shielder'].includes(profileOf(c));
const isDpsChar = c => !isSustainChar(c) && c.path !== 'harmony' &&
  (DPS_PATHS.includes(c.path) || ['crit_atk', 'crit_hp', 'dot', 'break'].includes(profileOf(c)));

function analyzeTeam(ids) {
  const m = ids.map(charById).filter(Boolean);
  const notes = [];
  if (!m.length) return notes;
  if (m.length < 4) notes.push(['info', t('team_incomplete', { n: m.length })]);
  if (!m.some(isSustainChar)) notes.push(['warn', t('warn_no_sustain')]);
  const dps = m.filter(isDpsChar).length;
  // Équipe Allégresse : construite autour de plusieurs persos Allégresse qui jouent ensemble,
  // donc ni « trop de DPS » ni « il manque un support » ne s'appliquent.
  const elationTeam = m.filter(c => c.path === 'elation').length >= 2;
  if (dps === 0) notes.push(['warn', t('warn_no_dps')]);
  if (dps >= 3 && !elationTeam) notes.push(['warn', t('warn_many_dps')]);
  const isSupport = c => SUPPORT_PATHS.includes(c.path) || ['support', 'debuffer'].includes(profileOf(c));
  if (!elationTeam && !m.some(isSupport)) notes.push(['info', t('tip_support')]);
  if (elationTeam) notes.push(['info', t('elation_team')]);
  if (S.weak.length) {
    const hit = m.filter(c => S.weak.includes(c.element)).length;
    notes.push(hit ? ['ok', t('weak_match', { n: hit, total: m.length })] : ['warn', t('warn_no_weak')]);
  }
  const notOwned = m.filter(c => !S.owned[c.id]);
  if (notOwned.length) notes.push(['info', t('not_owned', { names: esc(notOwned.map(charName).join(', ')) })]);
  if (!notes.some(n => n[0] === 'warn') && m.length === 4) notes.unshift(['ok', t('team_ok')]);
  return notes;
}

/* ---------- Mes équipes (équipes jouées / créées en jeu) ---------- */
const teamChars = tm => tm.members.map(charById).filter(Boolean);

/* Type deviné d'après les membres (modifiable à la main) */
function guessTeamType(members) {
  const m = members.map(charById).filter(Boolean);
  if (!m.length) return 'other';
  const count = f => m.filter(f).length;
  if (count(c => profileOf(c) === 'break') >= 2) return 'break';
  if (count(c => profileOf(c) === 'dot') >= 2) return 'dot';
  if (count(c => c.path === 'elation') >= 2) return 'elation';
  const dps = count(isDpsChar);
  if (dps >= 2) return 'dual';
  if (dps === 1) return 'hypercarry';
  return 'other';
}
const teamType = tm => tm.type || guessTeamType(tm.members);
function teamName(tm) {
  if (tm.name) return tm.name;
  const m = teamChars(tm);
  if (!m.length) return t('team_untitled');
  const lead = m.find(isDpsChar) || m[0];
  return t('team_of', { name: charName(lead) });   // le type est déjà affiché à côté
}

/* Note moyenne des reliques équipées sur un perso (null s'il n'en a aucune) */
function relicGradeOf(charId) {
  if (!relicGrades) {   // un seul passage sur toutes les reliques pour tous les persos
    const sum = {}, count = {};
    for (const r of S.relics) if (r.owner) { sum[r.owner] = (sum[r.owner] || 0) + scoreFor(r)[1].ratio; count[r.owner] = (count[r.owner] || 0) + 1; }
    relicGrades = Object.fromEntries(Object.keys(sum).map(id => [id, gradeOf(sum[id] / count[id])]));
  }
  return relicGrades[charId] || null;
}

/* Persos présents dans plusieurs équipes principales */
function mainDuplicates() {
  const seen = {};
  for (const tm of S.myTeams.filter(x => x.main)) for (const id of new Set(tm.members.filter(Boolean))) seen[id] = (seen[id] || 0) + 1;
  return new Set(Object.keys(seen).filter(id => seen[id] > 1));
}

function teamMemberCell(id) {
  const c = id && charById(id);
  if (!c) return '<span class="mt-member empty"><span class="avatar sm empty">+</span></span>';
  const o = S.owned[c.id], grade = relicGradeOf(c.id);
  return `<button class="mt-member" data-action="openSheet" data-id="${c.id}" title="${esc(charName(c))}">
    ${avatar(c, 'sm')}
    <span class="mt-grade ${grade ? 'grade-' + grade : 'none'}" title="${esc(t('relic_avg'))}">${grade || '—'}</span>
    <small>${o ? `E${o.e || 0}${o.lvl ? ' · ' + o.lvl : ''}` : t('not_owned_short')}</small>
  </button>`;
}

function myTeamRow(tm, dups) {
  const dupNames = tm.main ? tm.members.filter(id => id && dups.has(id)).map(id => charName(charById(id))) : [];
  const type = teamType(tm);
  return `<div class="myteam ${tm.main ? 'main' : ''}">
    <button class="star-btn ${tm.main ? 'on' : ''}" data-action="teamStar" data-id="${tm.id}" title="${esc(t('team_main'))}" aria-label="${esc(t('team_main'))}" aria-pressed="${!!tm.main}">★</button>
    <div class="mt-members">${tm.members.map(teamMemberCell).join('')}</div>
    <div class="mt-info">
      <div class="mt-title"><b>${esc(teamName(tm))}</b><span class="type-tag">${t('type_' + type)}</span></div>
      ${tm.note ? `<small class="mt-note">${esc(tm.note)}</small>` : ''}
      ${dupNames.length ? `<small class="warn-txt">${t('dup_in_main', { names: esc([...new Set(dupNames)].join(', ')) })}</small>` : ''}
    </div>
    <div class="mt-actions">
      <select data-action="teamSend" data-id="${tm.id}" title="${esc(t('send_to'))}">
        <option value="">${t('send_to')}</option>
        ${ENDGAME_MODES.map(mo => `<optgroup label="${esc(t('mode_' + mo))}">${[0, 1].map(s => `<option value="${mo}:${s}">${esc(t('mode_' + mo))} · ${t('team')} ${s + 1}</option>`).join('')}</optgroup>`).join('')}
      </select>
      <button class="btn sm" data-action="teamEdit" data-id="${tm.id}">${t('edit')}</button>
      <button class="btn sm danger" data-action="teamDel" data-id="${tm.id}" title="${esc(t('delete'))}" aria-label="${esc(t('delete'))}">×</button>
    </div>
  </div>`;
}

function myTeamsSection() {
  const f = S.teamFilter || 'all';
  const types = TEAM_TYPES.filter(ty => S.myTeams.some(tm => teamType(tm) === ty));
  const list = S.myTeams.filter(tm => f === 'all' || (f === 'main' ? tm.main : teamType(tm) === f))
    .sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0));
  const dups = mainDuplicates();
  const chip = (key, label) => `<button class="chip-toggle plain ${f === key ? 'on' : ''}" data-action="teamFilter" data-f="${key}">${label}</button>`;
  return `<section class="panel">
    <div class="panel-head myteams-head"><h2>${t('my_teams')} <span class="badge">${S.myTeams.length}</span></h2>
      <button class="btn primary" data-action="teamNew">${t('new_team')}</button></div>
    <p class="hint">${t('my_teams_hint')}</p>
    ${S.myTeams.length ? `<div class="weak-picker">${chip('all', t('filter_all'))}${chip('main', '★ ' + t('filter_main'))}${types.map(ty => chip(ty, t('type_' + ty))).join('')}</div>` : ''}
    ${list.length ? `<div class="myteams">${list.map(tm => myTeamRow(tm, dups)).join('')}</div>` : `<p class="empty">${t(S.myTeams.length ? 'no_results' : 'no_my_teams')}</p>`}
  </section>`;
}

/* ---------- fenêtre de création / modification ---------- */
let teamEdit = null;   // copie de travail : { id, name, type, members, main, note }
function openTeamEditor(id) {
  const src = id && S.myTeams.find(x => x.id === id);
  teamEdit = src ? JSON.parse(JSON.stringify(src)) : { id: null, name: '', type: '', members: [null, null, null, null], main: false, note: '' };
  renderTeamEditor();
}
function closeTeamEditor() {
  teamEdit = null;
  closeModal('teamEditor');
}

/* Fenêtres par-dessus la page (fiche perso, éditeur d'équipe) */

/* Case d'équipe : avatar, choix du perso, élément et Voie (attrs = data-* du <select>) */
function slotCell(id, attrs) {
  const c = id && charById(id);
  return `<div class="slot">${c ? avatar(c) : '<div class="avatar empty">+</div>'}
    <select ${attrs}>${charOptions(id, { allowEmpty: true })}</select>
    ${c ? `<small>${elChip(c.element)} ${pathTag(c.path)}</small>` : ''}</div>`;
}
const teamNotes = ids => `<ul class="notes">${analyzeTeam(ids.filter(Boolean)).map(([k, txt]) => `<li class="note ${k}">${txt}</li>`).join('')}</ul>`;
function syncTeamEditor() {   // récupère ce qui a été tapé avant de redessiner
  if (!teamEdit || !$('#teName')) return;
  teamEdit.name = $('#teName').value.trim();
  teamEdit.type = $('#teType').value;
  teamEdit.main = $('#teMain').checked;
  teamEdit.note = $('#teNote').value;
}
function renderTeamEditor() {
  const root = modalRoot('teamEditor');
  const tm = teamEdit, guess = guessTeamType(tm.members);
  const autoName = teamName({ ...tm, name: '' });
  root.innerHTML = `<div class="team-editor" role="dialog" aria-modal="true" aria-label="${esc(t(tm.id ? 'team_edit_title' : 'team_new_title'))}">
    <button class="sheet-close" data-action="teamCancel" title="${esc(t('close'))}" aria-label="${esc(t('close'))}">×</button>
    <h2>${t(tm.id ? 'team_edit_title' : 'team_new_title')}</h2>
    <div class="te-slots">${tm.members.map((id, i) => slotCell(id, `data-action="teMember" data-i="${i}"`)).join('')}</div>
    <div class="field-grid">
      <label class="field">${t('team_name')}<input id="teName" value="${esc(tm.name)}" placeholder="${esc(autoName)}" maxlength="60"></label>
      <label class="field">${t('team_type')}<select id="teType">${opt('', t('team_type_auto', { type: t('type_' + guess) }), tm.type)}${TEAM_TYPES.map(ty => opt(ty, t('type_' + ty), tm.type)).join('')}</select></label>
    </div>
    <label class="field">${t('team_note')}<textarea id="teNote" rows="3" maxlength="500" placeholder="${esc(t('team_note_ph'))}">${esc(tm.note)}</textarea></label>
    <label class="check"><input type="checkbox" id="teMain" ${tm.main ? 'checked' : ''}> ★ ${t('team_main')}</label>
    ${teamNotes(tm.members)}
    <div class="form-row te-actions">
      <button class="btn" data-action="teamCancel">${t('cancel')}</button>
      <button class="btn primary" data-action="teamSave">${t('save')}</button>
    </div>
  </div>`;
}
function saveTeamEditor() {
  syncTeamEditor();
  const tm = teamEdit;
  if (!tm.members.some(Boolean)) return toast(t('team_need_member'));
  if (tm.id) { const i = S.myTeams.findIndex(x => x.id === tm.id); if (i >= 0) S.myTeams[i] = tm; }
  else S.myTeams.push({ ...tm, id: uid() });
  save(); closeTeamEditor(); render(); toast(t('team_saved'));
}

function renderTeams(v) {
  const owned = ownedChars();
  const sugg = S.weak.length ? owned.filter(c => S.weak.includes(c.element)).sort((a, b) => b.rarity - a.rarity || byName(a, b)) : [];
  v.innerHTML = `
  ${myTeamsSection()}
  <section class="panel">
    <h2>${t('teams_title')}</h2>
    <p class="hint">${t('teams_hint')}</p>
    <div class="weak-picker"><span>${t('enemy_weak')}</span>
      ${ELEMENTS.map(e => `<button class="chip-toggle ${S.weak.includes(e) ? 'on' : ''}" style="--el:${EL_COLORS[e]}" data-action="toggleWeak" data-el="${e}">${elIcon(e)}${t('el_' + e)}</button>`).join('')}
    </div>
    ${S.weak.length ? `<div class="sugg"><small>${t('sugg_title')}</small>${sugg.length ? sugg.map(c => `<span class="tag">${avatar(c, 'xs')} ${esc(charName(c))}<small>${t('path_' + c.path)}</small></span>`).join('') : `<span class="hint small">${t('sugg_none')}</span>`}</div>` : ''}
  </section>
  ${ENDGAME_MODES.map(mode => {
    const teams = S.teams[mode];
    const used = teams.map(tm => tm.filter(Boolean));
    const dup = used[0].filter(id => used[1].includes(id));
    return `<section class="panel">
      <div class="panel-head"><h3>${t('mode_' + mode)}</h3><button class="btn sm" data-action="clearMode" data-mode="${mode}">${t('clear')}</button></div>
      ${dup.length ? `<p class="note warn">${t('warn_dup', { names: esc(dup.map(id => charName(charById(id))).join(', ')) })}</p>` : ''}
      <div class="teams-row">${teams.map((tm, ti) => `<div class="team-box">
        <h4>${t('team')} ${ti + 1}</h4>
        <div class="slots">${tm.map((id, si) => slotCell(id, `data-action="setSlot" data-mode="${mode}" data-team="${ti}" data-slot="${si}"`)).join('')}</div>
        ${teamNotes(tm)}
      </div>`).join('')}</div>
    </section>`;
  }).join('')}`;
}

/* actions des boutons et listes (data-action), branchées dans main.js */
Object.assign(actions, {
  toggleWeak: b => {
    const e = b.dataset.el;
    S.weak = S.weak.includes(e) ? S.weak.filter(x => x !== e) : S.weak.concat(e);
    save(); render();
  },
  setSlot: el => {
    S.teams[el.dataset.mode][+el.dataset.team][+el.dataset.slot] = el.value || null;
    save(); render();
  },
  clearMode: b => { S.teams[b.dataset.mode] = emptyTeams()[b.dataset.mode]; save(); render(); },
  // ---- Mes équipes
  teamNew: () => openTeamEditor(null),
  teamEdit: b => openTeamEditor(b.dataset.id),
  teamCancel: () => closeTeamEditor(),
  teamSave: () => saveTeamEditor(),
  teMember: el => { syncTeamEditor(); teamEdit.members[+el.dataset.i] = el.value || null; renderTeamEditor(); },
  teamDel: async b => {
    const tm = S.myTeams.find(x => x.id === b.dataset.id);
    if (!tm || !await ask({ title: t('delete'), text: t('confirm_del_team', { name: teamName(tm) }), ok: t('delete'), danger: true })) return;
    S.myTeams = S.myTeams.filter(x => x !== tm); save(); render();
  },
  teamStar: b => { const tm = S.myTeams.find(x => x.id === b.dataset.id); if (tm) { tm.main = !tm.main; save(); render(); } },
  teamFilter: b => { S.teamFilter = b.dataset.f; save(); render(); },
  teamSend: el => {
    const tm = S.myTeams.find(x => x.id === el.dataset.id);
    if (!tm || !el.value) return;
    const [mode, side] = el.value.split(':');
    S.teams[mode][+side] = tm.members.slice(0, 4);
    save(); render();
    toast(t('team_sent', { mode: t('mode_' + mode), n: +side + 1 }));
  },
});
