//! Historique des vœux — port en Rust de `find_gacha_url` / `fetch_gacha` de tools/serve.py.
//!
//! La logique (lien trouvé dans le cache du jeu, téléchargement page par page) est séparée du réseau :
//! `fetch_history` reçoit la fonction qui fait la requête, ce qui permet de la tester sans Internet
//! ni vrai lien (tests en bas du fichier, fixtures fabriquées à la main).

use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::Serialize;
use serde_json::Value;

const GACHA_HOSTS: [&str; 2] = ["hoyoverse.com", "mihoyo.com"];
const DEFAULT_GACHA_API: &str =
    "https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog";
/// type de bannière → (point d'accès, libellé interne, obligatoire ?)
/// Une erreur sur une bannière obligatoire arrête l'import ; les autres (collab) sont facultatives.
const GACHA_TYPES: [(&str, &str, &str, bool); 5] = [
    ("11", "getGachaLog", "char", true),
    ("12", "getGachaLog", "lc", true),
    ("1", "getGachaLog", "std", true),
    ("21", "getLdGachaLog", "char", false),
    ("22", "getLdGachaLog", "lc", false),
];
const PAGE_SIZE: usize = 20;

const ERR_INVALID: &str = "Lien invalide : il doit venir de l'historique des vœux du jeu (hoyoverse.com).";
const ERR_EXPIRED: &str = "Lien expiré : rouvrir l'historique des vœux en jeu, puis réessayer.";

#[derive(Serialize, Debug)]
pub struct GachaResult {
    items: Vec<Value>,
    warnings: Vec<String>,
}

// ------------------------------------------------------------------ recherche du lien

/// Lit Player.log pour retrouver le dossier StarRail_Data du jeu.
fn find_game_data_dir() -> Option<PathBuf> {
    let profile = std::env::var_os("USERPROFILE")?;
    let base = Path::new(&profile).join("AppData").join("LocalLow");
    for sub in ["Cognosphere/Star Rail", "miHoYo/崩坏：星穹铁道", "miHoYo/Star Rail"] {
        for name in ["Player.log", "Player-prev.log"] {
            let Ok(bytes) = fs::read(base.join(sub).join(name)) else { continue };
            if let Some(dir) = data_dir_from_log(&String::from_utf8_lossy(&bytes)) {
                return Some(dir);
            }
        }
    }
    None
}

/// Dossier StarRail_Data d'après le texte de Player.log.
fn data_dir_from_log(text: &str) -> Option<PathBuf> {
    let re = Regex::new(r"Loading player data from (.+?)/data\.unity3d").unwrap();
    re.captures(text).map(|m| PathBuf::from(&m[1]))
}

/// Fichiers `webCaches/*/Cache/Cache_Data/data_2`, du plus ancien au plus récent.
fn cache_files(data_dir: &Path) -> Vec<PathBuf> {
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    if let Ok(entries) = fs::read_dir(data_dir.join("webCaches")) {
        for e in entries.flatten() {
            let p = e.path().join("Cache").join("Cache_Data").join("data_2");
            if let Ok(meta) = fs::metadata(&p) {
                found.push((meta.modified().unwrap_or(std::time::UNIX_EPOCH), p));
            }
        }
    }
    found.sort_by_key(|(t, _)| *t);
    found.into_iter().map(|(_, p)| p).collect()
}

/// Dernier lien d'historique (avec authkey) présent dans le cache binaire du jeu.
/// Recherche octet par octet (équivalent du décodage latin-1 de serve.py).
fn last_gacha_url(raw: &[u8]) -> Option<String> {
    let re = regex::bytes::Regex::new(
        r#"(?-u)https://[^\s\x00"']+?(?:getGachaLog|getLdGachaLog)\?[^\s\x00"']+"#,
    )
    .unwrap();
    re.find_iter(raw)
        .map(|m| String::from_utf8_lossy(m.as_bytes()).into_owned())
        .filter(|u| u.contains("authkey="))
        .last()
}

