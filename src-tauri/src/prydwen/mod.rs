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
/// Écriture atomique ; le nom du fichier temporaire est unique (appels concurrents).
fn try_write<T: Serialize>(path: &Path, v: &T) -> Result<(), String> {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = path.with_extension(format!("json.{}.{n}.tmp", std::process::id()));
    std::fs::write(&tmp, serde_json::to_string(v).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| { let _ = std::fs::remove_file(&tmp); e.to_string() })
}
/// Le cache est un confort : un échec d'écriture ne doit pas faire échouer une récupération réussie.
fn write<T: Serialize>(path: &Path, v: &T) {
    if let Err(e) = try_write(path, v) {
        eprintln!("prydwen: cache non écrit ({}): {e}", path.display());
    }
}

/// Dernière tentative de récupération (réussie ou non) par clé (« characters » ou adresse du perso),
/// pour ne pas redemander une page en échec avant 24 h.
fn attempted_recently(dir: &Path, key: &str, now: i64) -> bool {
    read::<std::collections::HashMap<String, i64>>(&dir.join("attempts.json")).and_then(|m| m.get(key).copied()).is_some_and(|t| now - t < FRESH_MS)
}
fn record_attempt(dir: &Path, key: &str, now: i64) {
    let path = dir.join("attempts.json");
    let mut m = read::<std::collections::HashMap<String, i64>>(&path).unwrap_or_default();
    m.insert(key.to_string(), now);
    write(&path, &m);
}

