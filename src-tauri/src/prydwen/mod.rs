//! Classements de cônes Prydwen : page du perso lue, réduite à (nom, rang, score, superposition, date)
//! et mise en cache sur disque (`%APPDATA%\fr.hsrcompanion.desktop\prydwen\`, 24 h).
//! Au plus une requête par perso et par 24 h ; hors ligne, le dernier cache est renvoyé avec `stale = true`.
//! L'adresse d'un perso vient de la liste des persos de Prydwen, jamais d'une transformation du nom.

pub mod parse;

use std::path::Path;

use serde::{Deserialize, Serialize};

pub use parse::Ranking;

const BASE: &str = "https://www.prydwen.gg/star-rail/characters";
const FRESH_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
struct CharacterList {
    fetched_at: i64,
    /// (nom affiché, adresse)
    characters: Vec<(String, String)>,
}

fn read<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}
fn write<T: Serialize>(path: &Path, v: &T) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Liste des persos : cache de moins de 24 h, sinon rafraîchie ; en cas d'échec, le cache même ancien.
fn character_list(dir: &Path, now: i64, fetch: &impl Fn(&str) -> Result<String, String>) -> Result<Vec<(String, String)>, String> {
    let path = dir.join("characters.json");
    let cached: Option<CharacterList> = read(&path);
    if let Some(c) = cached.as_ref().filter(|c| now - c.fetched_at < FRESH_MS) {
        return Ok(c.characters.clone());
    }
    let fresh = fetch(BASE).and_then(|html| {
        let characters = parse::parse_character_list(&html);
        if characters.is_empty() { Err("liste des persos illisible".to_string()) } else { Ok(characters) }
    });
    match fresh {
        Ok(characters) => {
            write(&path, &CharacterList { fetched_at: now, characters: characters.clone() })?;
            Ok(characters)
        }
        Err(e) => cached.map(|c| c.characters).ok_or(e),
    }
}

/// Classement des cônes d'un perso (nom anglais). Le cache de moins de 24 h est servi sans requête (sauf `force`,
/// qui ne concerne que la page du perso : la liste des persos suit toujours son cache de 24 h).
pub fn ranking_with(dir: &Path, name_en: &str, force: bool, now: i64, fetch: impl Fn(&str) -> Result<String, String>) -> Result<Ranking, String> {
    let wanted = crate::gamedata::norm(name_en);
    let slug = character_list(dir, now, &fetch)?
        .into_iter()
        .find(|(name, _)| crate::gamedata::norm(name) == wanted)
        .map(|(_, slug)| slug)
        .ok_or("introuvable")?;
    let path = dir.join(format!("{slug}.json"));
    let cached: Option<Ranking> = read(&path);
    if let Some(c) = cached.as_ref().filter(|c| !force && now - c.fetched_at < FRESH_MS) {
        return Ok(c.clone());
    }
    let fresh = fetch(&format!("{BASE}/{slug}")).and_then(|html| {
        parse::parse_ranking(&html).map(|r| Ranking { fetched_at: now, ..r }).ok_or_else(|| "page Prydwen illisible".to_string())
    });
    match fresh {
        Ok(r) => {
            write(&path, &r)?;
            Ok(r)
        }
        Err(e) => cached.map(|c| Ranking { stale: true, ..c }).ok_or(e),
    }
}

/// Requête réelle (bloquante, suivie de la pause de politesse)
fn http_fetch(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    let resp = client.get(url).header("Accept", "text/html").send()
        .and_then(|r| r.error_for_status()).and_then(|r| r.text()).map_err(|e| e.to_string());
    std::thread::sleep(crate::net::POLITE_DELAY);
    resp
}

