//! Fil d'actus : annonces officielles HoYoLAB récupérées, mises en cache sur disque
//! (`%APPDATA%\fr.hsrcompanion.desktop\news\`) et regroupées par version.
//! Les posts sont listés en anglais (titres réguliers, voir `parse::classify`) et lus dans la langue de l'app.

pub mod parse;

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use parse::{Announced, GameEvent, NoteSection, Reward, WarpItem, WarpPhase};

/// Post utile repéré dans les listes (titre anglais)
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListedPost {
    pub id: String,
    pub title_en: String,
    pub created_at: i64,
}

/// Contenu d'un post dans une langue (titre et lignes de texte), gardé sans limite de durée
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CachedPost {
    pub subject: String,
    pub lines: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VersionNews {
    pub version: String,
    pub name: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub phases: Vec<WarpPhase>,
    pub events: Vec<GameEvent>,
    pub rewards: Vec<Reward>,
    pub sections: Vec<NoteSection>,
    pub new_items: Vec<WarpItem>,
    pub announced: Vec<Announced>,
    /// Cycles de l'endgame annoncés par le patch note de la version (dates en heure du serveur)
    #[serde(default)]
    pub endgame: Vec<parse::EndgameCycle>,
    /// Thème de la phase d'Arbitre de l'instable
    #[serde(default)]
    pub arbitration: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NewsFeed {
    pub fetched_at: i64,
    pub stale: bool,
    pub latest_id: String,
    pub versions: Vec<VersionNews>,
    pub unattached: Vec<Announced>,
}

/// Requête vers HoYoLAB (la fonction `fetch` renvoie la réponse JSON complète)
#[derive(Debug, Clone, PartialEq)]
pub enum Req {
    List { kind: u8, last_id: Option<String> },
    Post { id: String, lang: String },
}

/// Version en cours + 10 précédentes (les versions annoncées s'y ajoutent)
const VERSIONS_KEPT: usize = 11;
/// Le fil en cache est réutilisé tel quel pendant 30 min
const FRESH_MS: i64 = 30 * 60 * 1000;
/// Pages de liste lues au plus par type d'annonce
const MAX_PAGES: usize = 6;

/// Numéro de version comparable (« 4.10 » après « 4.9 »)
pub fn version_key(v: &str) -> (u32, u32) {
    let mut parts = v.split('.').map(|n| n.parse().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}
/// Ids de posts comparables (nombres trop grands pour être sûrs en u32 : longueur puis texte)
fn id_key(id: &str) -> (usize, &str) {
    (id.len(), id)
}
fn id_str(v: &Value) -> String {
    v.as_str().map(str::to_string).unwrap_or_else(|| if v.is_null() { String::new() } else { v.to_string() })
}

/// Posts utiles d'une réponse `getNewsList`
pub fn listed_from_response(resp: &Value) -> Vec<ListedPost> {
    resp["data"]["list"].as_array().into_iter().flatten().filter_map(|item| {
        let p = &item["post"];
        let title = p["subject"].as_str()?;
        parse::classify(title)?;
        let id = id_str(&p["post_id"]);
        is_post_id(&id).then_some(())?;
        Some(ListedPost { id, title_en: title.to_string(), created_at: p["created_at"].as_i64().unwrap_or(0) })
    }).collect()
}

/// Un id de post HoYoLAB n'est fait que de chiffres : il sert de nom de fichier dans le cache et d'argument d'URL.
pub fn is_post_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit())
}

/// Nom de version dans le titre d'un post : entre guillemets (« … », "…" ou “…”) ou, pour certains anciens
/// patch notes, simplement après le numéro (« … de la version 3.6 Quand l'éternuitée retrouve la terre »).
fn subject_name(subject: &str) -> Option<String> {
    let quoted = regex::Regex::new(r#"[«"“]\s*(.+?)\s*[»"”]"#).unwrap();
    if let Some(c) = quoted.captures(subject) {
        return Some(c[1].to_string());
    }
    let after = regex::Regex::new(r"(?i)\bversion \d+\.\d+\s+(\p{Lu}.+)$").unwrap();
    after.captures(subject.trim()).map(|c| c[1].to_string())
}

/// Versions affichées : les `VERSIONS_KEPT` plus récentes ayant un patch note, plus celles annoncées après.
/// Une version passée reste affichée même si le titre de son patch note n'est pas reconnu
/// (ses bannières ou annonces suffisent).
fn kept_versions(list: &[ListedPost]) -> Vec<String> {
    let mut newest_patch = (0, 0);
    let mut all: Vec<String> = Vec::new();
    for p in list {
        match parse::classify(&p.title_en) {
            Some(parse::PostKind::PatchNotes { version, .. }) => {
                newest_patch = newest_patch.max(version_key(&version));
                all.push(version);
            }
            Some(parse::PostKind::VersionAnnounce { version, .. } | parse::PostKind::Warp { version, .. }) => all.push(version),
            _ => {}
        }
    }
    all.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
    all.dedup();
    // versions annoncées (plus récentes que le dernier patch note), puis la version en cours et les précédentes
    let upcoming = all.iter().take_while(|v| version_key(v) > newest_patch).count();
    all.truncate(upcoming + VERSIONS_KEPT);
    all
}

/// Posts dont le contenu est nécessaire : ceux des versions affichées, et les présentations de persos
/// parues après le dernier patch note (les plus anciennes concernent des persos déjà sortis).
fn needed_posts<'a>(list: &'a [ListedPost], kept: &[String]) -> Vec<&'a ListedPost> {
    let last_patch = list.iter().filter(|p| matches!(parse::classify(&p.title_en), Some(parse::PostKind::PatchNotes { .. })))
        .map(|p| p.created_at).max().unwrap_or(0);
    list.iter().filter(|p| match parse::classify(&p.title_en) {
        Some(parse::PostKind::PatchNotes { version, .. } | parse::PostKind::Warp { version, .. } | parse::PostKind::VersionAnnounce { version, .. }) => kept.contains(&version),
        Some(parse::PostKind::CharacterPreview) => p.created_at > last_patch,
        None => false,
    }).collect()
}

