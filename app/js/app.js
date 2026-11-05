/* HSR Companion — logique de l'application (vanilla JS, aucune dépendance) */
(function () {
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
    warp: { jades: 0, passes: 0, charPity: 0, charGuar: false, lcPity: 0, lcGuar: false, days: 0, express: false, extra: 0, targetChar: 1, targetLc: 0 },
    history: [],
    relics: [],
    relicOwnerFilter: '',
    teams: emptyTeams(),
    myTeams: [],          // équipes personnelles : { id, name, type, members[4], main, note }
    teamFilter: 'all',
    weak: [],
    rates: { ...DEFAULT_RATES },
    rosterFilter: { q: '', el: '', path: '', rar: '', owned: false }
  });
  function merge(base, d) {
    for (const k in d) {
      const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
      base[k] = isObj(d[k]) && isObj(base[k]) ? merge(base[k], d[k]) : d[k];
    }
    return base;
  }
  /* ------------------------------------------------------------------ plateforme
     Tout ce qui diffère entre la page web (servie par tools/serve.py) et l'app de bureau (Tauri,
     backend dans src-tauri/src) est regroupé ici : le reste du code ne teste jamais la plateforme. */
  class OfflineError extends Error {}   // page web ouverte sans serve.py
  async function serverCall(path, body) {
    let res;
    try {
      res = await fetch(path, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { throw new OfflineError(); }
    if (!(res.headers.get('content-type') || '').includes('json')) throw new OfflineError();
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) throw new Error((data && data.error) || '');
    return data;
  }
  const TAURI = window.__TAURI__ && window.__TAURI__.core;
  const platform = TAURI ? {
    saved: () => window.__HSR_STATE__,   // data.json, injecté avant le chargement (src-tauri/src/lib.rs)
    persist: json => TAURI.invoke('save_state', { json }).catch(() => { /* localStorage reste à jour */ }),
    findGachaUrl: () => TAURI.invoke('gacha_find'),
    fetchGacha: (url, lang) => TAURI.invoke('gacha_fetch', { url, lang }),
    exportFile: (name, content) => TAURI.invoke('export_data', { name, content }).then(p => p && toast(p))   // « Enregistrer sous… »
  } : {
    saved: () => null,
    persist: () => {},
    findGachaUrl: () => serverCall('/api/gacha/find').then(d => d.url),
    fetchGacha: (url, lang) => serverCall('/api/gacha/fetch', { url, lang }),
    exportFile: (name, content) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' })); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  };
  // textes propres à l'app de bureau : la clé « xxx_app » remplace « xxx » (une chaîne vide masque le texte)
  if (TAURI) for (const dict of Object.values(I18N)) for (const k in dict) if (k.endsWith('_app')) dict[k.slice(0, -4)] = dict[k];

  /* ------------------------------------------------------------------ sauvegarde */
  function load() {
    // localStorage et, sous Tauri, data.json : on garde la copie la plus récente
    const found = [platform.saved()];
    try { const raw = localStorage.getItem(KEY); if (raw) found.push(JSON.parse(raw)); } catch (e) { /* stockage indisponible */ }
    let best = null;
    for (const d of found) if (d && typeof d === 'object' && (!best || (d.savedAt || 0) > (best.savedAt || 0))) best = d;
    return migrate(best ? merge(defaultState(), best) : defaultState());
  }
  function migrate(s) {   // anciennes sauvegardes
    delete s.lastImport;   // import par vitrine (fonction retirée)
    return s;
  }
  let S = load();
  // save() est appelé à chaque saisie : l'écriture (JSON de tout l'état) est regroupée toutes les 300 ms
  let saveTimer = null;
  function flushSave() {
    clearTimeout(saveTimer); saveTimer = null;
    S.savedAt = Date.now();
    const json = JSON.stringify(S);
    try { localStorage.setItem(KEY, json); } catch (e) { /* ignore */ }
    platform.persist(json);
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
  const allChars = () => CHARACTERS.concat(S.custom);
  const charById = id => CHARACTERS.find(c => c.id === id) || S.custom.find(c => c.id === id);
  const ownedChars = () => allChars().filter(c => S.owned[c.id]);

  /* ---- images & données du jeu (js/assets.js, généré par tools/build_assets.py) ---- */
  const G = typeof GAME !== 'undefined' ? GAME : { chars: [], elements: {}, paths: {}, pathMats: {}, items: {}, relicSets: {}, special: {} };
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
  const img = (p, cls, alt = '') => p ? `<img class="${cls}" src="${esc(imgUrl(p))}" alt="${esc(alt)}" loading="lazy" onerror="this.remove()">` : '';
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
  const profileOf = c => (S.owned[c.id] && S.owned[c.id].profile) || c.profile || DEFAULT_PROFILE_BY_PATH[c.path];
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
  const TABS = ['roster', 'planner', 'warps', 'relics', 'teams', 'settings'];
  const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const TAB_ICONS = {
    roster: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.8 14.2c2.4.1 4.1 1.7 4.7 4.3"/>'),
    planner: svg('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>'),
    warps: svg('<path d="M12 2.5 14 10l7.5 2-7.5 2-2 7.5-2-7.5L2.5 12 10 10z"/>'),
    relics: svg('<path d="M12 3 19 8l-2.6 9H7.6L5 8z"/><path d="M5 8h14M9.5 8 12 17l2.5-9"/>'),
    teams: svg('<path d="M4 20 15 9M15 9l1.5-4.5L21 3l-1.5 4.5zM6 14l4 4M20 20 9 9M9 9 7.5 4.5 3 3l1.5 4.5zM18 14l-4 4"/>'),
    settings: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>')
  };
  const RENDERERS = { roster: renderRoster, planner: renderPlanner, warps: renderWarps, relics: renderRelics, teams: renderTeams, settings: renderSettings };

  function render() {
    document.documentElement.lang = S.lang;
    $('#langSelect').value = S.lang;
    $('#tabs').innerHTML = TABS.map(k => `<button class="tab ${S.tab === k ? 'active' : ''}" data-action="tab" data-tab="${k}" title="${esc(t('tab_' + k))}">${TAB_ICONS[k]}<span>${t('tab_' + k)}</span></button>`).join('');
    resetCaches();
    $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    RENDERERS[S.tab]($('#view'));
  }

  /* ================================================================== PERSONNAGES */
  function renderRoster(v) {
    const f = S.rosterFilter;
    v.innerHTML = `
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
      ${S.custom.length ? `<div class="chip-list">${S.custom.map(c => `<span class="tag">${esc(c.name)} · ${c.rarity}★ · ${t('el_' + c.element)} · ${t('path_' + c.path)} <button class="x" data-action="delCustom" data-id="${c.id}" title="${esc(t('delete'))}">×</button></span>`).join('')}</div>` : ''}
    </section>`;
    renderRosterGrid();
  }

  function renderRosterGrid() {
    const f = S.rosterFilter, q = f.q.trim().toLowerCase();
    const list = allChars().filter(c =>
      (!q || charName(c).toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) &&
      (!f.el || c.element === f.el) && (!f.path || c.path === f.path) &&
      (!f.rar || c.rarity === +f.rar) && (!f.owned || S.owned[c.id])
    ).sort((a, b) => b.rarity - a.rarity || byName(a, b));
    const ownedCount = ownedChars().length;
    $('#ownedBadge').textContent = t('owned_count', { n: ownedCount, total: allChars().length });
    $('#rosterGrid').innerHTML = list.length ? list.map(charCard).join('') : `<p class="empty">${t('no_results')}</p>`;
  }

  function charCard(c) {
    const o = S.owned[c.id];
    const g = gameChar(c);
    const tip = `${charName(c)} · ${t('el_' + c.element)} · ${t('path_' + c.path)} — ${o ? t('owned') : t('add')}`;
    return `<div class="char-card ${o ? 'owned' : ''}">
      <button class="tile r${c.rarity}" data-action="toggleOwned" data-id="${c.id}" title="${esc(tip)}" aria-pressed="${!!o}">
        <div class="tile-art">
          <span class="ini">${esc(initials(c))}</span>
          ${g ? img(g.icon, 'av-img') : ''}
          ${img(G.elements[c.element], 'tile-el')}${img(G.paths[c.path], 'tile-path')}
          <span class="tile-stars">${'★'.repeat(c.rarity)}</span>
          ${o ? '<span class="tile-check"></span>' : ''}
        </div>
        <div class="tile-name">${esc(charName(c))}</div>
      </button>
      <button class="tile-info" data-action="openSheet" data-id="${c.id}" title="${esc(t('open_sheet'))}" aria-label="${esc(t('open_sheet'))} — ${esc(charName(c))}">i</button>
      ${o ? `<div class="char-extra">
        <label>${t('eidolon')}<select data-action="setEidolon" data-id="${c.id}">${range(0, 6).map(i => opt(i, 'E' + i, o.e || 0)).join('')}</select></label>
        <label>${t('relic_profile')}<select data-action="setProfile" data-id="${c.id}">${PROFILE_IDS.map(p => opt(p, t('prof_' + p), profileOf(c))).join('')}</select></label>
      </div>` : ''}
    </div>`;
  }

  /* ================================================================== PLANIFICATEUR */
  /* Coûts exacts tirés des données du jeu (js/assets.js). Les tables estimées de data.js
     ne servent que pour un personnage personnalisé absent de ces données. */
  const CREDIT_ID = G.special.credits || '2', TD_ID = G.special.td || '241';
  const LEGACY_AB = { basic: 'Point01', skill: 'Point02', ult: 'Point03', talent: 'Point04' };
  const AB_KEYS = { Point01: 'basic', Point02: 'skill', Point03: 'ult', Point04: 'talent', Point19: 'memo_skill', Point20: 'memo_talent', Point22: 'elation_skill' };
  const FALLBACK_AB = { Point01: 6, Point02: 10, Point03: 10, Point04: 10 };
  const exactData = c => { const g = gameChar(c); return g && g.asc && g.asc.length ? g : null; };
  const abilitiesOf = c => { const g = c && exactData(c); return g ? Object.keys(g.tr).sort().map(a => [a, g.tr[a].length + 1]) : Object.entries(FALLBACK_AB); };
  const abLabel = (a, short) => t((short ? 'ab_short_' : 'ab_') + (AB_KEYS[a] || 'extra'));
  const planTr = p => { const o = {}; for (const k in p.tr) o[LEGACY_AB[k] || k] = p.tr[k]; return o; };
  const itemCat = id => G.items[id] ? G.items[id][4] : (id === CREDIT_ID ? 'credit' : 'common');
  const itemTier = id => G.items[id] ? Math.max(1, G.items[id][3] - 1) : 1;   // rareté 2/3/4 → T1/T2/T3

  function computePlan(p) {
    const c = charById(p.charId); if (!c) return null;
    const g = exactData(c);
    const r = { exp: Math.max(0, LEVEL_EXP[p.lvTo] - LEVEL_EXP[p.lvFrom]), items: {}, gen: {} };
    const addList = list => { for (const [id, n] of list) r.items[id] = (r.items[id] || 0) + n; };
    const addGen = (o, mult = 1) => {
      for (const k in o) {
        if (k === 'credits') addList([[CREDIT_ID, Math.round(o[k] * mult)]]);
        else if (k === 'td') addList([[TD_ID, o[k]]]);
        else r.gen[k] = (r.gen[k] || 0) + o[k];
      }
    };
    addList([[CREDIT_ID, Math.round(r.exp * EXP_CREDIT_RATIO)]]);
    LEVELS.slice(1, 7).forEach((cap, i) => {          // ascensions aux paliers 20 → 70
      if (p.lvFrom <= cap && cap < p.lvTo) g ? addList(g.asc[i] || []) : addGen((ASCENSION[c.rarity] || ASCENSION[5])[i].cost);
    });
    const tr = planTr(p), mult = TRACE_CREDIT_MULT[c.rarity] || 1;
    for (const a in tr) {
      const [from, to] = tr[a];
      for (let l = from + 1; l <= to; l++) {
        if (g) { if (g.tr[a] && g.tr[a][l - 2]) addList(g.tr[a][l - 2]); }
        else { const table = a === 'Point01' ? BASIC_COST : ABILITY_COST; if (table[l]) addGen(table[l], mult); }
      }
    }
    if (p.bonus !== false) g ? addList(g.bonus) : addGen(BONUS_TRACES, mult);
    return r;
  }

  function tpEstimate(tot) {
    const R = S.rates;
    const expTP = tot.exp / R.exp * 10;
    const crTP = tot.credits / R.credits * 10;
    const pathTP = tot.pathT1 / R.crimson * 10;
    const bossTP = tot.boss / R.shadow * 30;
    const echoRuns = Math.ceil(tot.weekly / R.echo);
    const echoTP = echoRuns * 30;
    const total = expTP + crTP + pathTP + bossTP + echoTP;
    return { expTP, crTP, pathTP, bossTP, echoTP, echoWeeks: Math.ceil(echoRuns / 3), total, days: total / TP_PER_DAY };
  }

  /* Regroupe les besoins par objet réel du jeu (ex. deux persos qui partagent le même boss) */
  function aggregate(plans) {
    const tot = { exp: 0, credits: 0, pathT1: 0, boss: 0, weekly: 0, rows: new Map() };
    const ORDER = { path: 10, common: 20, boss: 30, weekly: 40, td: 50 };
    const add = (key, n, order, item, sub, emoji, name) => {
      if (!n) return;
      const row = tot.rows.get(key) || { n: 0, order, item, sub, emoji, names: new Set() };
      row.n += n; if (name) row.names.add(name);
      tot.rows.set(key, row);
    };
    for (const p of plans) {
      const r = computePlan(p); if (!r) continue;
      const c = charById(p.charId), nm = charName(c);
      tot.exp += r.exp;
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

  function matRows(tot) {
    const ico = id => (id && itemImg(id)) || '<span class="emoji">◆</span>';
    const rows = [];
    // stock issu de l'export Reliquary Archiver : affiche ce qu'il manque vraiment
    const inv = S.inventory;
    const have = id => inv && id && inv[id] != null ? inv[id] : (inv ? 0 : null);
    const qty = (need, h) => h == null ? fmt(need)
      : `${fmt(need)}<small class="${h >= need ? 'inv-ok' : 'inv-miss'}">${h >= need ? t('inv_ok', { n: fmt(h) }) : t('inv_missing', { n: fmt(need - h) })}</small>`;
    const expHave = inv ? Object.entries(EXP_ITEMS).reduce((s, [id, v]) => s + (inv[id] || 0) * v, 0) : null;
    if (tot.exp) rows.push([ico(G.special.exp), `${t('mat_exp')}<small>≈ ${fmt(Math.ceil(tot.exp / EXP_BOOK))} × ${t('mat_book')}</small>`, qty(tot.exp, expHave)]);
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
    return abilitiesOf(c).map(([a, max]) => `<label class="field">${abLabel(a)}<span class="range-sel">${sel(a, 'from', max, clamp(cur[a] || 1, 1, max))}<span>→</span>${sel(a, 'to', max, max)}</span></label>`).join('');
  }
  /* Remplit le formulaire avec l'état actuel du perso (s'il a été importé depuis la vitrine) */
  function setPlannerChar(c) {
    $('#plAbilities').innerHTML = abilityFields(c);
    const o = c && S.owned[c.id];
    $('#plLvFrom').value = o && o.lvl ? Math.max(...LEVELS.filter(L => L <= o.lvl)) : 1;
    $('#plBonus').checked = !(o && o.bonusAll);
  }

  function renderPlanner(v) {
    const active = S.plans.filter(p => p.on !== false && charById(p.charId));
    const tot = aggregate(active);
    const tp = tpEstimate(tot);
    v.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h2>${t('planner_title')}</h2></div>
      <p class="hint">${t('planner_hint')}</p>
      <div class="planner-form">
        <label class="field span2">${t('character')}<select id="plChar" data-action="plChar">${charOptions(S.plChar)}</select></label>
        <label class="field">${t('level_from')}<select id="plLvFrom">${LEVELS.map(l => opt(l, l, 1)).join('')}</select></label>
        <label class="field">${t('level_to')}<select id="plLvTo">${LEVELS.map(l => opt(l, l, 80)).join('')}</select></label>
        <div id="plAbilities" class="planner-abilities"></div>
        <label class="check"><input type="checkbox" id="plBonus" checked> ${t('bonus_traces')}</label>
        <button class="btn primary" data-action="addPlan">${t('add_plan')}</button>
      </div>
    </section>
    <div class="cols">
      <section class="panel">
        <h3>${t('plans')} <span class="badge">${S.plans.length}</span></h3>
        ${S.plans.length ? S.plans.map(planCard).join('') : `<p class="empty">${t('no_plans')}</p>`}
      </section>
      <section class="panel">
        <h3>${t('totals')}</h3>
        ${matTable(matRows(tot))}
        ${active.length ? `<div class="tp-box">
          <div class="tp-main"><span>${t('tp_total')}</span><b>${fmt(tp.total)}</b><small>≈ ${t('days', { n: Math.ceil(tp.days) })} ${t('at_240')}</small></div>
          <ul class="tp-detail">
            <li>${t('tp_exp')} : ${fmt(tp.expTP)}</li><li>${t('tp_credits')} : ${fmt(tp.crTP)}</li>
            <li>${t('tp_path')} : ${fmt(tp.pathTP)}</li><li>${t('tp_boss')} : ${fmt(tp.bossTP)}</li>
            <li>${t('tp_echo', { w: tp.echoWeeks })} : ${fmt(tp.echoTP)}</li>
          </ul>
          <p class="hint small">${t('tp_hint')}</p>
        </div>` : ''}
      </section>
    </div>`;
    setPlannerChar(charById($('#plChar').value));
  }

  function planCard(p) {
    const c = charById(p.charId);
    if (!c) return `<div class="plan-card off"><span>${t('unknown_char')}</span><button class="btn sm danger" data-action="delPlan" data-id="${p.id}">${t('delete')}</button></div>`;
    const tr = Object.entries(planTr(p)).map(([a, [f, to]]) => `${abLabel(a, true)} ${f}→${to}`).join(' · ') + (p.bonus !== false ? ' · ' + t('bonus_short') : '');
    const tot = aggregate([p]);
    return `<details class="plan-card ${p.on === false ? 'off' : ''}">
      <summary>
        ${avatar(c, 'sm')}
        <div class="plan-info"><b>${esc(charName(c))}</b><small>${t('lvl')} ${p.lvFrom}→${p.lvTo} · ${tr}</small></div>
        <label class="check" title="${esc(t('include'))}"><input type="checkbox" data-action="togglePlan" data-id="${p.id}" ${p.on !== false ? 'checked' : ''}></label>
        <button class="btn sm danger" data-action="delPlan" data-id="${p.id}" title="${esc(t('delete'))}">×</button>
      </summary>
      ${matTable(matRows(tot))}
    </details>`;
  }

  /* ================================================================== VŒUX */
  const availablePulls = () => {
    const w = S.warp;
    const income = w.days * (60 + (w.express ? 90 : 0)) + w.extra;
    return { pulls: Math.floor((w.jades + income) / JADE_PER_PULL) + w.passes, income };
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
          ${['gacha_step1', 'gacha_step2', 'gacha_step3'].map(k => t(k)).filter(Boolean).map(s => `<li>${s}</li>`).join('')}
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
    const { pulls, income } = availablePulls();
    el.textContent = fmt(pulls);
    $('#incomeInfo').textContent = income ? t('income_info', { j: fmt(income) }) : '';
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
        <div class="gauge" style="--p:${p * 100}"><span>${pct(p, 1)}</span></div>
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
  }

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

  function relicCard(r) {
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
        <button class="btn sm danger" data-action="delRelic" data-id="${r.id}">×</button></div>
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
    if (notOwned.length) notes.push(['info', t('not_owned', { names: notOwned.map(charName).join(', ') })]);
    if (!notes.some(n => n[0] === 'warn') && m.length === 4) notes.unshift(['ok', t('team_ok')]);
    return notes;
  }

  /* ---------- Mes équipes (équipes jouées / créées en jeu) ---------- */
  const TEAM_TYPES = ['hypercarry', 'dual', 'followup', 'dot', 'break', 'elation', 'other'];
  const ENDGAME_MODES = ['moc', 'pf', 'as'];
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
      <button class="star-btn ${tm.main ? 'on' : ''}" data-action="teamStar" data-id="${tm.id}" title="${esc(t('team_main'))}" aria-pressed="${!!tm.main}">★</button>
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
  function modalRoot(id) {
    let root = document.getElementById(id);
    if (!root) {
      root = document.createElement('div'); root.id = id; root.className = 'sheet-backdrop';
      document.body.appendChild(root); document.body.classList.add('no-scroll');
    }
    return root;
  }
  function closeModal(id) {
    const el = document.getElementById(id); if (el) el.remove();
    if (!$('.sheet-backdrop')) document.body.classList.remove('no-scroll');   // plus aucune fenêtre ouverte
  }

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
      <button class="sheet-close" data-action="teamCancel" aria-label="${esc(t('close'))}">×</button>
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
        ${dup.length ? `<p class="note warn">${t('warn_dup', { names: dup.map(id => charName(charById(id))).join(', ') })}</p>` : ''}
        <div class="teams-row">${teams.map((tm, ti) => `<div class="team-box">
          <h4>${t('team')} ${ti + 1}</h4>
          <div class="slots">${tm.map((id, si) => slotCell(id, `data-action="setSlot" data-mode="${mode}" data-team="${ti}" data-slot="${si}"`)).join('')}</div>
          ${teamNotes(tm)}
        </div>`).join('')}</div>
      </section>`;
    }).join('')}`;
  }

  /* ================================================================== FICHE PERSO */
  /* Les textes (compétences, traces, eidolons) sont dans js/details/<langue>.js, chargé à la demande. */
  const detailsLoading = {};
  function loadDetails(lang) {
    if (window.HSR_DETAILS && HSR_DETAILS[lang]) return Promise.resolve(HSR_DETAILS[lang]);
    if (!detailsLoading[lang]) detailsLoading[lang] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `js/details/${lang}.js`;
      s.onload = () => resolve(window.HSR_DETAILS && HSR_DETAILS[lang]);
      s.onerror = () => { delete detailsLoading[lang]; s.remove(); reject(new Error('details')); };
      document.head.appendChild(s);
    });
    return detailsLoading[lang];
  }

  let sheet = null;   // { id, tab, lv: { indexCompétence: niveau }, err }
  const DEFAULT_SKILL_LV = { Normal: 6, BPSkill: 10, Ultra: 10, Talent: 10, MemospriteSkill: 6, MemospriteTalent: 6, ElationDamage: 10 };
  const SHEET_TABS = ['skills', 'traces', 'eidolons', 'mats'];

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
    try { await loadDetails(S.lang); } catch (e) { if (sheet) sheet.err = true; }
    if (sheet && sheet.id === id) renderSheet();
  }
  function closeSheet() {
    sheet = null;
    closeModal('sheet');
  }

  function renderSheet() {
    const c = charById(sheet.id); if (!c) return closeSheet();
    const g = gameChar(c), D = window.HSR_DETAILS && HSR_DETAILS[S.lang], d = g && D && D.chars[g.id];
    const root = modalRoot('sheet');
    const scroll = root.querySelector('.sheet') ? root.querySelector('.sheet').scrollTop : 0;
    const o = S.owned[c.id];
    let body;
    if (sheet.tab === 'mats') body = g ? `<p class="hint small">${t('sheet_mats_hint')}</p>${matTable(matRows(aggregate([fullPlan(c)])))}` : `<p class="empty">${t('sheet_nodata')}</p>`;
    else if (!g) body = `<p class="empty">${t('sheet_nodata')}</p>`;
    else if (!d) body = `<p class="empty">${sheet.err ? t('sheet_error') : t('computing')}</p>`;
    else body = ({ skills: sheetSkills, traces: sheetTraces, eidolons: sheetRanks })[sheet.tab](d, D);
    root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(charName(c))}">
      <button class="sheet-close" data-action="closeSheet" title="${esc(t('close'))}" aria-label="${esc(t('close'))}">×</button>
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

  /* ================================================================== IMPORTS */
  /* ---- historique des vœux (platform.findGachaUrl / fetchGacha) ---- */
  // 5★ du pool standard : les obtenir sur une bannière limitée = 50/50 (ou 75/25) perdu
  const STANDARD_5 = new Set(['1003', '1004', '1101', '1104', '1107', '1209', '1211',
    '23000', '23002', '23003', '23004', '23005', '23012', '23013']);

  async function importGacha(url) {
    const out = $('#gachaOut');
    try {
      if (!url) {
        out.innerHTML = `<p class="hint">${t('gacha_finding')}</p>`;
        url = await platform.findGachaUrl();
      }
      out.innerHTML = `<p class="hint">${t('gacha_loading')}</p>`;
      const r = await platform.fetchGacha(url, S.lang);
      const n = applyGacha(r.items || []);
      save(); render(); toast(t('gacha_done', { n }));
      // bannières secondaires (collab…) qui n'ont pas pu être lues : on le signale sans bloquer
      if (r.warnings && r.warnings.length) $('#gachaOut').innerHTML = `<p class="note warn">${esc(r.warnings.join(' · '))}</p>`;
    } catch (e) {
      // Tauri rejette avec une chaîne, serve.py avec une Error
      const msg = e instanceof OfflineError ? t('server_needed') : esc((e && e.message !== undefined ? e.message : String(e)) || t('err_unknown'));
      out.innerHTML = `<p class="note warn">${msg}</p>`;
    }
  }

  function applyGacha(items) {
    const groups = { char: [], lc: [], std: [] };
    for (const it of items) if (groups[it.group]) groups[it.group].push(it);
    const hist = [], totals = {}, state = {};
    for (const [grp, list] of Object.entries(groups)) {
      // du plus ancien au plus récent (ids numériques trop grands pour Number : longueur puis texte)
      list.sort((a, b) => { const x = String(a.id), y = String(b.id); return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0); });
      let pity = 0, guar = false;
      for (const it of list) {
        pity++;
        if (String(it.rank_type) !== '5') continue;
        let result = 'na';
        if (grp !== 'std') {
          const lost = STANDARD_5.has(String(it.item_id));
          result = guar ? 'guar' : lost ? 'lost' : 'won';
          guar = lost;
        }
        hist.push({ id: 'g' + it.id, src: 'game', date: String(it.time || '').slice(0, 10), banner: grp, name: it.name, pity, result });
        pity = 0;
      }
      totals[grp] = list.length; state[grp] = { pity, guar };
    }
    S.history = S.history.filter(h => h.src !== 'game').concat(hist);
    S.warp.charPity = Math.min(89, state.char.pity); S.warp.charGuar = state.char.guar;
    S.warp.lcPity = Math.min(79, state.lc.pity); S.warp.lcGuar = state.lc.guar;
    S.gachaTotals = totals; S.gachaAt = Date.now();
    return items.length;
  }

  /* ---- Reliquary Archiver : compte complet (fichier JSON ou import en direct) ----
     Format : https://github.com/IceDynamix/reliquary-archiver (src/export/fribbels/models.rs) */
  const ARCH_SLOT = { Head: 'head', Hands: 'hands', Body: 'body', Feet: 'feet', 'Planar Sphere': 'sphere', 'Link Rope': 'rope' };
  const ARCH_MAIN = {
    DEF: 'def_pct', 'CRIT Rate': 'cr', 'CRIT DMG': 'cd', 'Outgoing Healing Boost': 'heal', SPD: 'spd', 'Effect Hit Rate': 'ehr',
    'Break Effect': 'be', 'Energy Regeneration Rate': 'err', 'Physical DMG Boost': 'dmg_physical', 'Fire DMG Boost': 'dmg_fire',
    'Ice DMG Boost': 'dmg_ice', 'Lightning DMG Boost': 'dmg_lightning', 'Wind DMG Boost': 'dmg_wind',
    'Quantum DMG Boost': 'dmg_quantum', 'Imaginary DMG Boost': 'dmg_imaginary'
  };
  // « HP » / « ATK » désignent la valeur fixe sur tête/mains et le % ailleurs
  const archMain = (key, slot) => key === 'HP' ? (slot === 'head' ? 'hp' : 'hp_pct') : key === 'ATK' ? (slot === 'hands' ? 'atk' : 'atk_pct') : ARCH_MAIN[key];
  const ARCH_SUB = {
    HP: 'hp', ATK: 'atk', DEF: 'def', HP_: 'hp_pct', ATK_: 'atk_pct', DEF_: 'def_pct', 'CRIT Rate_': 'cr', 'CRIT DMG_': 'cd',
    SPD: 'spd', 'Effect Hit Rate_': 'ehr', 'Effect RES_': 'res', 'Break Effect_': 'be'
  };
  const ITEM_SPECIAL_PASS = '102';
  const EXP_ITEMS = { 211: 1000, 212: 5000, 213: 20000 };
  const charByGameId = id => {   // index construit une fois (appelé pour chaque relique importée)
    if (!gameIdIndex) {
      gameIdIndex = new Map();
      for (const ch of allChars()) { const g = gameChar(ch); if (g && !gameIdIndex.has(g.id)) gameIdIndex.set(g.id, ch); }
    }
    return gameIdIndex.get(String(G.aliases[id] || id));
  };

  function applyArchive(ex) {
    if (!ex || !Array.isArray(ex.characters) || !Array.isArray(ex.relics)) throw new Error('format');
    const seen = new Set(), unknown = new Set();
    for (const ch of ex.characters) {
      const c = charByGameId(ch.id);
      if (!c) { unknown.add(ch.name || ch.id); continue; }
      const o = S.owned[c.id] || (S.owned[c.id] = { e: 0 });
      if (!seen.has(c.id)) o.e = 0;
      seen.add(c.id);
      // les persos multi-Voies (Pionnier, March 7th) arrivent en plusieurs entrées : on fusionne
      if (ch.level) { o.lvl = ch.level; o.promo = ch.ascension || 0; }
      o.e = Math.max(o.e || 0, ch.eidolon || 0);
      const s = ch.skills || {};
      if (s.basic) {
        o.tr = { Point01: s.basic, Point02: s.skill, Point03: s.ult, Point04: s.talent };
        if (s.elation) o.tr.Point22 = s.elation;
        if (ch.memosprite) { o.tr.Point19 = ch.memosprite.skill; o.tr.Point20 = ch.memosprite.talent; }
        const tr = ch.traces || {};   // 3 traces majeures + 10 bonus de stats
        o.bonusAll = [1, 2, 3].every(i => tr['ability_' + i]) && range(1, 10).every(i => tr['stat_' + i]);
      }
    }
    const relics = [];
    for (const r of ex.relics) {
      if ((r.rarity || 5) < 5) continue;   // l'évaluateur est calibré pour les reliques 5★
      const slot = ARCH_SLOT[r.slot], main = slot && archMain(r.mainstat, slot);
      if (!main) continue;
      const owner = r.location ? ((charByGameId(r.location) || {}).id || null) : null;
      relics.push({
        id: 'a' + r._uid, src: 'archive', slot, main, level: r.level || 0, owner, lock: !!r.lock,
        set: G.relicSetNames[String(r.set_id)] || r.name || '',
        subs: (r.substats || []).filter(x => ARCH_SUB[x.key]).slice(0, 4).map(x => ({ stat: ARCH_SUB[x.key], val: Math.round(x.value * 10) / 10 }))
      });
    }
    // l'export contient tout : il remplace les reliques importées avant (vitrine ou export)
    S.relics = S.relics.filter(r => r.src !== 'archive' && r.src !== 'uid').concat(relics);   // 'uid' : ancien import par vitrine
    if (ex.gacha && ex.gacha.stellar_jade != null) S.warp.jades = ex.gacha.stellar_jade;
    if (Array.isArray(ex.materials) && ex.materials.length) {
      S.inventory = {};
      for (const m of ex.materials) S.inventory[String(m.id)] = (S.inventory[String(m.id)] || 0) + (m.count || 0);
      if (S.inventory[ITEM_SPECIAL_PASS] != null) S.warp.passes = S.inventory[ITEM_SPECIAL_PASS];
    }
    if (ex.metadata && ex.metadata.uid) S.uid = String(ex.metadata.uid);
    return {
      at: Date.now(), uid: ex.metadata && ex.metadata.uid, chars: seen.size, relics: relics.length,
      lcs: (ex.light_cones || []).length, jades: ex.gacha ? ex.gacha.stellar_jade : null, unknown: [...unknown]
    };
  }

  function archiveSummary(s) {
    return `<div class="import-result">
      <p>${t('arch_summary', { n: s.chars, r: s.relics, l: s.lcs })}${s.jades != null ? ' ' + t('arch_jades', { j: fmt(s.jades) }) : ''}
        <small>· ${s.live ? t('arch_live_tag') + ' · ' : ''}${new Date(s.at).toLocaleString(locale())}</small></p>
      ${s.unknown.length ? `<p class="hint small">${t('unknown_chars', { ids: esc(s.unknown.join(', ')) })}</p>` : ''}
      <p class="hint small">${t('arch_after')}</p>
    </div>`;
  }
  function importArchiveData(ex, isLive) {
    S.lastArchive = { ...applyArchive(ex), live: !!isLive };
    save();
    if (!sheet) render();
  }
  /* Lit un fichier JSON choisi par l'utilisateur ; onData peut lever une erreur → message errKey */
  function readJsonFile(file, onData, errKey) {
    const fr = new FileReader();
    fr.onload = () => { try { onData(JSON.parse(fr.result)); } catch (e) { toast(t(errKey)); } };
    fr.readAsText(file);
  }
  const importArchiveFile = file => readJsonFile(file, ex => { importArchiveData(ex, false); toast(t('arch_done')); }, 'arch_bad_file');

  /* Import en direct : l'outil diffuse le compte sur ws://localhost:23313/ws (même principe que l'optimiseur de Fribbels) */
  let live = null;        // { ws, state: connecting | waiting | connected | closed | error, data }
  let liveTimer = null;
  function refreshLiveUi() {
    const st = $('.live-status');
    if (st) { st.className = 'live-status ' + (live ? live.state : ''); st.textContent = live ? t('arch_state_' + live.state) : ''; }
    const b = $('[data-action=archLive]');
    if (b) b.textContent = live ? t('arch_live_stop') : t('arch_live');
  }
  function setLive(state) { if (live) { live.state = state; refreshLiveUi(); } }
  function stopLive() { const l = live; live = null; if (l) try { l.ws.close(); } catch (e) { /* déjà fermé */ } refreshLiveUi(); }
  function startLive() {
    stopLive();
    let ws;
    try { ws = new WebSocket('ws://127.0.0.1:23313/ws'); } catch (e) { return toast(t('arch_state_error')); }
    live = { ws, state: 'connecting', data: null };
    ws.onopen = () => setLive('waiting');
    ws.onerror = () => setLive('error');
    ws.onclose = () => { if (live && live.ws === ws && live.state !== 'error') setLive('closed'); };
    ws.onmessage = ev => { try { onLiveEvent(JSON.parse(ev.data)); } catch (e) { /* message ignoré */ } };
    refreshLiveUi();
  }
  const upsertBy = (arr, items, key) => {
    for (const it of items || []) {
      const i = arr.findIndex(x => String(x[key]) === String(it[key]));
      if (i >= 0) arr[i] = it; else arr.push(it);
    }
  };
  function onLiveEvent(msg) {
    if (!live) return;
    const d = live.data;
    switch (msg.event) {
      case 'InitialScan': live.data = msg.data; break;
      case 'UpdateRelics': if (d) upsertBy(d.relics, msg.data, '_uid'); break;
      case 'DeleteRelics': if (d) { const del = new Set(msg.data.map(String)); d.relics = d.relics.filter(r => !del.has(String(r._uid))); } break;
      case 'UpdateCharacters': if (d) upsertBy(d.characters, msg.data, 'id'); break;
      case 'UpdateMaterials': if (d) upsertBy(d.materials, msg.data, 'id'); break;
      case 'UpdateGachaFunds': if (d) d.gacha = msg.data; break;
      default: return;
    }
    if (!live.data) return;
    setLive('connected');
    clearTimeout(liveTimer);   // regroupe les rafales de mises à jour
    liveTimer = setTimeout(() => { try { importArchiveData(live.data, true); } catch (e) { setLive('error'); } }, 500);
  }

  /* ================================================================== PARAMÈTRES */
  function renderSettings(v) {
    const R = S.rates;
    const num = (k) => `<input type="number" data-bind="rates.${k}" value="${R[k]}" min="0.1" step="0.1">`;
    v.innerHTML = `
    <section class="panel">
      <h2>${t('settings_title')}</h2>
      <label class="field">${t('language')}<select id="langSelect2" data-action="lang">${opt('fr', 'Français', S.lang)}${opt('en', 'English', S.lang)}</select></label>
    </section>
    <section class="panel">
      <h3>${t('rates_title')}</h3>
      <p class="hint">${t('rates_hint')}</p>
      <div class="field-grid">
        <label class="field">${t('rate_exp')}${num('exp')}</label>
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
    <section class="panel">
      <h3>${t('about_title')}</h3>
      <p class="hint">${t('about_text')}</p>
    </section>`;
  }

  /* ================================================================== ACTIONS */
  function toast(msg) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
    document.body.appendChild(el); setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2200);
  }
  function setLang(l) {
    S.lang = l; save(); render();
    if (sheet) { const tab = sheet.tab; openSheet(sheet.id); sheet.tab = tab; renderSheet(); }
  }

  const actions = {
    tab: b => { S.tab = b.dataset.tab; save(); render(); window.scrollTo({ top: 0 }); },
    lang: el => setLang(el.value),
    toggleOwned: b => {
      const id = b.dataset.id;
      if (S.owned[id]) delete S.owned[id]; else S.owned[id] = { e: 0 };
      save();
      if ($('#rosterGrid')) renderRosterGrid();
      if (sheet) renderSheet();
    },
    openSheet: b => openSheet(b.dataset.id),
    closeSheet: () => closeSheet(),
    sheetTab: b => { sheet.tab = b.dataset.tab; renderSheet(); },
    skillLv: el => { sheet.lv[+el.dataset.i] = +el.value; renderSheet(); },
    planFromSheet: b => {
      const c = charById(b.dataset.id);
      S.plans.push({ id: uid(), ...fullPlan(c), on: true });
      save(); toast(t('plan_added'));
    },
    setEidolon: el => { S.owned[el.dataset.id].e = +el.value; save(); },
    setProfile: el => { S.owned[el.dataset.id].profile = el.value; save(); },
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
    addPlan: () => {
      const lvFrom = +$('#plLvFrom').value, lvTo = +$('#plLvTo').value;
      const tr = {};
      for (const el of $$('#plAbilities select[data-ab]')) {
        const ab = el.dataset.ab, a = +el.value, b = +$(`#pl_${ab}_to`).value;
        tr[ab] = [a, Math.max(a, b)];
      }
      S.plans.push({ id: uid(), charId: $('#plChar').value, lvFrom, lvTo: Math.max(lvFrom, lvTo), tr, bonus: $('#plBonus').checked, on: true });
      save(); render(); toast(t('added'));
    },
    delPlan: (b, e) => { e.preventDefault(); S.plans = S.plans.filter(p => p.id !== b.dataset.id); save(); render(); },
    plChar: el => { S.plChar = el.value; save(); setPlannerChar(charById(el.value)); },
    archLive: () => { if (live) stopLive(); else startLive(); },
    relicSlotFilter: el => { S.relicSlotFilter = el.value; S.relicShow = 60; save(); render(); },
    relicSort: el => { S.relicSort = el.value; save(); render(); },
    relicMore: () => { S.relicShow = (S.relicShow || 60) + 120; save(); render(); },
    gachaAuto: () => importGacha(null),
    gachaUrl: () => importGacha($('#gachaUrl').value.trim()),
    togglePlan: el => { const p = S.plans.find(x => x.id === el.dataset.id); if (p) { p.on = el.checked; save(); render(); } },
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
    teamDel: b => {
      const tm = S.myTeams.find(x => x.id === b.dataset.id);
      if (!tm || !confirm(t('confirm_del_team', { name: teamName(tm) }))) return;
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
    resetRates: () => { S.rates = { ...DEFAULT_RATES }; save(); render(); },
    exportData: () => Promise.resolve(platform.exportFile(`hsr-companion-${today()}.json`, JSON.stringify(S, null, 2)))
      .catch(e => toast(String(e))),
    resetData: () => {
      if (!confirm(t('confirm_reset'))) return;
      const lang = S.lang; S = defaultState(); S.lang = lang; S.tab = 'settings'; save(); render();
    }
  };

  /* ------------------------------------------------------------------ binding */
  function setPath(path, value) {
    const keys = path.split('.'); let o = S;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
  }
  function bindValue(el) {
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number' || el.tagName === 'SELECT') {
      v = parseFloat(el.value); if (isNaN(v)) v = 0;
      if (el.min !== '') v = Math.max(+el.min, v);
      if (el.max !== '') v = Math.min(+el.max, v);
    } else v = el.value;
    setPath(el.dataset.bind, v); save();
    if (S.tab === 'warps') updateWarpDerived();
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (sheet) closeSheet(); else if (teamEdit) closeTeamEditor();
  });
  document.addEventListener('click', e => {
    if (e.target.id === 'sheet') return closeSheet();   // clic sur le fond
    if (e.target.id === 'teamEditor') return closeTeamEditor();
    const b = e.target.closest('[data-action]');
    if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
    actions[b.dataset.action] && actions[b.dataset.action](b, e);
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'langSelect') return setLang(el.value);
    if (el.id === 'archFile' && el.files[0]) return importArchiveFile(el.files[0]);
    if (el.id === 'importFile' && el.files[0]) {
      return readJsonFile(el.files[0], d => { S = migrate(merge(defaultState(), d)); save(); render(); toast(t('import_ok')); }, 'import_err');
    }
    if (el.dataset.filter) {
      S.rosterFilter[el.dataset.filter] = el.type === 'checkbox' ? el.checked : el.value;
      save(); return renderRosterGrid();
    }
    if (el.dataset.bind) return bindValue(el);
    if (el.dataset.action && actions[el.dataset.action]) return actions[el.dataset.action](el, e);
    if (el.closest('.relic-form')) updateRelicPreview();
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.filter === 'q') { S.rosterFilter.q = el.value; save(); return renderRosterGrid(); }
    if (el.dataset.bind && el.type === 'number') return bindValue(el);
    if (el.closest('.relic-form')) updateRelicPreview();
  });

  render();
})();