fn find_gacha_url() -> Result<String, String> {
    let data_dir = find_game_data_dir()
        .ok_or("Jeu introuvable : lancer Honkai: Star Rail une fois sur ce PC, puis réessayer.")?;
    let cache = cache_files(&data_dir).pop().ok_or(
        "Cache du jeu introuvable : ouvrir l'historique des vœux en jeu, puis réessayer.",
    )?;
    let raw = fs::read(&cache).map_err(|e| format!("lecture du cache impossible : {e}"))?;
    last_gacha_url(&raw).ok_or_else(|| {
        "Aucun lien trouvé : ouvrir l'historique des vœux en jeu (Vœux > Historique), puis réessayer.".to_string()
    })
}

#[tauri::command]
pub async fn gacha_find() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(find_gacha_url)
        .await
        .map_err(|e| e.to_string())?
}

// ------------------------------------------------------------------ téléchargement

/// Vérifie que le lien vient bien de HoYoverse et contient une authkey ; renvoie ses paramètres.
fn check_gacha_url(raw: &str) -> Option<(url::Url, Vec<(String, String)>)> {
    let u = url::Url::parse(raw).ok()?;
    let host = u.host_str()?;
    // le domaine lui-même ou un de ses sous-domaines (« evilhoyoverse.com » est refusé)
    let allowed = |h: &str| host == h || host.strip_suffix(h).is_some_and(|rest| rest.ends_with('.'));
    if u.scheme() != "https" || !GACHA_HOSTS.iter().any(|h| allowed(h)) {
        return None;
    }
    // un seul exemplaire par clé (le premier), comme parse_qs()[k][0] en Python
    let mut params: Vec<(String, String)> = Vec::new();
    for (k, v) in u.query_pairs() {
        if !params.iter().any(|(pk, _)| *pk == k) {
            params.push((k.into_owned(), v.into_owned()));
        }
    }
    params
        .iter()
        .any(|(k, v)| k == "authkey" && !v.is_empty())
        .then_some((u, params))
}

fn set_param(params: &mut Vec<(String, String)>, key: &str, value: &str) {
    match params.iter_mut().find(|(k, _)| k == key) {
        Some(p) => p.1 = value.to_string(),
        None => params.push((key.to_string(), value.to_string())),
    }
}

/// Tout l'historique du lien `url`, bannière par bannière et page par page.
/// `get(api, params)` fait une requête et renvoie la réponse JSON (erreur réseau, HTTP ou JSON : Err).
/// Elle n'est appelée qu'après la vérification du lien : l'authkey ne part que vers HoYoverse.
fn fetch_history(
    url: &str,
    lang: &str,
    mut get: impl FnMut(&str, &[(String, String)]) -> Result<Value, String>,
) -> Result<GachaResult, String> {
    let (u, mut params) = check_gacha_url(url).ok_or(ERR_INVALID)?;
    let base = if u.path().contains("GachaLog") {
        format!("https://{}{}", u.host_str().unwrap_or_default(), u.path())
    } else {
        DEFAULT_GACHA_API.to_string()
    };
    set_param(&mut params, "lang", lang);
    set_param(&mut params, "size", &PAGE_SIZE.to_string());

    let endpoint_re = Regex::new(r"get(Ld)?GachaLog$").unwrap();
    let mut items: Vec<Value> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    for (gtype, endpoint, group, required) in GACHA_TYPES {
        let api = endpoint_re.replace(&base, endpoint).into_owned();
        let (mut end_id, mut page) = ("0".to_string(), 1u32);
        loop {
            set_param(&mut params, "gacha_type", gtype);
            set_param(&mut params, "page", &page.to_string());
            set_param(&mut params, "end_id", &end_id);
            let mut resp = match get(&api, &params) {
                Ok(v) => v,
                Err(e) => {
                    // une bannière illisible n'empêche pas d'importer les autres
                    warnings.push(format!("bannière {gtype} : {e}"));
                    break;
                }
            };
            let retcode = resp.get("retcode").and_then(Value::as_i64);
            if retcode != Some(0) {
                if !required {
                    break; // bannière collab absente sur ce compte/serveur
                }
                let msg = resp.get("message").and_then(Value::as_str).unwrap_or_default();
                if msg.to_lowercase().contains("authkey") || retcode == Some(-101) {
                    return Err(ERR_EXPIRED.into());
                }
                return Err(if msg.is_empty() { "erreur inconnue".into() } else { msg.to_string() });
            }
            let batch = match resp.pointer_mut("/data/list").map(Value::take) {
                Some(Value::Array(list)) => list,
                _ => Vec::new(),
            };
            let full = batch.len() >= PAGE_SIZE;
            if let Some(id) = batch.last().and_then(|it| it.get("id")).and_then(Value::as_str) {
                end_id = id.to_string();
            }
            items.extend(batch.into_iter().map(|mut it| {
                if let Some(obj) = it.as_object_mut() {
                    obj.insert("group".into(), Value::String(group.into()));
                }
                it
            }));
            if !full {
                break;
            }
            page += 1;
        }
    }
    Ok(GachaResult { items, warnings })
}

