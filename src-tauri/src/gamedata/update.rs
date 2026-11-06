//! Mise à jour des données du jeu : l'app vérifie le dernier commit StarRailRes, télécharge les
//! fichiers sources, reconstruit les données (`super::build`) et les installe dans
//! `%APPDATA%\fr.hsrcompanion.desktop\gamedata\`. Les données intégrées à l'exe servent de repli.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::{build, SOURCE_FILES};
use crate::net;

const LATEST_SHA_URL: &str = "https://api.github.com/repos/Mar-7th/StarRailRes/commits/master";
const RAW_URL: &str = "https://raw.githubusercontent.com/Mar-7th/StarRailRes";

/// Dernier commit de StarRailRes
pub async fn latest_sha(client: &reqwest::Client) -> Result<String, String> {
    Ok(client.get(LATEST_SHA_URL).header("Accept", "application/vnd.github.sha").send().await
        .and_then(|r| r.error_for_status()).map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())?.trim().to_string())
}

/// Télécharge tous les fichiers sources au commit `sha` (clé « lang/nom »).
pub async fn download_sources(client: &reqwest::Client, sha: &str) -> Result<HashMap<String, Value>, String> {
    let mut sources = HashMap::new();
    for (lang, name) in SOURCE_FILES {
        let url = format!("{RAW_URL}/{sha}/index_new/{lang}/{name}.json");
        let v: Value = client.get(&url).send().await.and_then(|r| r.error_for_status()).map_err(|e| e.to_string())?
            .json().await.map_err(|e| e.to_string())?;
        sources.insert(format!("{lang}/{name}"), v);
        tokio::time::sleep(net::POLITE_DELAY).await;
    }
    Ok(sources)
}

/// Fournisseur pour `build` à partir des fichiers téléchargés
pub fn getter(sources: HashMap<String, Value>) -> impl Fn(&str, &str) -> Result<Value, String> {
    move |lang, name| sources.get(&format!("{lang}/{name}")).cloned().ok_or_else(|| format!("{lang}/{name} manquant"))
}
/// Au plus une vérification de StarRailRes toutes les 6 h
const CHECK_EVERY_MS: i64 = 6 * 3600 * 1000;
/// Données intégrées à l'exe (repli au premier lancement et référence pour `new_chars`)
const EMBEDDED_ASSETS: &str = include_str!("../../../app/js/assets.js");

/// Résultat d'une vérification : `new_chars` = noms EN des persos absents des données précédentes.
#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameUpdate {
    pub updated: bool,
    pub sha: String,
    pub new_chars: Vec<String>,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Valeur d'une ligne `const NOM = <json>;` d'app/js/assets.js
fn embedded_const(name: &str) -> Option<&'static str> {
    let marker = format!("const {name} = ");
    let start = EMBEDDED_ASSETS.find(&marker)? + marker.len();
    Some(EMBEDDED_ASSETS[start..].lines().next()?.trim_end().trim_end_matches(';'))
}
fn embedded_game_json() -> String {
    embedded_const("GAME").unwrap_or("null").to_string()
}
/// Commit StarRailRes des données intégrées (absent des fichiers générés par l'ancien script Python)
fn embedded_sha() -> Option<String> {
    embedded_const("GAME_SHA").and_then(|s| serde_json::from_str(s).ok())
}

/// Fichier JSON du dossier, re-sérialisé (donc forcément valide) ; None s'il manque ou est invalide.
fn read_json(path: &Path) -> Option<String> {
    let v: Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    v.is_object().then(|| v.to_string())
}
/// Données du jeu téléchargées, prêtes à être injectées dans la page.
/// Forme des données produites par `build` : à incrémenter dès qu'elle change, pour qu'une app plus récente
/// n'utilise jamais des données téléchargées dans un ancien format.
pub const DATA_FORMAT: u32 = 2;

