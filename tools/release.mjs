// Prépare une release GitHub : installateur signé, version portable et latest.json (mise à jour automatique).
// Usage (depuis hsr-companion) : npm run release -- --notes "Ce qui change"  ou  npm run release -- --notes-file notes.txt
//
// 1. vérifie que la version est la même dans tauri.conf.json, Cargo.toml et package.json ;
// 2. compile et signe avec la clé privée (hors du dépôt, par défaut %USERPROFILE%\.tauri\hsr-companion.key,
//    ou le chemin donné dans la variable HSR_SIGNING_KEY) ;
// 3. copie dans release/v<version>/ les fichiers à glisser dans la release GitHub (tag v<version>).
// L'app installée lit latest.json dans la dernière release : il doit y être, avec l'installateur au même nom.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'XonaHub/HSR-companion';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = msg => { console.error(`\n✗ ${msg}`); process.exit(1); };

const conf = JSON.parse(readFileSync(join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const version = conf.version;
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const cargo = (readFileSync(join(ROOT, 'src-tauri', 'Cargo.toml'), 'utf8').match(/^version = "([^"]+)"/m) || [])[1];
if (pkg !== version || cargo !== version) {
  fail(`Versions différentes : tauri.conf.json ${version}, package.json ${pkg}, Cargo.toml ${cargo}. Mets la même partout.`);
}

// --notes "texte" (une ligne : npm perd les retours à la ligne sous Windows) ou --notes-file chemin (plusieurs lignes)
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? (process.argv[i + 1] || '') : null; };
const notesFile = arg('--notes-file');
if (notesFile !== null && !existsSync(notesFile)) fail(`Fichier de notes introuvable : ${notesFile}`);
const notes = (notesFile !== null ? readFileSync(notesFile, 'utf8') : arg('--notes') || '').replace(/\r\n/g, '\n').trim();

const key = process.env.HSR_SIGNING_KEY || join(homedir(), '.tauri', 'hsr-companion.key');
if (!existsSync(key)) fail(`Clé de signature introuvable : ${key}. Copie-la depuis l'autre PC (voir docs/outils-claude.md).`);

console.log(`→ Compilation signée de HSR Companion ${version}…`);
const build = spawnSync('npm run build', {
  cwd: ROOT, stdio: 'inherit', shell: true,
  env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '' },
});
if (build.status !== 0) fail('La compilation a échoué.');

const nsis = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const setup = join(nsis, `HSR Companion_${version}_x64-setup.exe`);
const portable = join(ROOT, 'src-tauri', 'target', 'release', 'hsr-companion.exe');
for (const f of [setup, setup + '.sig', portable]) if (!existsSync(f)) fail(`Fichier attendu absent : ${f}`);

// Noms sans espace : GitHub remplace les espaces des fichiers envoyés, l'adresse de latest.json ne marcherait plus.
const setupName = `HSR-Companion_${version}_x64-setup.exe`;
const out = join(ROOT, 'release', `v${version}`);
mkdirSync(out, { recursive: true });
copyFileSync(setup, join(out, setupName));
copyFileSync(portable, join(out, `HSR-Companion_${version}_x64-portable.exe`));
writeFileSync(join(out, 'latest.json'), JSON.stringify({
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: readFileSync(setup + '.sig', 'utf8').trim(),
      url: `https://github.com/${REPO}/releases/download/v${version}/${setupName}`,
    },
  },
}, null, 2) + '\n');

console.log(`
✓ Release prête dans ${out}
  Sur GitHub : Releases → Draft a new release → tag v${version} (cible master),
  puis glisser les 3 fichiers de ce dossier :
    - ${setupName}   (installateur, utilisé aussi par la mise à jour automatique)
    - HSR-Companion_${version}_x64-portable.exe   (sans installation, ne se met pas à jour seul)
    - latest.json   (indispensable : c'est lui que l'app lit pour se mettre à jour)`);
