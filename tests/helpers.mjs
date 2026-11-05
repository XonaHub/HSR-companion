// Charge des scripts « globaux » d'app/js (comme le fait index.html) dans un contexte isolé.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const APP_JS = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'js');

/** Exécute les scripts dans l'ordre et renvoie une fonction qui évalue une expression dans ce contexte.
    Le résultat revient en JSON simple : les objets d'un autre contexte ne sont pas « strictement égaux » aux nôtres. */
export function loadScripts(...files) {
  const ctx = vm.createContext({ window: {}, console });
  ctx.window = ctx;
  for (const f of files) vm.runInContext(readFileSync(join(APP_JS, f), 'utf8'), ctx, { filename: f });
  return expr => {
    const v = vm.runInContext(expr, ctx);
    return v === undefined ? v : JSON.parse(JSON.stringify(v));
  };
}
