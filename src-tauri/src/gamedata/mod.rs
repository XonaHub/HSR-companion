//! Données du jeu : transformation des fichiers StarRailRes (https://github.com/Mar-7th/StarRailRes)
//! en données de l'app (`GAME` de app/js/assets.js et `HSR_DETAILS` de app/js/details/<lang>.js).
//!
//! C'est la seule implémentation de cette transformation : elle sert à l'app (mise à jour au démarrage,
//! voir `update`) et au binaire `build_assets` qui régénère les fichiers intégrés à l'exe.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::Path;

use serde_json::{json, Map, Value};
use unicode_normalization::UnicodeNormalization;

pub mod update;

/// Fichiers `index_new/<lang>/<nom>.json` lus par `build` (à garder aligné sur tools/capture_fixtures.mjs).
pub const SOURCE_FILES: &[(&str, &str)] = &[
    ("en", "characters"), ("en", "items"), ("en", "character_promotions"), ("en", "character_skill_trees"),
    ("en", "elements"), ("en", "paths"), ("en", "relic_sets"), ("en", "properties"),
    ("en", "character_skills"), ("en", "character_ranks"),
    ("en", "light_cones"), ("en", "light_cone_promotions"), ("fr", "light_cones"),
    ("fr", "characters"), ("fr", "items"), ("fr", "character_skills"), ("fr", "character_ranks"),
    ("fr", "character_skill_trees"), ("fr", "properties"),
];

/// Images : chargées depuis le CDN, jamais téléchargées par l'app.
pub const ASSET_BASE: &str = "https://cdn.jsdelivr.net/gh/Mar-7th/StarRailRes@master/";

/// `game` = objet `GAME` ; `details` = `HSR_DETAILS[lang]` pour "fr" et "en".
pub struct GameBundle {
    pub game: Value,
    pub details: BTreeMap<String, Value>,
}

const ELEMENT_MAP: &[(&str, &str)] = &[
    ("Physical", "physical"), ("Fire", "fire"), ("Ice", "ice"), ("Thunder", "lightning"),
    ("Wind", "wind"), ("Quantum", "quantum"), ("Imaginary", "imaginary"),
];
const PATH_MAP: &[(&str, &str)] = &[
    ("Warrior", "destruction"), ("Rogue", "hunt"), ("Mage", "erudition"), ("Shaman", "harmony"),
    ("Warlock", "nihility"), ("Knight", "preservation"), ("Priest", "abundance"),
    ("Memory", "remembrance"), ("Elation", "elation"),
];
const TB_NAMES: &[(&str, &str, &str)] = &[
    ("destruction", "Trailblazer (Destruction)", "Pionnier (Destruction)"),
    ("preservation", "Trailblazer (Preservation)", "Pionnier (Préservation)"),
    ("harmony", "Trailblazer (Harmony)", "Pionnier (Harmonie)"),
    ("remembrance", "Trailblazer (Remembrance)", "Pionnier (Souvenir)"),
    ("elation", "Trailblazer (Elation)", "Pionnier (Allégresse)"),
];
const CREDIT: &str = "2";
const EXP_BOOK: &str = "213";
const TRACKS: &str = "241";
/// clé de stat de l'app → propriété du jeu (pour l'icône) ; les bonus de DGT suivent ELEMENT_MAP
const STAT_PROPS: &[(&str, &str)] = &[
    ("hp", "MaxHP"), ("hp_pct", "MaxHP"), ("atk", "Attack"), ("atk_pct", "Attack"), ("def", "Defence"),
    ("def_pct", "Defence"), ("spd", "Speed"), ("cr", "CriticalChance"), ("cd", "CriticalDamage"),
    ("ehr", "StatusProbability"), ("res", "StatusResistance"), ("be", "BreakDamageAddedRatio"),
    ("heal", "HealRatio"), ("err", "SPRatio"),
];
/// l'« Attaque » générique hors combat
const SKIP_SKILL_TYPES: &[&str] = &["MazeNormal"];