/// Les données téléchargées ne valent que pour la version de l'app et le format qui les ont écrites ;
/// sinon on revient aux données intégrées à l'exe (une nouvelle vérification les remplacera).
fn downloaded_usable(dir: &Path) -> bool {
    let meta = read_meta(dir);
    meta["format"].as_u64() == Some(DATA_FORMAT as u64) && meta["appVersion"].as_str() == Some(env!("CARGO_PKG_VERSION"))
}
pub fn load_game(dir: &Path) -> Option<String> {
    downloaded_usable(dir).then(|| read_json(&dir.join("game.json"))).flatten()
}
pub fn load_details(dir: &Path, lang: &str) -> Option<String> {
    downloaded_usable(dir).then(|| read_json(&dir.join(format!("details_{lang}.json")))).flatten()
}
fn read_meta(dir: &Path) -> Value {
    read_json(&dir.join("meta.json")).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}))
}

/// Ids des persos d'un objet GAME
fn char_ids(game: &Value) -> HashSet<String> {
    game["chars"].as_array().into_iter().flatten().filter_map(|c| c["id"].as_str().map(str::to_string)).collect()
}

/// Reconstruit les données et les installe dans `dir`. Tout est d'abord écrit en `.tmp` :
/// si la construction ou une écriture échoue, les fichiers existants restent intacts.
pub fn install(dir: &Path, sha: &str, get: impl Fn(&str, &str) -> Result<Value, String>) -> Result<GameUpdate, String> {
    let bundle = build(get)?;
    let previous: Value = serde_json::from_str(&load_game(dir).unwrap_or_else(embedded_game_json)).unwrap_or(Value::Null);
    let before = char_ids(&previous);
    let new_chars = bundle.game["chars"].as_array().into_iter().flatten()
        .filter(|c| c["id"].as_str().is_some_and(|id| !before.contains(id)))
        .filter_map(|c| c["en"].as_str().map(str::to_string)).collect();

    let now = now_ms();
    let mut files = vec![
        ("game.json".to_string(), bundle.game.to_string()),
        ("meta.json".to_string(), json!({ "sha": sha, "checkedAt": now, "updatedAt": now, "format": DATA_FORMAT, "appVersion": env!("CARGO_PKG_VERSION") }).to_string()),
    ];
    for (lang, d) in &bundle.details {
        files.push((format!("details_{lang}.json"), d.to_string()));
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = |name: &str| dir.join(format!("{name}.tmp"));
    let written = files.iter().try_for_each(|(name, content)| fs::write(tmp(name), content));
    if let Err(e) = written {
        files.iter().for_each(|(name, _)| { let _ = fs::remove_file(tmp(name)); });
        return Err(e.to_string());
    }
    // meta.json en dernier : il ne désigne la nouvelle version qu'une fois les données en place
    files.sort_by_key(|(name, _)| name == "meta.json");
    for (name, _) in &files {
        fs::rename(tmp(name), dir.join(name)).map_err(|e| e.to_string())?;
    }
    Ok(GameUpdate { updated: true, sha: sha.to_string(), new_chars })
}

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("gamedata")).map_err(|e| e.to_string())
}

/// Vérifie StarRailRes (au plus toutes les 6 h) et installe les nouvelles données s'il a changé.
/// Les nouvelles données sont prises en compte au prochain lancement de l'app.
#[tauri::command]
pub async fn game_data_update(app: AppHandle) -> Result<GameUpdate, String> {
    let dir = data_dir(&app)?;
    let mut meta = read_meta(&dir);
    // données téléchargées inutilisables (autre version de l'app) : la référence redevient les données intégrées
    let current = if load_game(&dir).is_some() { meta["sha"].as_str().map(str::to_string) } else { embedded_sha() };
    if now_ms() - meta["checkedAt"].as_i64().unwrap_or(0) < CHECK_EVERY_MS {
        return Ok(GameUpdate { sha: current.unwrap_or_default(), ..Default::default() });
    }
    let client = net::client()?;
    let sha = latest_sha(&client).await?;
    if current.as_deref() == Some(sha.as_str()) {
        // déjà à jour : on note seulement l'heure de la vérification (meta.sha n'existe qu'après un téléchargement)
        meta["checkedAt"] = json!(now_ms());
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(dir.join("meta.json"), meta.to_string()).map_err(|e| e.to_string())?;
        return Ok(GameUpdate { sha, ..Default::default() });
    }
    let sources = download_sources(&client, &sha).await?;
    tauri::async_runtime::spawn_blocking(move || install(&dir, &sha, getter(sources)))
        .await.map_err(|e| e.to_string())?
}

