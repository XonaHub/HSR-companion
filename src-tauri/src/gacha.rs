//! Historique des vœux — port en Rust de `find_gacha_url` / `fetch_gacha` de tools/serve.py.

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

#[derive(Serialize)]
pub struct GachaResult {
    items: Vec<Value>,
    warnings: Vec<String>,
}

// ------------------------------------------------------------------ recherche du lien

/// Lit Player.log pour retrouver le dossier StarRail_Data du jeu.
fn find_game_data_dir() -> Option<PathBuf> {
    let profile = std::env::var_os("USERPROFILE")?;
    let base = Path::new(&profile).join("AppData").join("LocalLow");
    let re = Regex::new(r"Loading player data from (.+?)/data\.unity3d").unwrap();
    for sub in ["Cognosphere/Star Rail", "miHoYo/崩坏：星穹铁道", "miHoYo/Star Rail"] {
        for name in ["Player.log", "Player-prev.log"] {
            let Ok(bytes) = fs::read(base.join(sub).join(name)) else { continue };
            let text = String::from_utf8_lossy(&bytes);
            if let Some(m) = re.captures(&text) {
                return Some(PathBuf::from(&m[1]));
            }
        }
    }
    None
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

fn find_gacha_url() -> Result<String, String> {
    let data_dir = find_game_data_dir()
        .ok_or("Jeu introuvable : lance Honkai: Star Rail une fois sur ce PC, puis réessaie.")?;
    let cache = cache_files(&data_dir).pop().ok_or(
        "Cache du jeu introuvable : ouvre l'historique des vœux en jeu, puis réessaie.",
    )?;
    let raw = fs::read(&cache).map_err(|e| format!("lecture du cache impossible : {e}"))?;
    // le cache est binaire : on cherche octet par octet (équivalent du décodage latin-1 de serve.py)
    let re = regex::bytes::Regex::new(
        r#"(?-u)https://[^\s\x00"']+?(?:getGachaLog|getLdGachaLog)\?[^\s\x00"']+"#,
    )
    .unwrap();
    re.find_iter(&raw)
        .map(|m| String::from_utf8_lossy(m.as_bytes()).into_owned())
        .filter(|u| u.contains("authkey="))
        .last()
        .ok_or_else(|| {
            "Aucun lien trouvé : ouvre l'historique des vœux en jeu (Vœux > Historique), puis réessaie."
                .to_string()
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

#[tauri::command]
pub async fn gacha_fetch(url: String, lang: Option<String>) -> Result<GachaResult, String> {
    let lang = match lang.as_deref() {
        Some("en") => "en",
        _ => "fr",
    };
    let (u, mut params) = check_gacha_url(&url).ok_or(
        "Lien invalide : il doit venir de l'historique des vœux du jeu (hoyoverse.com).",
    )?;
    let base = if u.path().contains("GachaLog") {
        format!("https://{}{}", u.host_str().unwrap_or_default(), u.path())
    } else {
        DEFAULT_GACHA_API.to_string()
    };
    set_param(&mut params, "lang", lang);
    set_param(&mut params, "size", &PAGE_SIZE.to_string());

    let client = crate::net::client()?;
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
            let mut resp = match get_page(&client, &api, &params).await {
                Ok(v) => v,
                Err(e) => {
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
                    return Err("Lien expiré : rouvre l'historique des vœux en jeu, puis réessaie.".into());
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
            tokio::time::sleep(crate::net::POLITE_DELAY).await; // politesse envers l'API
        }
    }
    Ok(GachaResult { items, warnings })
}

/// Une page de l'API (toute erreur réseau, HTTP ou JSON est renvoyée telle quelle).
async fn get_page(client: &reqwest::Client, api: &str, params: &[(String, String)]) -> reqwest::Result<Value> {
    client
        .get(api)
        .header("Accept", "application/json")
        .query(params)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