fn slot<'a>(versions: &'a mut HashMap<String, VersionNews>, v: &str) -> &'a mut VersionNews {
    versions.entry(v.to_string()).or_insert_with(|| VersionNews { version: v.to_string(), ..Default::default() })
}

/// Regroupe les posts par version (fonction pure). `posts` : contenus disponibles, par id.
pub fn assemble(list: &[ListedPost], posts: &HashMap<String, CachedPost>, lang: &str) -> NewsFeed {
    let _ = lang; // les contenus sont déjà dans la bonne langue
    let kept = kept_versions(list);
    let mut needed = needed_posts(list, &kept);
    needed.sort_by_key(|p| (p.created_at, id_key(&p.id)));
    let mut versions: HashMap<String, VersionNews> = HashMap::new();
    let mut unattached: Vec<Announced> = Vec::new();
    for p in needed {
        let Some(kind) = parse::classify(&p.title_en) else { continue };
        let content = posts.get(&p.id);
        match kind {
            parse::PostKind::PatchNotes { version, name } => {
                let v = slot(&mut versions, &version);
                v.name = content.and_then(|c| subject_name(&c.subject)).or(Some(name));
                if let Some(c) = content {
                    let pn = parse::parse_patch_note(&c.lines);
                    (v.start, v.end, v.events, v.rewards, v.sections, v.new_items) = (pn.start, pn.end, pn.events, pn.rewards, pn.sections, pn.new_items);
                    (v.endgame, v.arbitration) = (pn.endgame, pn.arbitration);
                }
            }
            parse::PostKind::Warp { version, phase } => {
                let v = slot(&mut versions, &version);
                if let Some(c) = content {
                    v.phases.retain(|w| w.phase != phase);
                    v.phases.push(parse::parse_warp(&c.lines, phase));
                    v.phases.sort_by_key(|w| w.phase);
                }
            }
            parse::PostKind::VersionAnnounce { version, name } => {
                let v = slot(&mut versions, &version);
                if v.name.is_none() {
                    v.name = content.and_then(|c| subject_name(&c.subject)).or(name);
                }
            }
            parse::PostKind::CharacterPreview => {
                for a in content.map(|c| parse::parse_announced(&c.lines)).unwrap_or_default() {
                    if !unattached.iter().any(|u| u.name == a.name) {
                        unattached.push(a);
                    }
                }
            }
        }
    }
    let mut versions: Vec<VersionNews> = versions.into_values().collect();
    versions.sort_by_key(|v| std::cmp::Reverse(version_key(&v.version)));
    // une version commence quand la précédente se termine (fin officielle donnée par son patch note) :
    // date de début d'une version annoncée avant la parution de son propre patch note
    for i in 0..versions.len().saturating_sub(1) {
        if versions[i].start.is_none() {
            versions[i].start = versions[i + 1].end.clone();
        }
    }
    let latest_id = list.iter().map(|p| p.id.as_str()).max_by_key(|id| id_key(id)).unwrap_or_default().to_string();
    NewsFeed { fetched_at: 0, stale: false, latest_id, versions, unattached }
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
fn ok_response(resp: Value) -> Result<Value, String> {
    match resp["retcode"].as_i64() {
        Some(0) => Ok(resp),
        _ => Err(resp["message"].as_str().unwrap_or("réponse HoYoLAB invalide").to_string()),
    }
}

/// Dernier fil enregistré, quel que soit son âge, sans aucun accès réseau (affichage immédiat de l'onglet).
pub fn cached_feed(dir: &Path, lang: &str) -> Option<NewsFeed> {
    read(&dir.join(format!("feed_{lang}.json")))
}

/// Fil d'actus : le cache s'il a moins de 30 min (sauf `force`), sinon rafraîchi depuis HoYoLAB.
/// Hors ligne, le dernier fil en cache est renvoyé avec `stale = true`.
pub fn news_feed_with(dir: &Path, lang: &str, force: bool, now: i64, fetch: impl Fn(&Req) -> Result<Value, String>) -> Result<NewsFeed, String> {
    let feed_path = dir.join(format!("feed_{lang}.json"));
    let cached = cached_feed(dir, lang);
    if let Some(c) = cached.as_ref().filter(|c| !force && now - c.fetched_at < FRESH_MS) {
        return Ok(c.clone());
    }
    match refresh(dir, lang, now, &fetch) {
        Ok(feed) => {
            write(&feed_path, &feed)?;
            Ok(feed)
        }
        Err(e) => cached.map(|c| NewsFeed { stale: true, ..c }).ok_or(e),
    }
}

fn refresh(dir: &Path, lang: &str, now: i64, fetch: &impl Fn(&Req) -> Result<Value, String>) -> Result<NewsFeed, String> {
    let lang_code = if lang == "en" { "en-us" } else { "fr-fr" };
    let list_path = dir.join("list_en.json");
    let mut list: Vec<ListedPost> = read(&list_path).unwrap_or_default();
    for kind in [1u8, 3] {
        let mut last_id: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let resp = ok_response(fetch(&Req::List { kind, last_id: last_id.clone() })?)?;
            let mut known = false;
            for p in listed_from_response(&resp) {
                if list.iter().any(|q| q.id == p.id) { known = true } else { list.push(p) }
            }
            let patches = list.iter().filter(|p| matches!(parse::classify(&p.title_en), Some(parse::PostKind::PatchNotes { .. }))).count();
            last_id = Some(id_str(&resp["data"]["last_id"])).filter(|s| !s.is_empty());
            // les infos (type 3) utiles sont récentes : une page suffit ; les avis (type 1) jusqu'à 11 patch notes
            let enough = kind == 3 || (known && patches >= VERSIONS_KEPT) || patches > VERSIONS_KEPT;
            if enough || resp["data"]["is_last"].as_bool().unwrap_or(true) || last_id.is_none() {
                break;
            }
        }
    }
    write(&list_path, &list)?;
    let kept = kept_versions(&list);
    let mut posts: HashMap<String, CachedPost> = HashMap::new();
    for p in needed_posts(&list, &kept) {
        if !is_post_id(&p.id) {
            continue;   // cache de liste modifié à la main : jamais utilisé comme chemin
        }
        let path = dir.join("posts").join(lang_code).join(format!("{}.json", p.id));
        let cached = read::<CachedPost>(&path).or_else(|| {
            // un post indisponible est simplement ignoré (réessayé au prochain rafraîchissement)
            let resp = fetch(&Req::Post { id: p.id.clone(), lang: lang_code.into() }).and_then(ok_response).ok()?;
            let post = &resp["data"]["post"]["post"];
            let c = CachedPost { subject: post["subject"].as_str().unwrap_or_default().into(), lines: parse::post_lines(post) };
            write(&path, &c).ok()?;
            Some(c)
        });
        if let Some(c) = cached {
            posts.insert(p.id.clone(), c);
        }
    }
    Ok(NewsFeed { fetched_at: now, ..assemble(&list, &posts, lang) })
}