fn lookup<'a>(table: &[(&'a str, &'a str)], key: &str) -> Option<&'a str> {
    table.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

fn category(id: &str) -> &'static str {
    match id {
        CREDIT => "credit",
        TRACKS => "td",
        EXP_BOOK => "exp",
        _ if id.starts_with("1104") => "boss",
        _ if id.starts_with("1105") => "weekly",
        _ if id.starts_with("1101") || id.starts_with("1102") || id.starts_with("1103") => "path",
        _ => "common",
    }
}

/// Comme `norm` de app.js / build_assets.py : décomposition, ASCII seul, minuscules, lettres et chiffres.
pub fn norm(s: &str) -> String {
    s.nfkd().filter(char::is_ascii).collect::<String>().to_lowercase().chars().filter(char::is_ascii_alphanumeric).collect()
}

/// Valeur « vraie » au sens de Python (`x or défaut`).
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
    }
}
fn or_default(v: Option<&Value>, default: Value) -> Value {
    if truthy(v) { v.unwrap().clone() } else { default }
}
fn id_str(v: &Value) -> String {
    v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())
}
fn arr(v: Option<&Value>) -> &[Value] {
    v.and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}
fn obj<'a>(v: &'a Value, what: &str) -> Result<&'a Map<String, Value>, String> {
    v.as_object().ok_or_else(|| format!("{what} : objet attendu"))
}
/// Nombre JSON : entier si la valeur est entière (comme Python), sinon flottant.
fn num(x: f64) -> Value {
    if x.fract() == 0.0 && x.abs() < 1e15 { json!(x as i64) } else { json!(x) }
}
/// `round(x, 6)` de Python
fn round6(x: f64) -> f64 {
    (x * 1e6).round() / 1e6
}
/// `[[id, num], …]` à partir d'une liste de matériaux `{id, num}`
fn pack(mats: &[Value]) -> Value {
    Value::Array(mats.iter().map(|m| json!([m["id"].clone(), m["num"].clone()])).collect())
}