/// Fiches détaillées téléchargées (None : utiliser js/details/<lang>.js intégré).
#[tauri::command]
pub fn game_details(app: AppHandle, lang: String) -> Result<Option<String>, String> {
    if lang != "fr" && lang != "en" {
        return Err("langue inconnue".into());
    }
    Ok(load_details(&data_dir(&app)?, &lang))
}

/// Relance l'app pour charger les nouvelles données du jeu.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gamedata::tests::fixture_getter;
    use std::fs;

    fn tempdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("hsr-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn install_is_atomic_on_failure() {
        let dir = tempdir("atomic");
        fs::write(dir.join("game.json"), "ancien").unwrap();
        let get = fixture_getter();
        let r = install(&dir, "sha2", |lang, name| if name == "items" { Err("coupé".into()) } else { get(lang, name) });
        assert!(r.is_err());
        assert_eq!(fs::read_to_string(dir.join("game.json")).unwrap(), "ancien");
        assert!(!dir.join("game.json.tmp").exists());
        assert!(!dir.join("meta.json").exists());
    }

    #[test]
    fn install_writes_all_files_and_meta() {
        let dir = tempdir("ok");
        let r = install(&dir, "sha2", fixture_getter()).unwrap();
        assert!(r.updated);
        assert_eq!(r.sha, "sha2");
        for f in ["game.json", "details_fr.json", "details_en.json", "meta.json"] {
            assert!(dir.join(f).exists(), "{f} manquant");
        }
        let meta: Value = serde_json::from_str(&fs::read_to_string(dir.join("meta.json")).unwrap()).unwrap();
        assert_eq!(meta["sha"], "sha2");
        // mêmes persos que les données intégrées à l'exe : aucun nouveau
        assert!(r.new_chars.is_empty(), "{:?}", r.new_chars);
        assert!(load_game(&dir).is_some());
        assert!(load_details(&dir, "fr").is_some());
    }

    #[test]
    fn downloaded_data_ignored_after_format_or_app_change() {
        let dir = tempdir("format");
        install(&dir, "sha2", fixture_getter()).unwrap();
        assert!(load_game(&dir).is_some());
        let meta: Value = serde_json::from_str(&fs::read_to_string(dir.join("meta.json")).unwrap()).unwrap();
        // données écrites par une autre version de l'app (format ou version différents) : on revient aux données intégrées
        for (key, other) in [("format", json!(DATA_FORMAT + 1)), ("appVersion", json!("0.0.0"))] {
            let mut m = meta.clone();
            m[key] = other;
            fs::write(dir.join("meta.json"), m.to_string()).unwrap();
            assert!(load_game(&dir).is_none(), "{key}");
            assert!(load_details(&dir, "fr").is_none(), "{key}");
        }
        fs::remove_file(dir.join("meta.json")).unwrap();
        assert!(load_game(&dir).is_none(), "sans meta.json");
    }

    #[test]
    fn data_downloaded_in_format_1_is_not_loaded() {
        // format 1 : données d'avant les cônes (sans lightCones) ; elles ne doivent plus masquer les données intégrées
        let dir = tempdir("format1");
        install(&dir, "sha2", fixture_getter()).unwrap();
        let mut m: Value = serde_json::from_str(&fs::read_to_string(dir.join("meta.json")).unwrap()).unwrap();
        m["format"] = json!(1);
        fs::write(dir.join("meta.json"), m.to_string()).unwrap();
        assert_eq!(DATA_FORMAT, 2);
        assert!(load_game(&dir).is_none());
        assert!(load_details(&dir, "fr").is_none());
    }

    #[test]
    fn new_chars_lists_characters_missing_before() {
        let dir = tempdir("new");
        let mut old: Value = serde_json::from_str(&embedded_game_json()).unwrap();
        old["chars"].as_array_mut().unwrap().retain(|c| c["en"] != "Acheron");
        fs::write(dir.join("game.json"), old.to_string()).unwrap();
        // téléchargement précédent valide (même format, même version de l'app)
        fs::write(dir.join("meta.json"), json!({ "sha": "sha2", "format": DATA_FORMAT, "appVersion": env!("CARGO_PKG_VERSION") }).to_string()).unwrap();
        let r = install(&dir, "sha3", fixture_getter()).unwrap();
        assert_eq!(r.new_chars, vec!["Acheron".to_string()]);
    }
}