/// Requête réelle vers HoYoLAB (bloquante, suivie de la pause de politesse)
fn http_fetch(client: &reqwest::blocking::Client, r: &Req) -> Result<Value, String> {
    const API: &str = "https://bbs-api-os.hoyolab.com/community/post/wapi";
    let (url, lang) = match r {
        Req::List { kind, last_id } => (
            format!("{API}/getNewsList?gids=6&page_size=50&type={kind}{}", last_id.as_ref().map(|l| format!("&last_id={l}")).unwrap_or_default()),
            "en-us".to_string(),
        ),
        Req::Post { id, lang } => (format!("{API}/getPostFull?post_id={id}"), lang.clone()),
    };
    let resp = client.get(url).header("x-rpc-language", lang).header("Accept", "application/json").send()
        .and_then(|r| r.error_for_status()).and_then(|r| r.json::<Value>()).map_err(|e| e.to_string());
    std::thread::sleep(crate::net::POLITE_DELAY);
    resp
}

/// Fil d'actus dans la langue de l'app (« fr » ou « en »).
#[tauri::command]
pub async fn news_feed(app: tauri::AppHandle, lang: String, force: bool) -> Result<NewsFeed, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("news");
    let lang = if lang == "en" { "en".to_string() } else { "fr".to_string() };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    tauri::async_runtime::spawn_blocking(move || {
        let client = crate::net::blocking_client()?;
        news_feed_with(&dir, &lang, force, now, |r| http_fetch(&client, r))
    }).await.map_err(|e| e.to_string())?
}

