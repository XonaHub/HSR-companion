"""Génère js/assets.js (images + identité des matériaux) depuis le dépôt communautaire
StarRailRes (https://github.com/Mar-7th/StarRailRes).

Usage (depuis le dossier hsr-companion) :
    python tools/build_assets.py

Relance-le après chaque nouvelle version du jeu pour récupérer les nouveaux persos.
Les images ne sont pas téléchargées : l'app les charge depuis le CDN jsDelivr.
"""
import json
import pathlib
import re
import sys
import unicodedata
import urllib.request

BASE = "https://cdn.jsdelivr.net/gh/Mar-7th/StarRailRes@master/"      # images (CDN)
RAW = "https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/"  # données JSON
OUT = pathlib.Path(__file__).resolve().parent.parent / "app" / "js" / "assets.js"

ELEMENT_MAP = {"Physical": "physical", "Fire": "fire", "Ice": "ice", "Thunder": "lightning",
               "Wind": "wind", "Quantum": "quantum", "Imaginary": "imaginary"}
PATH_MAP = {"Warrior": "destruction", "Rogue": "hunt", "Mage": "erudition", "Shaman": "harmony",
            "Warlock": "nihility", "Knight": "preservation", "Priest": "abundance",
            "Memory": "remembrance", "Elation": "elation"}
TB_NAMES = {"destruction": ("Trailblazer (Destruction)", "Pionnier (Destruction)"),
            "preservation": ("Trailblazer (Preservation)", "Pionnier (Préservation)"),
            "harmony": ("Trailblazer (Harmony)", "Pionnier (Harmonie)"),
            "remembrance": ("Trailblazer (Remembrance)", "Pionnier (Souvenir)"),
            "elation": ("Trailblazer (Elation)", "Pionnier (Allégresse)")}
CREDIT, EXP_BOOK, TRACKS = "2", "213", "241"
# clé de stat de l'app → propriété du jeu (pour l'icône)
STAT_PROPS = {"hp": "MaxHP", "hp_pct": "MaxHP", "atk": "Attack", "atk_pct": "Attack", "def": "Defence",
              "def_pct": "Defence", "spd": "Speed", "cr": "CriticalChance", "cd": "CriticalDamage",
              "ehr": "StatusProbability", "res": "StatusResistance", "be": "BreakDamageAddedRatio",
              "heal": "HealRatio", "err": "SPRatio",
              **{"dmg_" + v: k + "AddedRatio" for k, v in ELEMENT_MAP.items()}}


def category(item_id):
    if item_id == CREDIT:
        return "credit"
    if item_id == TRACKS:
        return "td"
    if item_id == EXP_BOOK:
        return "exp"
    if item_id.startswith("1104"):
        return "boss"
    if item_id.startswith("1105"):
        return "weekly"
    if item_id.startswith(("1101", "1102", "1103")):
        return "path"
    return "common"


def get(lang, name):
    with urllib.request.urlopen(f"{RAW}index_new/{lang}/{name}.json", timeout=60) as r:
        return json.load(r)


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


SKIP_SKILL_TYPES = {"MazeNormal"}  # l'« Attaque » générique hors combat