/// Liste des persos : cache de moins de 24 h, sinon rafraîchie ; en cas d'échec, le cache même ancien.
fn character_list(dir: &Path, now: i64, fetch: &impl Fn(&str) -> Result<String, String>) -> Result<Vec<(String, String)>, String> {
    let path = dir.join("characters.json");
    let cached: Option<CharacterList> = read(&path);
    if let Some(c) = cached.as_ref().filter(|c| now - c.fetched_at < FRESH_MS) {
        return Ok(c.characters.clone());
    }
    if cached.is_some() && attempted_recently(dir, "characters", now) {
        return Ok(cached.unwrap().characters);
    }
    if attempted_recently(dir, "characters", now) {
        return Err("liste des persos indisponible".into());
    }
    record_attempt(dir, "characters", now);
    let fresh = fetch(BASE).and_then(|html| {
        let characters = parse::parse_character_list(&html);
        if characters.is_empty() { Err("liste des persos illisible".to_string()) } else { Ok(characters) }
    });
    match fresh {
        Ok(characters) => {
            write(&path, &CharacterList { fetched_at: now, characters: characters.clone() });
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
    // un cache d'avant la lecture des reliques (`relics` absent) est redemandé une fois
    if let Some(c) = cached.as_ref().filter(|c| !force && now - c.fetched_at < FRESH_MS && c.relics.is_some()) {
        return Ok(c.clone());
    }
    if !force && attempted_recently(dir, &slug, now) {
        return cached.map(|c| Ranking { stale: true, ..c }).ok_or_else(|| "classement indisponible".to_string());
    }
    record_attempt(dir, &slug, now);
    let fresh = fetch(&format!("{BASE}/{slug}")).and_then(|html| {
        parse::parse_ranking(&html).map(|r| Ranking { fetched_at: now, ..r }).ok_or_else(|| "page Prydwen illisible".to_string())
    });
    match fresh {
        Ok(r) => {
            write(&path, &r);
            Ok(r)
        }
        Err(e) => cached.map(|c| Ranking { stale: true, ..c }).ok_or(e),
    }
}

/// Instant de la dernière requête réelle, pour espacer toutes les requêtes du processus (appels `invoke` en file d'attente compris).
static LAST_REQUEST: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
/// Attend que `POLITE_DELAY` se soit écoulé depuis la requête précédente, puis réserve le créneau.
fn polite_wait() {
    let mut last = LAST_REQUEST.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(t) = *last {
        let elapsed = t.elapsed();
        if elapsed < crate::net::POLITE_DELAY {
            std::thread::sleep(crate::net::POLITE_DELAY - elapsed);
        }
    }
    *last = Some(std::time::Instant::now());
}

/// Requête réelle (bloquante)
fn http_fetch(client: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    client.get(url).header("Accept", "text/html").send()
        .and_then(|r| r.error_for_status()).and_then(|r| r.text()).map_err(|e| e.to_string())
}

/// Classement des cônes d'un perso d'après Prydwen (nom anglais, `force` ignore le cache de 24 h).
#[tauri::command]
pub async fn prydwen_ranking(app: tauri::AppHandle, name_en: String, force: bool) -> Result<Ranking, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("prydwen");
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    tauri::async_runtime::spawn_blocking(move || {
        let client = crate::net::blocking_client()?;
        ranking_with(&dir, &name_en, force, now, |url| {
            // pause de politesse entre deux requêtes réelles du processus, appels en file d'attente compris
            polite_wait();
            http_fetch(&client, url)
        })
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
        let r = Ranking { updated: "2026-11-04".into(), fetched_at, stale: false, cones: vec![RankedCone { name: "Incessant Rain".into(), rank: 1, score: None, sup: 1 }], relics: Some(Default::default()) };
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
    fn failed_attempts_are_not_repeated_within_24h() {
        let calls = std::cell::Cell::new(0);
        let fail = |_: &str| -> Result<String, String> { calls.set(calls.get() + 1); Err("503".into()) };
        // perso en cache (page en échec) : une seule requête, puis le cache périmé sans réseau
        let dir = seeded("retry-cached", 0);
        for t in [2 * DAY, 2 * DAY + 1000] {
            assert!(ranking_with(&dir, "Acheron", false, t, &fail).unwrap().stale);
        }
        assert_eq!(calls.get(), 1);
        // `force` retente quand même
        ranking_with(&dir, "Acheron", true, 2 * DAY + 2000, &fail).unwrap();
        assert_eq!(calls.get(), 2);
        // perso sans cache : une seule requête, puis une erreur sans réseau
        calls.set(0);
        let dir = tempdir("retry-uncached");
        write_list(&dir, 2 * DAY);
        for t in [2 * DAY, 2 * DAY + 1000] {
            assert!(ranking_with(&dir, "Acheron", false, t, &fail).is_err());
        }
        assert_eq!(calls.get(), 1);
        // liste des persos en échec : une seule requête aussi
        calls.set(0);
        let dir = tempdir("retry-list");
        for t in [0, 1000] {
            assert!(ranking_with(&dir, "Acheron", false, t, &fail).is_err());
        }
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn cache_write_failure_does_not_fail_a_good_fetch() {
        // « dossier » de cache occupé par un fichier : aucune écriture possible
        let blocker = std::env::temp_dir().join(format!("hsr-prydwen-blocker-{}", std::process::id()));
        fs::write(&blocker, "x").unwrap();
        let fetch = |url: &str| -> Result<String, String> {
            Ok(fixture(if url.ends_with("/acheron") { "acheron.html" } else { "characters.html" }))
        };
        let r = ranking_with(&blocker, "Acheron", false, 5_000, fetch).unwrap();
        assert_eq!(r.cones.len(), 4);
        let _ = fs::remove_file(&blocker);
    }

    #[test]
    fn fresh_cache_without_relics_is_fetched_once() {
        let dir = seeded("norelics", 2 * DAY - 60 * 60 * 1000);
        // cache enregistré avant la lecture des reliques
        let mut old: serde_json::Value = serde_json::from_str(&fs::read_to_string(dir.join("acheron.json")).unwrap()).unwrap();
        old.as_object_mut().unwrap().remove("relics");
        fs::write(dir.join("acheron.json"), old.to_string()).unwrap();
        let calls = std::cell::Cell::new(0);
        let fetch = |_: &str| -> Result<String, String> { calls.set(calls.get() + 1); Ok(fixture("acheron.html")) };
        let r = ranking_with(&dir, "Acheron", false, 2 * DAY, &fetch).unwrap();
        assert!(r.relics.is_some_and(|a| !a.sets.is_empty()));
        ranking_with(&dir, "Acheron", false, 2 * DAY + 1000, &fetch).unwrap();
        assert_eq!(calls.get(), 1);
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
