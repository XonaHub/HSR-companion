"""HSR Companion — serveur local.

Sert l'application sur http://localhost:8765 et ajoute l'import de l'historique des vœux,
que le navigateur ne peut pas faire seul (l'API bloque les appels directs depuis une page) :

  * /api/gacha/find      : retrouve le lien d'historique des vœux dans le cache du jeu ;
  * /api/gacha/fetch     : télécharge l'historique complet depuis l'API officielle HoYoverse.

Usage :  double-clic sur « HSR Companion.bat » (ou : python tools/serve.py)
Le serveur n'écoute que sur cette machine (127.0.0.1). Aucune dépendance externe.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "app"   # fichiers de la page web
PORT = int(os.environ.get("HSR_PORT", "8765"))
UA = "HSR-Companion/1.0 (local fan tool)"

GACHA_HOSTS = ("hoyoverse.com", "mihoyo.com")
DEFAULT_GACHA_API = "https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog"
# type de bannière → (point d'accès, libellé interne, obligatoire ?) — même table que src-tauri/src/gacha.rs
# une erreur sur une bannière obligatoire arrête l'import ; les autres (collab) sont facultatives
GACHA_TYPES = [("11", "getGachaLog", "char", True), ("12", "getGachaLog", "lc", True), ("1", "getGachaLog", "std", True),
               ("21", "getLdGachaLog", "char", False), ("22", "getLdGachaLog", "lc", False)]

def http_json(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


# ---------------------------------------------------------------- historique des vœux
def find_game_data_dir():
    """Lit Player.log pour retrouver le dossier StarRail_Data du jeu."""
    base = Path(os.environ.get("USERPROFILE", Path.home())) / "AppData" / "LocalLow"
    for sub in ("Cognosphere/Star Rail", "miHoYo/崩坏：星穹铁道", "miHoYo/Star Rail"):
        for name in ("Player.log", "Player-prev.log"):
            log = base / sub / name
            if not log.exists():
                continue
            text = log.read_text(encoding="utf-8", errors="ignore")
            m = re.search(r"Loading player data from (.+?)/data\.unity3d", text)
            if m:
                return Path(m.group(1))
    return None


def find_gacha_url():
    data_dir = find_game_data_dir()
    if not data_dir:
        return None, "Jeu introuvable : lance Honkai: Star Rail une fois sur ce PC, puis réessaie."
    caches = sorted((data_dir / "webCaches").glob("*/Cache/Cache_Data/data_2"), key=lambda p: p.stat().st_mtime)
    if not caches:
        return None, "Cache du jeu introuvable : ouvre l'historique des vœux en jeu, puis réessaie."
    raw = caches[-1].read_bytes().decode("latin-1")
    urls = re.findall(r"https://[^\s\x00\"']+?(?:getGachaLog|getLdGachaLog)\?[^\s\x00\"']+", raw)
    urls = [u for u in urls if "authkey=" in u]
    if not urls:
        return None, "Aucun lien trouvé : ouvre l'historique des vœux en jeu (Vœux > Historique), puis réessaie."
    return urls[-1], None


def check_gacha_url(url):
    try:
        u = urllib.parse.urlparse(url)
    except ValueError:
        return None
    if u.scheme != "https" or not any(u.hostname and u.hostname.endswith(h) for h in GACHA_HOSTS):
        return None
    q = urllib.parse.parse_qs(u.query)
    return q if q.get("authkey") else None


def fetch_gacha(url, lang):
    query = check_gacha_url(url)
    if not query:
        return 400, {"error": "Lien invalide : il doit venir de l'historique des vœux du jeu (hoyoverse.com)."}
    u = urllib.parse.urlparse(url)
    base = f"https://{u.hostname}{u.path}" if "GachaLog" in u.path else DEFAULT_GACHA_API
    params = {k: v[0] for k, v in query.items()}
    params.update({"lang": lang, "size": "20"})
    items, warnings = [], []
    for gtype, endpoint, group, required in GACHA_TYPES:
        api = re.sub(r"get(Ld)?GachaLog$", endpoint, base)
        end_id, page = "0", 1
        while True:
            params.update({"gacha_type": gtype, "page": str(page), "end_id": end_id})
            try:
                resp = http_json(api + "?" + urllib.parse.urlencode(params))
            except Exception as e:
                warnings.append(f"bannière {gtype} : {e}")
                break
            if resp.get("retcode") != 0:
                if required:
                    msg = resp.get("message") or "erreur inconnue"
                    if "authkey" in msg.lower() or resp.get("retcode") == -101:
                        msg = "Lien expiré : rouvre l'historique des vœux en jeu, puis réessaie."
                    return 400, {"error": msg}
                break  # bannières collab absentes sur ce compte/serveur
            batch = (resp.get("data") or {}).get("list") or []
            for it in batch:
                it["group"] = group
            items.extend(batch)
            if len(batch) < 20:
                break
            end_id, page = batch[-1]["id"], page + 1
            time.sleep(0.25)  # politesse envers l'API
    return 200, {"items": items, "warnings": warnings}


# ---------------------------------------------------------------- serveur
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            sys.stderr.write("[api] " + (fmt % args) + "\n")

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/ping":
            return self.send_json(200, {"ok": True})
        if path == "/api/gacha/find":
            url, err = find_gacha_url()
            return self.send_json(200, {"url": url}) if url else self.send_json(404, {"error": err})
        return super().do_GET()

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/api/gacha/fetch":
            return self.send_json(404, {"error": "introuvable"})
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 20000)
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self.send_json(400, {"error": "requête invalide"})
        lang = body.get("lang") if body.get("lang") in ("fr", "en") else "fr"
        return self.send_json(*fetch_gacha(str(body.get("url", "")), lang))


class Server(ThreadingHTTPServer):
    allow_reuse_address = False   # sous Windows, True laisserait deux serveurs partager le port


def already_running():
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/ping", timeout=1.5) as r:
            return json.load(r).get("ok") is True
    except Exception:
        return False


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    url = f"http://localhost:{PORT}/"
    try:
        if already_running():
            raise OSError("déjà lancé")
        server = Server(("127.0.0.1", PORT), Handler)
    except OSError:  # déjà lancé (port occupé) : on ouvre simplement la page
        print(f"HSR Companion tourne déjà : {url}")
        if "--no-browser" not in sys.argv:
            webbrowser.open(url)
        return
    print(f"HSR Companion est lancé : {url}")
    print("Laisse cette fenêtre ouverte pendant l'utilisation ; ferme-la pour arrêter.")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