/// Construit les données de l'app ; `get(lang, nom)` fournit le JSON StarRailRes correspondant.
pub fn build(get: impl Fn(&str, &str) -> Result<Value, String>) -> Result<GameBundle, String> {
    let chars_en = get("en", "characters")?;
    let chars_fr = get("fr", "characters")?;
    let items_en = get("en", "items")?;
    let items_fr = get("fr", "items")?;
    let promos = get("en", "character_promotions")?;
    let trees = get("en", "character_skill_trees")?;
    let elements = get("en", "elements")?;
    let paths = get("en", "paths")?;
    let sets_en = get("en", "relic_sets")?;
    let props = get("en", "properties")?;
    let cones_en = get("en", "light_cones")?;
    let cones_fr = get("fr", "light_cones")?;
    let cone_promos = get("en", "light_cone_promotions")?;

    let mut used_items: BTreeSet<String> = [CREDIT, EXP_BOOK, TRACKS].iter().map(|s| s.to_string()).collect();
    let mut chars: Vec<Value> = Vec::new();
    let mut seen_tb: Map<String, Value> = Map::new();
    let mut aliases: Map<String, Value> = Map::new();

    for (cid, c) in obj(&chars_en, "characters")? {
        let el = c["element"].as_str().and_then(|e| lookup(ELEMENT_MAP, e))
            .ok_or_else(|| format!("{cid} : élément inconnu {}", c["element"]))?;
        let path = c["path"].as_str().and_then(|p| lookup(PATH_MAP, p))
            .ok_or_else(|| format!("{cid} : Voie inconnue {}", c["path"]))?;
        let (name_en, name_fr) = if c["name"] == "{NICKNAME}" {
            if let Some(first) = seen_tb.get(path) {
                aliases.insert(cid.clone(), first.clone()); // version fille → même entrée que la version garçon
                continue;
            }
            seen_tb.insert(path.to_string(), json!(cid));
            match TB_NAMES.iter().find(|(p, _, _)| *p == path) {
                Some((_, en, fr)) => (en.to_string(), fr.to_string()),
                None => (format!("Trailblazer ({path})"), format!("Pionnier ({path})")),
            }
        } else {
            let en = c["name"].as_str().unwrap_or_default().to_string();
            let fr = chars_fr.get(cid).and_then(|f| f["name"].as_str()).map(str::to_string).unwrap_or_else(|| en.clone());
            (en, fr)
        };

        // Ascensions : asc[i] = coût de la (i+1)e ascension (paliers 20, 30, … 70)
        let asc: Vec<Value> = arr(promos.get(cid).and_then(|p| p.get("materials")))
            .iter().filter(|step| truthy(Some(step))).map(|step| pack(arr(Some(step)))).collect();
        // Traces : capacités à plusieurs niveaux + toutes les traces bonus à 1 niveau cumulées
        let mut tr = Map::new();
        let mut pts = Map::new();
        let mut bonus: BTreeMap<String, f64> = BTreeMap::new();
        let mut n_bonus = 0;
        for tid in arr(c.get("skill_trees")) {
            let tid = id_str(tid);
            let Some(node) = trees.get(&tid) else { continue };
            let levels = arr(node.get("levels"));
            if node["max_level"].as_i64().unwrap_or(0) > 1 {
                let anchor = node["anchor"].as_str().unwrap_or_default().to_string();
                tr.insert(anchor.clone(), Value::Array(levels.iter().skip(1).map(|l| pack(arr(l.get("materials")))).collect()));
                pts.insert(tid, json!(anchor)); // id du point de trace (vitrine) → capacité
            } else {
                if levels.iter().any(|l| truthy(l.get("materials"))) {
                    n_bonus += 1;
                }
                for l in levels {
                    for m in arr(l.get("materials")) {
                        *bonus.entry(id_str(&m["id"])).or_insert(0.0) += m["num"].as_f64().unwrap_or(0.0);
                    }
                }
            }
        }
        let mut all_ids: BTreeSet<String> = bonus.keys().cloned().collect();
        let mut add_ids = |v: &Value| {
            for step in arr(Some(v)) {
                for pair in arr(Some(step)) {
                    all_ids.insert(id_str(&pair[0]));
                }
            }
        };
        asc.iter().for_each(|step| add_ids(&Value::Array(vec![step.clone()])));
        tr.values().for_each(&mut add_ids);
        // BTreeSet<String> : même tri (par chaîne) que sorted() de Python
        let first_of = |cat: &str| all_ids.iter().find(|i| category(i) == cat).cloned();
        let (boss, weekly) = (first_of("boss"), first_of("weekly"));
        let common: Vec<&String> = all_ids.iter().filter(|i| category(i) == "common").take(3).collect();
        let path_mats: Vec<&String> = all_ids.iter().filter(|i| category(i) == "path").take(3).collect();
        let entry = json!({
            "id": cid, "key": format!("{}|{el}", norm(&name_en)), "en": name_en, "fr": name_fr, "rarity": c["rarity"],
            "element": el, "path": path, "icon": c["icon"], "preview": c.get("preview").cloned().unwrap_or(Value::Null),
            "boss": boss, "weekly": weekly, "common": common, "pathMats": path_mats,
            "asc": asc, "tr": tr, "bonus": bonus.iter().map(|(i, n)| json!([i, num(*n)])).collect::<Vec<_>>(),
            "pts": pts, "nBonus": n_bonus,
        });
        used_items.extend(all_ids.iter().cloned());
        chars.push(entry);
    }

    // Cônes de lumière : un cône dont la Voie est inconnue est ignoré
    let mut light_cones: Vec<Value> = Vec::new();
    for (lid, l) in obj(&cones_en, "light_cones")? {
        let Some(path) = l["path"].as_str().and_then(|p| lookup(PATH_MAP, p)) else { continue };
        let en = l["name"].as_str().unwrap_or_default().to_string();
        let fr = cones_fr.get(lid).and_then(|f| f["name"].as_str()).map(str::to_string).unwrap_or_else(|| en.clone());
        let asc: Vec<Value> = arr(cone_promos.get(lid).and_then(|p| p.get("materials")))
            .iter().filter(|step| truthy(Some(step))).map(|step| pack(arr(Some(step)))).collect();
        for step in &asc {
            for pair in arr(Some(step)) {
                used_items.insert(id_str(&pair[0]));
            }
        }
        light_cones.push(json!({
            "id": lid, "en": en, "fr": fr, "rarity": l["rarity"], "path": path, "icon": l["icon"],
            "preview": l.get("preview").cloned().unwrap_or(Value::Null), "asc": asc,
        }));
    }

    let mut path_mats_by_path = Map::new();
    for c in &chars {
        if c["pathMats"].as_array().is_some_and(|a| a.len() == 3) {
            let p = c["path"].as_str().unwrap().to_string();
            path_mats_by_path.entry(p).or_insert_with(|| c["pathMats"].clone());
        }
    }

    // [nom EN, nom FR, icône, rareté, catégorie]
    let mut items = Map::new();
    for i in &used_items {
        let Some(en) = items_en.get(i) else { continue };
        let fr = items_fr.get(i).unwrap_or(en);
        items.insert(i.clone(), json!([en["name"], fr["name"], en["icon"], en.get("rarity").cloned().unwrap_or(json!(1)), category(i)]));
    }
    let icons_by = |src: &Value, table: &[(&str, &str)]| -> Map<String, Value> {
        src.as_object().into_iter().flatten()
            .filter_map(|(k, v)| lookup(table, k).map(|key| (key.to_string(), v["icon"].clone()))).collect()
    };
    let mut relic_sets = Map::new();
    let mut relic_set_names = Map::new();
    for v in obj(&sets_en, "relic_sets")?.values() {
        relic_sets.insert(norm(v["name"].as_str().unwrap_or_default()), json!([v["icon"], v["id"]]));
        relic_set_names.insert(id_str(&v["id"]), v["name"].clone());
    }
    let mut stats = Map::new();
    let dmg: Vec<(String, String)> = ELEMENT_MAP.iter().map(|(k, v)| (format!("dmg_{v}"), format!("{k}AddedRatio"))).collect();
    let all_stats = STAT_PROPS.iter().map(|(k, p)| (k.to_string(), p.to_string())).chain(dmg);
    for (k, p) in all_stats {
        if let Some(icon) = props.get(&p).and_then(|x| x.get("icon")).filter(|i| truthy(Some(i))) {
            stats.insert(k, icon.clone());
        }
    }

    let char_ids: Vec<String> = chars.iter().map(|c| c["id"].as_str().unwrap().to_string()).collect();
    let mut details = BTreeMap::new();
    for lang in ["fr", "en"] {
        details.insert(lang.to_string(), build_details(&get, lang, &char_ids, &chars_en, &trees)?);
    }
    let game = json!({
        "chars": chars,
        "lightCones": light_cones,
        "elements": icons_by(&elements, ELEMENT_MAP),
        "paths": icons_by(&paths, PATH_MAP),
        "pathMats": path_mats_by_path,
        "items": items,
        // set → [icône du set, id] ; pièce = icon/relic/{id}_{index}.png
        "relicSets": relic_sets,
        "relicSetNames": relic_set_names, // id (vitrine) → nom EN
        "aliases": aliases,
        "stats": stats,
        "special": { "credits": CREDIT, "exp": EXP_BOOK, "td": TRACKS },
    });
    Ok(GameBundle { game, details })
}