def write_details(char_ids, chars_en, trees_en):
    """Fiches détaillées (compétences, traces majeures, bonus de stats, eidolons), une par langue :
    js/details/<lang>.js, chargé seulement quand on ouvre une fiche."""
    out_dir = OUT.parent / "details"
    out_dir.mkdir(exist_ok=True)
    for lang in ("fr", "en"):
        skills, ranks, trees = get(lang, "character_skills"), get(lang, "character_ranks"), get(lang, "character_skill_trees")
        props = get(lang, "properties")
        used_props, data = set(), {}
        for cid in char_ids:
            c = chars_en[cid]
            sk = []
            for sid in c.get("skills", []):
                s = skills.get(sid)
                if not s or s.get("type") in SKIP_SKILL_TYPES:
                    continue
                sk.append([s["name"], s.get("type_text") or "", s.get("effect_text") or "", s.get("desc") or "",
                           s.get("params") or [], s.get("icon"), s.get("type") or ""])
            rk = [[ranks[r]["name"], ranks[r]["desc"], ranks[r].get("icon")] for r in c.get("ranks", []) if r in ranks]
            major, stats = [], {}
            for tid in c.get("skill_trees", []):
                node, node_en = trees.get(tid), trees_en.get(tid)
                if not node or node["max_level"] > 1:
                    continue
                if node.get("desc"):  # trace majeure
                    major.append([node["name"], node["desc"], (node.get("params") or [[]])[0], node.get("icon")])
                for lvl in (node_en or node)["levels"]:
                    for p in lvl.get("properties", []):
                        stats[p["type"]] = round(stats.get(p["type"], 0) + p["value"], 6)
                        used_props.add(p["type"])
            data[cid] = {"skills": sk, "ranks": rk, "major": major, "stats": stats}
        prop_names = {k: props[k]["name"] for k in used_props if k in props}
        (out_dir / f"{lang}.js").write_text(
            "/* Généré par tools/build_assets.py — ne pas modifier à la main. */\n"
            "window.HSR_DETAILS = window.HSR_DETAILS || {};\n"
            f"HSR_DETAILS[{json.dumps(lang)}] = "
            + json.dumps({"chars": data, "props": prop_names}, ensure_ascii=False, separators=(",", ":")) + ";\n",
            encoding="utf-8")
        print(f"  fiches {lang} : {(out_dir / f'{lang}.js').stat().st_size // 1024} Ko")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    chars_en, chars_fr = get("en", "characters"), get("fr", "characters")
    items_en, items_fr = get("en", "items"), get("fr", "items")
    promos, trees = get("en", "character_promotions"), get("en", "character_skill_trees")
    elements, paths, sets_en = get("en", "elements"), get("en", "paths"), get("en", "relic_sets")
    props = get("en", "properties")

    used_items = {CREDIT, EXP_BOOK, TRACKS}
    chars, seen_tb, aliases = [], {}, {}
    for cid, c in chars_en.items():
        el, path = ELEMENT_MAP[c["element"]], PATH_MAP[c["path"]]
        if c["name"] == "{NICKNAME}":
            if path in seen_tb:
                aliases[cid] = seen_tb[path]  # version fille → même entrée que la version garçon
                continue
            seen_tb[path] = cid
            name_en, name_fr = TB_NAMES.get(path, (f"Trailblazer ({path})", f"Pionnier ({path})"))
        else:
            name_en, name_fr = c["name"], chars_fr.get(cid, {}).get("name", c["name"])

        pack = lambda mats: [[m["id"], m["num"]] for m in mats]
        # Ascensions : asc[i] = coût de la (i+1)e ascension (paliers 20, 30, … 70)
        asc = [pack(step) for step in promos.get(cid, {}).get("materials", []) if step]
        # Traces : capacités à plusieurs niveaux (coût pour atteindre le niveau 2, 3, …)
        # + toutes les traces bonus à 1 niveau (stats, traces majeures) cumulées
        tr, bonus, pts, n_bonus = {}, {}, {}, 0
        for tid in c.get("skill_trees", []):
            node = trees.get(tid)
            if not node:
                continue
            if node["max_level"] > 1:
                tr[node["anchor"]] = [pack(lvl["materials"]) for lvl in node["levels"][1:]]
                pts[tid] = node["anchor"]  # id du point de trace (vitrine) → capacité
            else:
                if any(lvl["materials"] for lvl in node["levels"]):
                    n_bonus += 1
                for lvl in node["levels"]:
                    for m in lvl["materials"]:
                        bonus[m["id"]] = bonus.get(m["id"], 0) + m["num"]
        all_ids = {i for step in asc for i, _ in step} | set(bonus) | {i for lv in tr.values() for step in lv for i, _ in step}
        boss = next((i for i in sorted(all_ids) if category(i) == "boss"), None)
        weekly = next((i for i in sorted(all_ids) if category(i) == "weekly"), None)
        common = sorted(i for i in all_ids if category(i) == "common")[:3]
        path_mats = sorted(i for i in all_ids if category(i) == "path")[:3]
        used_items.update(all_ids)
        chars.append({"id": cid, "key": norm(name_en) + "|" + el, "en": name_en, "fr": name_fr, "rarity": c["rarity"],
                      "element": el, "path": path, "icon": c["icon"], "preview": c.get("preview"),
                      "boss": boss, "weekly": weekly,
                      "common": common, "pathMats": path_mats,
                      "asc": asc, "tr": tr, "bonus": [[i, n] for i, n in sorted(bonus.items())],
                      "pts": pts, "nBonus": n_bonus})

    path_mats_by_path = {}
    for c in chars:
        if len(c["pathMats"]) == 3:
            path_mats_by_path.setdefault(c["path"], c["pathMats"])

    # [nom EN, nom FR, icône, rareté, catégorie]
    items = {i: [items_en[i]["name"], items_fr.get(i, items_en[i])["name"], items_en[i]["icon"],
                 items_en[i].get("rarity", 1), category(i)]
             for i in sorted(used_items) if i in items_en}
    data = {
        "chars": chars,
        "elements": {ELEMENT_MAP[k]: v["icon"] for k, v in elements.items() if k in ELEMENT_MAP},
        "paths": {PATH_MAP[k]: v["icon"] for k, v in paths.items() if k in PATH_MAP},
        "pathMats": path_mats_by_path,
        "items": items,
        # set → [icône du set, id] ; pièce = icon/relic/{id}_{index}.png (tête/sphère 0, mains/corde 1, torse 2, pieds 3)
        "relicSets": {norm(v["name"]): [v["icon"], v["id"]] for v in sets_en.values()},
        "relicSetNames": {v["id"]: v["name"] for v in sets_en.values()},  # id (vitrine) → nom EN
        "aliases": aliases,
        "stats": {k: props[p]["icon"] for k, p in STAT_PROPS.items() if p in props and props[p].get("icon")},
        "special": {"credits": CREDIT, "exp": EXP_BOOK, "td": TRACKS},
    }
    write_details([c["id"] for c in chars], chars_en, trees)

    OUT.write_text("/* Généré par tools/build_assets.py — ne pas modifier à la main. */\n"
                   f"const ASSET_BASE = {json.dumps(BASE)};\n"
                   f"const GAME = {json.dumps(data, ensure_ascii=False, separators=(',', ':'))};\n",
                   encoding="utf-8")
    print(f"{len(chars)} persos, {len(items)} objets, {len(data['relicSets'])} sets -> {OUT}")
    for c in chars:
        if not (c["boss"] and c["weekly"] and len(c["common"]) == 3 and len(c["pathMats"]) == 3
                and len(c["asc"]) == 6 and "Point01" in c["tr"]):
            print("  incomplet :", c["en"], c["boss"], c["weekly"], c["common"], c["pathMats"], len(c["asc"]), list(c["tr"]))
    extra = sorted({a for c in chars for a in c["tr"]} - {"Point01", "Point02", "Point03", "Point04"})
    print("  capacités supplémentaires rencontrées :", extra)
    print(f"  taille : {OUT.stat().st_size // 1024} Ko")


if __name__ == "__main__":
    main()