#[tauri::command]
pub async fn gacha_fetch(url: String, lang: Option<String>) -> Result<GachaResult, String> {
    let lang = match lang.as_deref() {
        Some("en") => "en",
        _ => "fr",
    };
    tauri::async_runtime::spawn_blocking(move || {
        let client = crate::net::blocking_client()?;
        let mut first = true;
        fetch_history(&url, lang, |api, params| {
            if !first {
                std::thread::sleep(crate::net::POLITE_DELAY); // politesse envers l'API
            }
            first = false;
            get_page(&client, api, params).map_err(|e| e.to_string())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Une page de l'API (toute erreur réseau, HTTP ou JSON est renvoyée telle quelle).
fn get_page(client: &reqwest::blocking::Client, api: &str, params: &[(String, String)]) -> reqwest::Result<Value> {
    client
        .get(api)
        .header("Accept", "application/json")
        .query(params)
        .send()?
        .error_for_status()?
        .json()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    /// Lien factice (aucune vraie authkey)
    const URL: &str = "https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog?authkey_ver=1&authkey=FAUSSE%2Bcle&lang=en&game_biz=hkrpg_global&gacha_type=11&page=1&size=5&end_id=0";

    fn item(id: u64) -> Value {
        json!({ "id": id.to_string(), "name": format!("perso {id}"), "rank_type": "4", "time": "2026-11-01 12:00:00" })
    }
    fn page(ids: std::ops::Range<u64>) -> Value {
        json!({ "retcode": 0, "message": "OK", "data": { "list": ids.map(item).collect::<Vec<_>>() } })
    }
    fn empty() -> Value {
        page(0..0)
    }
    fn param<'a>(params: &'a [(String, String)], k: &str) -> &'a str {
        params.iter().find(|(pk, _)| pk == k).map(|(_, v)| v.as_str()).unwrap_or("")
    }

    /// Requête vue par le faux serveur
    #[derive(Debug)]
    struct Req {
        api: String,
        params: HashMap<String, String>,
    }

    /// Faux serveur : réponses par (gacha_type, page) ; page vide par défaut. Garde toutes les requêtes reçues.
    fn run(url: &str, answers: HashMap<(&str, u32), Result<Value, String>>) -> (Result<GachaResult, String>, Vec<Req>) {
        let mut seen = Vec::new();
        let mut answers: HashMap<(String, u32), Result<Value, String>> =
            answers.into_iter().map(|((g, p), v)| ((g.to_string(), p), v)).collect();
        let r = fetch_history(url, "fr", |api, params| {
            let key = (param(params, "gacha_type").to_string(), param(params, "page").parse::<u32>().unwrap());
            seen.push(Req { api: api.to_string(), params: params.iter().cloned().collect() });
            answers.remove(&key).unwrap_or_else(|| Ok(empty()))
        });
        (r, seen)
    }

    fn ids(r: &GachaResult, group: &str) -> Vec<String> {
        r.items.iter().filter(|it| it["group"] == group).map(|it| it["id"].as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn gacha_url_host_must_be_hoyoverse_or_subdomain() {
        let ok = "https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog?authkey=abc";
        assert!(check_gacha_url(ok).is_some());
        assert!(check_gacha_url("https://hoyoverse.com/getGachaLog?authkey=abc").is_some());
        for bad in [
            "https://evilhoyoverse.com/getGachaLog?authkey=abc",
            "https://hoyoverse.com.evil.net/getGachaLog?authkey=abc",
            "http://api.hoyoverse.com/getGachaLog?authkey=abc",
            "https://api.hoyoverse.com/getGachaLog?authkey=",
        ] {
            assert!(check_gacha_url(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn invalid_link_sends_no_request() {
        for bad in ["https://evil.example/getGachaLog?authkey=abc", "pas un lien", "https://api.hoyoverse.com/getGachaLog"] {
            let (r, seen) = run(bad, HashMap::new());
            assert_eq!(r.unwrap_err(), ERR_INVALID);
            assert!(seen.is_empty(), "{bad}");
        }
    }

    #[test]
    fn follows_pages_until_a_short_page() {
        let answers = HashMap::from([(("11", 1), Ok(page(100..120))), (("11", 2), Ok(page(200..220))), (("11", 3), Ok(page(300..305)))]);
        let (r, seen) = run(URL, answers);
        let r = r.unwrap();
        assert_eq!(ids(&r, "char").len(), 45);
        let char_reqs: Vec<&Req> = seen.iter().filter(|q| q.params["gacha_type"] == "11").collect();
        assert_eq!(char_reqs.len(), 3);
        // chaque page repart du dernier id de la précédente
        assert_eq!(
            char_reqs.iter().map(|q| (q.params["page"].as_str(), q.params["end_id"].as_str())).collect::<Vec<_>>(),
            vec![("1", "0"), ("2", "119"), ("3", "219")]
        );
        assert!(r.warnings.is_empty());
    }

    #[test]
    fn exactly_full_last_page_asks_one_more_then_stops() {
        let answers = HashMap::from([(("12", 1), Ok(page(1..21)))]);
        let (r, seen) = run(URL, answers);
        assert_eq!(ids(&r.unwrap(), "lc").len(), 20);
        assert_eq!(seen.iter().filter(|q| q.params["gacha_type"] == "12").count(), 2);   // page 2 vide : fin
    }

    #[test]
    fn every_banner_is_asked_with_its_group_and_endpoint() {
        let answers = HashMap::from([
            (("11", 1), Ok(page(1..3))),
            (("12", 1), Ok(page(3..4))),
            (("1", 1), Ok(page(4..6))),
            (("21", 1), Ok(page(6..7))),
            (("22", 1), Ok(page(7..8))),
        ]);
        let (r, seen) = run(URL, answers);
        let r = r.unwrap();
        assert_eq!((ids(&r, "char"), ids(&r, "lc"), ids(&r, "std")), (
            vec!["1".into(), "2".into(), "6".into()],
            vec!["3".into(), "7".into()],
            vec!["4".into(), "5".into()]
        ));
        for q in &seen {
            let collab = q.params["gacha_type"].starts_with('2');
            assert_eq!(q.api.ends_with("/getLdGachaLog"), collab, "{q:?}");
            assert!(q.api.starts_with("https://public-operation-hkrpg-sg.hoyoverse.com/"), "{q:?}");
        }
    }

    #[test]
    fn link_params_are_kept_and_lang_size_overridden() {
        let (_, seen) = run(URL, HashMap::new());
        let q = &seen[0].params;
        assert_eq!(q["authkey"], "FAUSSE+cle");
        assert_eq!(q["authkey_ver"], "1");
        assert_eq!((q["lang"].as_str(), q["size"].as_str()), ("fr", "20"));
    }

    #[test]
    fn link_without_gacha_path_uses_default_api() {
        let (_, seen) = run("https://webstatic.hoyoverse.com/hkrpg/event/e20211215gacha-v2/index.html?authkey=abc", HashMap::new());
        assert!(seen[0].api.starts_with(DEFAULT_GACHA_API.trim_end_matches("getGachaLog")));
    }

    #[test]
    fn expired_link_gives_a_clear_message() {
        for resp in [json!({ "retcode": -101, "message": "authkey timeout" }), json!({ "retcode": -100, "message": "authkey error" })] {
            let (r, _) = run(URL, HashMap::from([(("11", 1), Ok(resp))]));
            assert_eq!(r.unwrap_err(), ERR_EXPIRED);
        }
        let (r, _) = run(URL, HashMap::from([(("12", 1), Ok(json!({ "retcode": -1, "message": "visit too frequently" })))]));
        assert_eq!(r.unwrap_err(), "visit too frequently");
    }

    #[test]
    fn missing_collab_banner_is_not_an_error() {
        let answers = HashMap::from([(("11", 1), Ok(page(1..2))), (("21", 1), Ok(json!({ "retcode": -1, "message": "inaccessible" })))]);
        let (r, _) = run(URL, answers);
        let r = r.unwrap();
        assert_eq!(ids(&r, "char"), vec!["1".to_string()]);
        assert!(r.warnings.is_empty());
    }

    #[test]
    fn network_error_on_a_banner_keeps_the_others() {
        let answers = HashMap::from([
            (("11", 1), Ok(page(100..120))),
            (("11", 2), Err("délai dépassé".to_string())),
            (("12", 1), Ok(page(1..2))),
        ]);
        let (r, _) = run(URL, answers);
        let r = r.unwrap();
        assert_eq!((ids(&r, "char").len(), ids(&r, "lc").len()), (20, 1));
        assert_eq!(r.warnings, vec!["bannière 11 : délai dépassé".to_string()]);
    }

    #[test]
    fn finds_the_last_link_with_authkey_in_binary_cache() {
        let mut raw: Vec<u8> = b"\x00\x01junk https://api.hoyoverse.com/getGachaLog?authkey=ANCIEN&x=1\x00".to_vec();
        raw.extend_from_slice(b"\xff\xfe https://api.hoyoverse.com/getGachaLog?lang=fr\x00");   // sans authkey : ignoré
        raw.extend_from_slice(b"https://api.hoyoverse.com/getLdGachaLog?authkey=RECENT&y=2\"suite");
        raw.extend_from_slice(b"\x00 https://api.hoyoverse.com/autre?authkey=PAS_VOEUX\x00");
        assert_eq!(last_gacha_url(&raw).as_deref(), Some("https://api.hoyoverse.com/getLdGachaLog?authkey=RECENT&y=2"));
        assert_eq!(last_gacha_url(b"rien ici"), None);
    }

    /// Vraie requête vers l'API HoYoverse avec une fausse authkey : doit être refusée comme lien expiré.
    /// Réseau : lancer avec `cargo test -- --ignored gacha`.
    #[test]
    #[ignore]
    fn real_api_rejects_fake_authkey_as_expired() {
        let client = crate::net::blocking_client().unwrap();
        let r = fetch_history(URL, "fr", |api, params| get_page(&client, api, params).map_err(|e| e.to_string()));
        assert_eq!(r.unwrap_err(), ERR_EXPIRED);
    }

    #[test]
    fn game_folder_is_read_from_player_log() {
        let log = "[Subsystems] ...\nLoading player data from C:/Games/Star Rail/Game/StarRail_Data/data.unity3d\nautre ligne";
        assert_eq!(data_dir_from_log(log), Some(PathBuf::from("C:/Games/Star Rail/Game/StarRail_Data")));
        assert_eq!(data_dir_from_log("rien"), None);
    }
}