/// Fiches détaillées (compétences, traces majeures, bonus de stats, eidolons) d'une langue.
fn build_details(get: &impl Fn(&str, &str) -> Result<Value, String>, lang: &str, char_ids: &[String],
                 chars_en: &Value, trees_en: &Value) -> Result<Value, String> {
    let skills = get(lang, "character_skills")?;
    let ranks = get(lang, "character_ranks")?;
    let trees = get(lang, "character_skill_trees")?;
    let props = get(lang, "properties")?;
    let mut used_props: HashSet<String> = HashSet::new();
    let mut data = Map::new();
    for cid in char_ids {
        let c = &chars_en[cid];
        let mut sk = Vec::new();
        for sid in arr(c.get("skills")) {
            let Some(s) = skills.get(id_str(sid)) else { continue };
            if s.get("type").and_then(Value::as_str).is_some_and(|t| SKIP_SKILL_TYPES.contains(&t)) {
                continue;
            }
            sk.push(json!([s["name"], or_default(s.get("type_text"), json!("")), or_default(s.get("effect_text"), json!("")),
                or_default(s.get("desc"), json!("")), or_default(s.get("params"), json!([])),
                s.get("icon").cloned().unwrap_or(Value::Null), or_default(s.get("type"), json!(""))]));
        }
        let rk: Vec<Value> = arr(c.get("ranks")).iter().filter_map(|r| ranks.get(id_str(r)))
            .map(|r| json!([r["name"], r["desc"], r.get("icon").cloned().unwrap_or(Value::Null)])).collect();
        let mut major = Vec::new();
        let mut stats: Map<String, Value> = Map::new();
        for tid in arr(c.get("skill_trees")) {
            let tid = id_str(tid);
            let Some(node) = trees.get(&tid) else { continue };
            if node["max_level"].as_i64().unwrap_or(0) > 1 {
                continue;
            }
            if truthy(node.get("desc")) { // trace majeure
                let params = or_default(node.get("params"), json!([[]]));
                major.push(json!([node["name"], node["desc"], params[0], node.get("icon").cloned().unwrap_or(Value::Null)]));
            }
            let src = trees_en.get(&tid).filter(|n| truthy(Some(n))).unwrap_or(node);
            for lvl in arr(src.get("levels")) {
                for p in arr(lvl.get("properties")) {
                    let ty = id_str(&p["type"]);
                    let cur = stats.get(&ty).and_then(Value::as_f64).unwrap_or(0.0);
                    stats.insert(ty.clone(), num(round6(cur + p["value"].as_f64().unwrap_or(0.0))));
                    used_props.insert(ty);
                }
            }
        }
        data.insert(cid.clone(), json!({ "skills": sk, "ranks": rk, "major": major, "stats": stats }));
    }
    let prop_names: Map<String, Value> = used_props.into_iter()
        .filter_map(|k| props.get(&k).map(|p| (k.clone(), p["name"].clone()))).collect();
    Ok(json!({ "chars": data, "props": prop_names }))
}

