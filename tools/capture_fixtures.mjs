// Enregistre les données réelles servant aux tests Rust (src-tauri/tests/fixtures).
// Usage (depuis hsr-companion) : node tools/capture_fixtures.mjs
// À relancer seulement pour rafraîchir les exemples : les tests attendent les valeurs de ces fichiers.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'tests', 'fixtures');
const UA = 'HSR-Companion/1.0 (local fan tool)';
const pause = () => new Promise(r => setTimeout(r, 250));

// Commit StarRailRes à partir duquel app/js/assets.js et app/js/details/*.js ont été générés
const SRR_SHA = 'dbe8cdfcfb0bf657b9fe1cf92d5537f118ccb487';
// Doit rester aligné sur gamedata::SOURCE_FILES (src-tauri/src/gamedata/mod.rs)
const SRR_FILES = [
  ...['characters', 'items', 'character_promotions', 'character_skill_trees', 'elements', 'paths',
    'relic_sets', 'properties', 'character_skills', 'character_ranks', 'light_cones', 'light_cone_promotions',
    'relic_main_affixes', 'light_cone_ranks'].map(n => ['en', n]),
  ...['characters', 'items', 'character_skills', 'character_ranks', 'character_skill_trees', 'properties', 'light_cones'].map(n => ['fr', n]),
];

const POSTS = [
  '46861607', // patch note 4.6
  '46449452', // patch note 4.5
  '46851682', // Sauts événements 4.6 partie 1 (texte EN seulement dans structured_content)
  '47142215', // Sauts événements 4.6 partie 2
  '47307963', // présentation d'Aiôn (ne cite pas de version)
  '47210911', // programme spécial 4.7
  '47310096', // aperçu de cône de lumière 4.7
  '46439490', // Sauts événements 4.5 partie 1 (format avec les persos dans les lignes « ● »)
];

async function save(rel, data) {
  const file = join(ROOT, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, typeof data === 'string' ? data : JSON.stringify(data));
  console.log('  ' + rel);
}

async function get(url, lang) {
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  if (lang) headers['x-rpc-language'] = lang;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

console.log('StarRailRes @' + SRR_SHA.slice(0, 7));
for (const [lang, name] of SRR_FILES) {
  await save(`starrailres/${lang}/${name}.json`,
    await get(`https://raw.githubusercontent.com/Mar-7th/StarRailRes/${SRR_SHA}/index_new/${lang}/${name}.json`));
  await pause();
}

console.log('HoYoLAB');
for (const type of [1, 3]) {
  await save(`hoyolab/list.type${type}.en-us.json`,
    await get(`https://bbs-api-os.hoyolab.com/community/post/wapi/getNewsList?gids=6&page_size=50&type=${type}`, 'en-us'));
  await pause();
}
for (const id of POSTS) for (const lang of ['fr-fr', 'en-us']) {
  await save(`hoyolab/${id}.${lang}.json`,
    await get(`https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id=${id}`, lang));
  await pause();
}

console.log('Prydwen (HTML brut, classement des cônes)');
for (const [file, url] of [
  ['acheron', 'https://www.prydwen.gg/star-rail/characters/acheron'],
  ['characters', 'https://www.prydwen.gg/star-rail/characters'],
]) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await save(`prydwen/${file}.html`, await res.text());
  await pause();
}
