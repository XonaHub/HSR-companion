// L'interface est répartie en plusieurs scripts classiques (app/js/ui/*.js) qui partagent leurs noms de haut niveau.
// Ces tests vérifient sans navigateur ce qu'un découpage peut casser : un fichier oublié dans index.html,
// un nom déclaré deux fois (erreur au chargement, ou fonction remplacée sans bruit), une erreur de syntaxe.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const APP = path.join(import.meta.dirname, '..', 'app');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
const read = s => fs.readFileSync(path.join(APP, s), 'utf8');

test('every_ui_file_is_loaded_once_core_first_main_last', () => {
  const ui = fs.readdirSync(path.join(APP, 'js', 'ui')).filter(f => f.endsWith('.js')).map(f => 'js/ui/' + f).sort();
  const listed = scripts.filter(s => s.startsWith('js/ui/'));
  assert.deepEqual([...listed].sort(), ui);
  assert.equal(new Set(scripts).size, scripts.length);
  assert.equal(listed[0], 'js/ui/core.js');
  assert.equal(listed[listed.length - 1], 'js/ui/main.js');
  assert.ok(scripts.indexOf('js/i18n.js') < scripts.indexOf('js/ui/core.js'));
});

test('top_level_names_are_declared_once_across_all_scripts', () => {
  const seen = new Map(), dup = [];
  for (const s of scripts) {
    for (const line of read(s).split(/\r?\n/)) {
      const m = line.match(/^(?:async )?(?:function\*? ?|const |let |var |class )([A-Za-z_$][\w$]*)/);
      if (!m) continue;
      if (seen.has(m[1]) && seen.get(m[1]) !== s) dup.push(`${m[1]} : ${seen.get(m[1])} et ${s}`);
      seen.set(m[1], s);
    }
  }
  assert.deepEqual(dup, []);
});

test('all_scripts_compile_together', () => {
  // un seul script : toute déclaration en double ou erreur de syntaxe fait échouer la compilation
  assert.doesNotThrow(() => new vm.Script(scripts.map(read).join('\n;\n'), { filename: 'index.html (scripts)' }));
});

test('no_native_confirm_alert_prompt', () => {
  // Dans l'app de bureau, le plugin dialog de Tauri rend window.confirm asynchrone (une promesse, toujours « vraie »)
  // et la page n'a pas le droit d'afficher sa fenêtre : confirm() répondait oui sans rien demander. Utiliser ask().
  const found = [];
  for (const s of scripts) {
    const code = read(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');   // sans les commentaires
    for (const m of code.matchAll(/(^|[^\w$.])(confirm|alert|prompt)\s*\(|window\.(confirm|alert|prompt)\b/g)) found.push(`${s} : ${m[0].trim()}`);
  }
  assert.deepEqual(found, []);
});
