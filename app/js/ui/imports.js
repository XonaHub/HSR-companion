/* HSR Companion — imports du compte
   Historique des vœux, Reliquary Archiver (fichier et import en direct). */
'use strict';

/* ================================================================== IMPORTS */
/* ---- historique des vœux (commandes gacha_find / gacha_fetch, src-tauri/src/gacha.rs) ---- */
// 5★ du pool standard : les obtenir sur une bannière limitée = 50/50 (ou 75/25) perdu
const STANDARD_5 = new Set(['1003', '1004', '1101', '1104', '1107', '1209', '1211',
  '23000', '23002', '23003', '23004', '23005', '23012', '23013']);

async function importGacha(url) {
  const out = $('#gachaOut');
  try {
    if (!url) {
      out.innerHTML = `<p class="hint">${t('gacha_finding')}</p>`;
      url = await invoke('gacha_find');
    }
    out.innerHTML = `<p class="hint">${t('gacha_loading')}</p>`;
    const r = await invoke('gacha_fetch', { url, lang: S.lang });
    backup('gacha');
    const n = applyGacha(r.items || []);
    S = sanitizeState(S, defaultState());   // réponse du serveur : forme garantie (js/sanitize.js)
    save(); render(); toast(t('gacha_done', { n }));
    // bannières secondaires (collab…) qui n'ont pas pu être lues : on le signale sans bloquer
    if (r.warnings && r.warnings.length) $('#gachaOut').innerHTML = `<p class="note warn">${esc(r.warnings.join(' · '))}</p>`;
  } catch (e) {
    out.innerHTML = `<p class="note warn">${esc(String(e) || t('err_unknown'))}</p>`;   // le backend rejette avec un message
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
      o.pts = archiveTracePoints(tr);   // traces débloquées, une par une (calcul des stats)
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
      // valeurs sans arrondi (`exact`) : elles servent au calcul des stats ; l'affichage arrondit
      subs: (r.substats || []).filter(x => ARCH_SUB[x.key]).slice(0, 4).map(x => ({ stat: ARCH_SUB[x.key], val: +x.value || 0 })),
      exact: true
    });
  }
  // l'export contient tout : il remplace les reliques importées avant (vitrine ou export)
  S.relics = S.relics.filter(r => r.src !== 'archive' && r.src !== 'uid').concat(relics);   // 'uid' : ancien import par vitrine
  pruneBuilds();   // builds gardés que le jeu a appliqués
  if (Array.isArray(ex.light_cones)) S.cones = importCones(ex.light_cones, G.lightCones || [], id => (charByGameId(id) || {}).id || null);
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
  // fichier : une copie à chaque import ; flux live : une seule par connexion (il envoie des mises à jour en continu)
  if (!isLive) backup('archive');
  else if (live && !live.backedUp) { live.backedUp = true; backup('archive'); }
  S.lastArchive = { ...applyArchive(ex), live: !!isLive };
  S = sanitizeState(S, defaultState());   // fichier ou flux live : forme garantie (js/sanitize.js)
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
    case 'UpdateLightCones': if (d) upsertBy(d.light_cones || (d.light_cones = []), msg.data, '_uid'); break;
    case 'DeleteLightCones': if (d) { const del = new Set(msg.data.map(String)); d.light_cones = (d.light_cones || []).filter(c => !del.has(String(c._uid))); } break;
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

/* actions des boutons et listes (data-action), branchées dans main.js */
Object.assign(actions, {
  archLive: () => { if (live) stopLive(); else startLive(); },
  gachaAuto: () => importGacha(null),
  gachaUrl: () => importGacha($('#gachaUrl').value.trim()),
});