/// Écrit app/js/assets.js et app/js/details/<lang>.js (fichiers intégrés à l'exe).
/// `sha` = commit StarRailRes source : l'app s'en sert pour savoir si ses données intégrées sont à jour.
pub fn write_js(b: &GameBundle, sha: &str, app_js_dir: &Path) -> std::io::Result<()> {
    const HEADER: &str = "/* Généré par src-tauri/src/bin/build_assets.rs — ne pas modifier à la main. */\n";
    std::fs::write(app_js_dir.join("assets.js"), format!(
        "{HEADER}const ASSET_BASE = {};\nconst GAME_SHA = {};\nconst GAME = {};\n", json!(ASSET_BASE), json!(sha), b.game))?;
    let dir = app_js_dir.join("details");
    std::fs::create_dir_all(&dir)?;
    for (lang, d) in &b.details {
        std::fs::write(dir.join(format!("{lang}.js")), format!(
            "{HEADER}window.HSR_DETAILS = window.HSR_DETAILS || {{}};\nHSR_DETAILS[{}] = {};\n", json!(lang), d))?;
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::path::PathBuf;

    pub fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures")
    }

    /// Lit les fichiers StarRailRes enregistrés par tools/capture_fixtures.mjs.
    pub fn fixture_getter() -> impl Fn(&str, &str) -> Result<Value, String> {
        |lang: &str, name: &str| {
            let p = fixtures().join("starrailres").join(lang).join(format!("{name}.json"));
            let raw = std::fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?;
            serde_json::from_str(&raw).map_err(|e| e.to_string())
        }
    }

    /// JSON après `marker` jusqu'au `;` final de la ligne (format des fichiers générés).
    fn js_value(file: &str, marker: &str) -> Value {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("app").join("js").join(file);
        let src = std::fs::read_to_string(p).unwrap();
        let start = src.find(marker).unwrap() + marker.len();
        let line = src[start..].lines().next().unwrap().trim_end();
        serde_json::from_str(line.trim_end_matches(';')).unwrap()
    }

    /// Égalité structurelle ; les nombres sont comparés à 1e-9 près (arrondis Python / Rust).
    pub fn assert_json_eq(a: &Value, b: &Value, path: &str) {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => {
                let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
                assert!((x - y).abs() < 1e-9, "{path}: {x} != {y}");
            }
            (Value::Array(x), Value::Array(y)) => {
                assert_eq!(x.len(), y.len(), "{path}: longueur");
                for (i, (u, v)) in x.iter().zip(y).enumerate() {
                    assert_json_eq(u, v, &format!("{path}[{i}]"));
                }
            }
            (Value::Object(x), Value::Object(y)) => {
                let kx: Vec<_> = x.keys().collect();
                let mut ky: Vec<_> = y.keys().collect();
                let mut kx_sorted = kx.clone();
                kx_sorted.sort();
                ky.sort();
                assert_eq!(kx_sorted, ky, "{path}: clés");
                for (k, u) in x {
                    assert_json_eq(u, &y[k], &format!("{path}.{k}"));
                }
            }
            _ => assert_eq!(a, b, "{path}"),
        }
    }

    #[test]
    fn build_matches_python_output() {
        let b = build(fixture_getter()).unwrap();
        let game = js_value("assets.js", "const GAME = ");
        // `lightCones` n'existe pas dans la sortie de référence : on l'écarte avant de comparer
        let mut built = b.game.clone();
        built.as_object_mut().unwrap().remove("lightCones");
        let mut reference = game;
        reference.as_object_mut().unwrap().remove("lightCones");
        assert_json_eq(&built, &reference, "GAME");
        for lang in ["fr", "en"] {
            let details = js_value(&format!("details/{lang}.js"), &format!("HSR_DETAILS[\"{lang}\"] = "));
            assert_json_eq(&b.details[lang], &details, &format!("details.{lang}"));
        }
        assert_eq!(b.game["chars"].as_array().unwrap().len(), 93);
    }

    #[test]
    fn build_includes_light_cones() {
        let b = build(fixture_getter()).unwrap();
        let cones = b.game["lightCones"].as_array().unwrap();
        let c = cones.iter().find(|c| c["en"] == "Along the Passing Shore").expect("cône absent");
        assert_eq!(c["rarity"], 5);
        assert_eq!(c["path"], "nihility");
        assert_eq!(c["asc"].as_array().unwrap().len(), 6);
        assert!(!c["fr"].as_str().unwrap().is_empty());
        let items = b.game["items"].as_object().unwrap();
        for step in c["asc"].as_array().unwrap() {
            for pair in step.as_array().unwrap() {
                assert!(items.contains_key(pair[0].as_str().unwrap()), "objet {} absent", pair[0]);
            }
        }
    }
}