/// Classement des cônes d'un perso d'après Prydwen (nom anglais, `force` ignore le cache de 24 h).
#[tauri::command]
pub async fn prydwen_ranking(app: tauri::AppHandle, name_en: String, force: bool) -> Result<Ranking, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("prydwen");
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    tauri::async_runtime::spawn_blocking(move || {
        let client = crate::net::blocking_client()?;
        ranking_with(&dir, &name_en, force, now, |url| http_fetch(&client, url))
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::parse::RankedCone;
    use std::fs;
    use std::path::PathBuf;

    const DAY: i64 = 24 * 60 * 60 * 1000;

    fn tempdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("hsr-prydwen-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    fn fixture(name: &str) -> String {
        fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/prydwen").join(name)).unwrap()
    }
    fn write_list(dir: &Path, fetched_at: i64) {
        let list = CharacterList { fetched_at, characters: vec![("Acheron".into(), "acheron".into())] };
        fs::write(dir.join("characters.json"), serde_json::to_string(&list).unwrap()).unwrap();
    }
    /// Cache avec la liste des persos (récente) et un classement d'Acheron enregistré à `fetched_at`
    fn seeded(name: &str, fetched_at: i64) -> PathBuf {
        let dir = tempdir(name);
        write_list(&dir, 2 * DAY);
        let r = Ranking { updated: "2026-11-04".into(), fetched_at, stale: false, cones: vec![RankedCone { name: "Incessant Rain".into(), rank: 1, score: None, sup: 1 }] };
        fs::write(dir.join("acheron.json"), serde_json::to_string(&r).unwrap()).unwrap();
        dir
    }

    #[test]
    fn ranking_falls_back_to_cache_when_fetch_fails() {
        let dir = seeded("offline", 0);
        let r = ranking_with(&dir, "Acheron", false, 2 * DAY, |_| Err("hors ligne".into())).unwrap();
        assert!(r.stale);
        assert_eq!(r.cones[0].name, "Incessant Rain");
        // liste des persos en cache mais pas de classement : erreur
        let dir = tempdir("nocache");
        write_list(&dir, 0);
        assert!(ranking_with(&dir, "Acheron", false, 100, |_| Err("hors ligne".into())).is_err());
        // aucun cache
        assert!(ranking_with(&tempdir("empty"), "Acheron", false, 0, |_| Err("hors ligne".into())).is_err());
    }

    #[test]
    fn cache_younger_than_24h_skips_fetch() {
        let dir = seeded("fresh", 2 * DAY - 60 * 60 * 1000);
        let r = ranking_with(&dir, "Acheron", false, 2 * DAY, |_| panic!("pas de réseau attendu")).unwrap();
        assert!(!r.stale);
        assert_eq!(r.cones.len(), 1);
    }

    #[test]
    fn fetches_parses_and_caches_then_unknown_name_is_not_guessed() {
        let dir = tempdir("fetch");
        let calls = std::cell::RefCell::new(Vec::new());
        let fetch = |url: &str| -> Result<String, String> {
            calls.borrow_mut().push(url.to_string());
            Ok(fixture(if url.ends_with("/acheron") { "acheron.html" } else { "characters.html" }))
        };
        let r = ranking_with(&dir, "acheron", false, 5_000, &fetch).unwrap();
        assert_eq!((r.cones.len(), r.fetched_at, r.stale), (4, 5_000, false));
        assert!(dir.join("acheron.json").exists() && dir.join("characters.json").exists());
        assert_eq!(*calls.borrow(), vec!["https://www.prydwen.gg/star-rail/characters", "https://www.prydwen.gg/star-rail/characters/acheron"]);
        // deuxième appel : tout vient du cache
        calls.borrow_mut().clear();
        ranking_with(&dir, "Acheron", false, 6_000, &fetch).unwrap();
        assert!(calls.borrow().is_empty());
        // nom inconnu : pas d'adresse devinée, aucune page demandée
        assert_eq!(ranking_with(&dir, "Pas un perso", true, 7_000, &fetch), Err("introuvable".into()));
        assert!(calls.borrow().is_empty());
    }

    #[test]
    fn unreadable_page_falls_back_to_stale_cache() {
        let dir = seeded("changed", 0);
        let r = ranking_with(&dir, "Acheron", false, 2 * DAY, |_| Ok("<html>nouvelle structure</html>".into())).unwrap();
        assert!(r.stale);
    }

    /// Vérification manuelle sur le vrai site : `cargo test prydwen_live -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn prydwen_live() {
        let client = crate::net::blocking_client().unwrap();
        let dir = tempdir("live");
        let r = ranking_with(&dir, "Acheron", true, 1, |u| http_fetch(&client, u)).unwrap();
        println!("{r:?}");
        assert!(r.cones.len() >= 3 && !r.updated.is_empty());
    }
}