/// Dernier fil enregistré (None s'il n'y en a pas encore), sans réseau : l'onglet l'affiche
/// immédiatement puis appelle `news_feed` pour le rafraîchir.
#[tauri::command]
pub fn news_cached(app: tauri::AppHandle, lang: String) -> Result<Option<NewsFeed>, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("news");
    Ok(cached_feed(&dir, if lang == "en" { "en" } else { "fr" }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture_file(name: &str) -> Value {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/hoyolab").join(format!("{name}.json"));
        serde_json::from_str(&fs::read_to_string(p).unwrap()).unwrap()
    }
    fn fixture_list() -> Vec<ListedPost> {
        let mut l = listed_from_response(&fixture_file("list.type1.en-us"));
        l.extend(listed_from_response(&fixture_file("list.type3.en-us")));
        l
    }
    /// Contenus FR disponibles dans les fixtures
    fn fixture_posts(lang: &str) -> HashMap<String, CachedPost> {
        let mut m = HashMap::new();
        for id in ["46861607", "46449452", "46851682", "47142215", "47307963", "47210911", "47310096"] {
            let post = &fixture_file(&format!("{id}.{lang}"))["data"]["post"]["post"];
            m.insert(id.to_string(), CachedPost { subject: post["subject"].as_str().unwrap().into(), lines: parse::post_lines(post) });
        }
        m
    }
    fn tempdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("hsr-news-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn version_name_from_subject_with_or_without_quotes() {
        assert_eq!(subject_name("Détails de la mise à jour de la version 4.6 « Danse avec la bête avant l'orée de la lune »").as_deref(),
            Some("Danse avec la bête avant l'orée de la lune"));
        assert_eq!(subject_name("Détails de la mise à jour de la version 3.6 Quand l'éternuitée retrouve la terre").as_deref(),
            Some("Quand l'éternuitée retrouve la terre"));
        assert_eq!(subject_name("Résumé du programme spécial de la version 4.7"), None);
    }

    #[test]
    fn list_keeps_only_useful_posts() {
        let l = fixture_list();
        assert!(l.iter().any(|p| p.id == "46861607"));
        assert!(l.iter().all(|p| parse::classify(&p.title_en).is_some()));
        assert!(!l.iter().any(|p| p.title_en.contains("Store Update")));
    }

    #[test]
    fn post_ids_other_than_digits_are_dropped() {
        let title = fixture_list()[0].title_en.clone();
        let resp = serde_json::json!({ "data": { "list": [
            { "post": { "post_id": "123", "subject": title } },
            { "post": { "post_id": "../../evil", "subject": title } },
            { "post": { "post_id": 456, "subject": title } }
        ] } });
        let ids: Vec<String> = listed_from_response(&resp).into_iter().map(|p| p.id).collect();
        assert_eq!(ids, ["123", "456"]);
    }

    #[test]
    fn assemble_builds_versions_from_fixtures() {
        let f = assemble(&fixture_list(), &fixture_posts("fr-fr"), "fr");
        assert_eq!(f.versions[0].version, "4.7");
        assert_eq!(f.versions[0].name.as_deref(), Some("Que le rire résonne parmi les étoiles"));
        assert!(f.versions[0].phases.is_empty());
        let v46 = f.versions.iter().find(|v| v.version == "4.6").unwrap();
        assert_eq!(v46.name.as_deref(), Some("Danse avec la bête avant l'orée de la lune"));
        assert_eq!(v46.phases.len(), 2);
        assert_eq!(v46.events.len(), 8);
        assert_eq!(v46.start.as_deref(), Some("2026-09-28T06:00:00+08:00"));
        assert!(v46.new_items.iter().any(|i| i.name == "Perle"));
        assert_eq!(v46.endgame.len(), 4);
        assert_eq!(v46.arbitration.as_deref(), Some("Retour aux sources"));
        // version sans contenu enregistré : gardée avec le nom du titre anglais
        let v44 = f.versions.iter().find(|v| v.version == "4.4").unwrap();
        assert!(v44.name.is_some());
        // versions triées de la plus récente à la plus ancienne
        assert!(f.versions.windows(2).all(|w| version_key(&w[0].version) > version_key(&w[1].version)));
        assert!(!f.latest_id.is_empty());
    }

    #[test]
    fn announced_version_starts_when_previous_one_ends() {
        let f = assemble(&fixture_list(), &fixture_posts("fr-fr"), "fr");
        // pas encore de patch note 4.7 : début = fin officielle de la 4.6
        assert_eq!(f.versions[0].version, "4.7");
        assert_eq!(f.versions[0].start.as_deref(), Some("2026-11-11T06:00:00+08:00"));
        assert_eq!(f.versions[0].end, None);
        // une version qui a son patch note garde sa propre date
        let v46 = f.versions.iter().find(|v| v.version == "4.6").unwrap();
        assert_eq!(v46.start.as_deref(), Some("2026-09-28T06:00:00+08:00"));
    }

    #[test]
    fn version_kept_when_patch_note_title_not_recognised() {
        // le patch note 4.4 (titre reformulé) n'est plus reconnu, mais ses bannières le sont encore
        let list: Vec<ListedPost> = fixture_list().into_iter().filter(|p| p.id != "45851903").collect();
        let f = assemble(&list, &fixture_posts("fr-fr"), "fr");
        assert!(f.versions.iter().any(|v| v.version == "4.4"), "{:?}", f.versions.iter().map(|v| &v.version).collect::<Vec<_>>());
        // toujours au plus la version annoncée + 11 versions
        assert!(f.versions.len() <= VERSIONS_KEPT + 1);
    }

    #[test]
    fn aeon_preview_is_unattached() {
        let f = assemble(&fixture_list(), &fixture_posts("fr-fr"), "fr");
        assert!(f.unattached.iter().any(|a| a.name == "Aiôn ★ Aha"), "{:?}", f.unattached);
        assert!(f.versions[0].announced.is_empty());
    }

    #[test]
    fn feed_uses_fresh_cache_without_fetching() {
        let dir = tempdir("fresh");
        let cached = NewsFeed { fetched_at: 1_000, latest_id: "1".into(), ..Default::default() };
        fs::write(dir.join("feed_fr.json"), serde_json::to_string(&cached).unwrap()).unwrap();
        let f = news_feed_with(&dir, "fr", false, 1_000 + 60_000, |_| panic!("pas de réseau attendu")).unwrap();
        assert_eq!(f, cached);
    }

    #[test]
    fn cached_feed_is_read_without_network_even_when_old() {
        let dir = tempdir("cacheonly");
        assert_eq!(cached_feed(&dir, "fr"), None);
        let cached = NewsFeed { fetched_at: 1_000, latest_id: "1".into(), ..Default::default() };
        fs::write(dir.join("feed_fr.json"), serde_json::to_string(&cached).unwrap()).unwrap();
        assert_eq!(cached_feed(&dir, "fr"), Some(cached));
    }

    #[test]
    fn feed_falls_back_to_cache_when_fetch_fails() {
        let dir = tempdir("offline");
        let cached = NewsFeed { fetched_at: 1_000, latest_id: "1".into(), ..Default::default() };
        fs::write(dir.join("feed_fr.json"), serde_json::to_string(&cached).unwrap()).unwrap();
        let f = news_feed_with(&dir, "fr", true, 10_000_000, |_| Err("hors ligne".into())).unwrap();
        assert!(f.stale);
        assert_eq!(f.latest_id, "1");
        assert!(news_feed_with(&tempdir("empty"), "fr", true, 0, |_| Err("hors ligne".into())).is_err());
    }

    #[test]
    fn feed_fetches_lists_then_missing_posts_and_caches_them() {
        let dir = tempdir("fetch");
        let calls = std::cell::RefCell::new(Vec::new());
        let fetch = |r: &Req| -> Result<Value, String> {
            calls.borrow_mut().push(r.clone());
            match r {
                Req::List { kind, last_id: None } => Ok(fixture_file(&format!("list.type{kind}.en-us"))),
                Req::List { .. } => Ok(serde_json::json!({ "retcode": 0, "data": { "list": [], "is_last": true, "last_id": "" } })),
                Req::Post { id, lang } => {
                    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/hoyolab").join(format!("{id}.{lang}.json"));
                    if p.exists() { Ok(fixture_file(&format!("{id}.{lang}"))) } else { Err(format!("{id} indisponible")) }
                }
            }
        };
        let f = news_feed_with(&dir, "fr", true, 5_000, &fetch).unwrap();
        assert_eq!(f.versions[0].version, "4.7");
        assert!(!f.stale);
        assert!(dir.join("posts/fr-fr/46861607.json").exists());
        // second appel forcé : les posts déjà en cache ne sont pas retéléchargés
        calls.borrow_mut().clear();
        news_feed_with(&dir, "fr", true, 6_000, &fetch).unwrap();
        assert!(!calls.borrow().iter().any(|r| matches!(r, Req::Post { id, .. } if id == "46861607")));
    }
}
