//! Sauvegarde des données de l'app dans un fichier JSON (plus fiable que localStorage seul),
//! et copies de la sauvegarde pour revenir en arrière (dossier `backups/` à côté de `data.json`) :
//! - « copie du jour » : au premier enregistrement d'un jour, l'état d'avant (`daily-<jour>-<ms>.json`) ;
//! - « avant opération » : état envoyé par la page juste avant un import, une remise à zéro, une restauration,
//!   ou copie de `data.json` au premier lancement d'une nouvelle version (`op-<raison>-<ms>.json`).
//! On garde les KEEP dernières de chaque sorte.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const FILE: &str = "data.json";
const BACKUP_DIR: &str = "backups";
const VERSION_FILE: &str = "version.txt";
const KEEP: usize = 5;
/// Raisons des copies « avant opération » (liste fermée : elles finissent dans des noms de fichiers).
const REASONS: &[&str] = &["archive", "import", "gacha", "reset", "restore", "update"];

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|_| "dossier de données introuvable".to_string())
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Refuse ce qui n'est pas un objet JSON valide : on n'écrase jamais une bonne sauvegarde par du vide
/// (IgnoredAny vérifie la syntaxe sans construire l'arbre en mémoire).
fn check_object(json: &str) -> Result<(), String> {
    if !json.trim_start().starts_with('{') {
        return Err("données invalides".into());
    }
    serde_json::from_str::<serde::de::IgnoredAny>(json).map(|_| ()).map_err(|e| e.to_string())
}

/// Écriture atomique : fichier temporaire puis renommage.
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Contenu du fichier de sauvegarde, re-sérialisé (donc forcément du JSON valide), ou None.
pub fn load_state(app: &AppHandle) -> Option<String> {
    let raw = fs::read_to_string(data_dir(app).ok()?.join(FILE)).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value.is_object().then(|| value.to_string())
}

/// day : jour local de la page (AAAA-MM-JJ), pour la copie du jour ; ignoré s'il est absent ou mal formé.
fn write_state(dir: &Path, json: &str, day: Option<&str>, now: i64) -> Result<(), String> {
    check_object(json)?;
    let path = dir.join(FILE);
    if let Some(day) = day.filter(|d| is_day(d)) {
        let prefix = format!("daily-{day}-");
        let done = list_in(dir).iter().any(|b| b.id.starts_with(&prefix));
        if !done && path.is_file() {
            // une copie ratée ne doit pas empêcher d'enregistrer
            let _ = copy_backup(dir, &path, &format!("{prefix}{now}.json"), "daily");
        }
    }
    write_atomic(&path, json)
}

#[tauri::command]
pub fn save_state(app: AppHandle, json: String, day: Option<String>) -> Result<(), String> {
    write_state(&data_dir(&app)?, &json, day.as_deref(), now_ms())
}

fn is_day(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

#[derive(Serialize, Debug)]
pub struct Backup {
    id: String,
    kind: String,   // daily | op
    reason: String, // vide pour daily
    at: i64,        // ms depuis 1970
}

/// Lit un nom de fichier de copie ; None pour tout autre nom (c'est aussi ce qui protège read_backup).
fn parse_name(name: &str) -> Option<Backup> {
    let stem = name.strip_suffix(".json")?;
    let (kind, reason, ms) = if let Some(rest) = stem.strip_prefix("daily-") {
        let day = rest.get(..10)?;
        if !is_day(day) {
            return None;
        }
        ("daily", "", rest.get(10..)?.strip_prefix('-')?)
    } else {
        let (reason, ms) = stem.strip_prefix("op-")?.split_once('-')?;
        if !REASONS.contains(&reason) {
            return None;
        }
        ("op", reason, ms)
    };
    if ms.is_empty() || ms.len() > 15 || !ms.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(Backup { id: name.to_string(), kind: kind.into(), reason: reason.into(), at: ms.parse().ok()? })
}

/// Copies présentes, de la plus récente à la plus ancienne.
fn list_in(dir: &Path) -> Vec<Backup> {
    let mut out: Vec<Backup> = fs::read_dir(dir.join(BACKUP_DIR))
        .map(|rd| rd.flatten().filter_map(|e| parse_name(&e.file_name().to_string_lossy())).collect())
        .unwrap_or_default();
    out.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| b.id.cmp(&a.id)));
    out
}

/// Ne garde que les KEEP plus récentes de cette sorte.
fn rotate(dir: &Path, kind: &str) {
    for b in list_in(dir).into_iter().filter(|b| b.kind == kind).skip(KEEP) {
        let _ = fs::remove_file(dir.join(BACKUP_DIR).join(&b.id));
    }
}

fn copy_backup(dir: &Path, from: &Path, name: &str, kind: &str) -> Result<(), String> {
    let content = fs::read_to_string(from).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(BACKUP_DIR).join(name), &content)?;
    rotate(dir, kind);
    Ok(())
}

fn backup_in(dir: &Path, reason: &str, json: &str, now: i64) -> Result<(), String> {
    if !REASONS.contains(&reason) {
        return Err("raison inconnue".into());
    }
    check_object(json)?;
    write_atomic(&dir.join(BACKUP_DIR).join(format!("op-{reason}-{now}.json")), json)?;
    rotate(dir, "op");
    Ok(())
}

fn read_in(dir: &Path, id: &str) -> Result<String, String> {
    let b = parse_name(id).ok_or("copie inconnue")?;
    let raw = fs::read_to_string(dir.join(BACKUP_DIR).join(&b.id)).map_err(|e| e.to_string())?;
    check_object(&raw)?;
    Ok(raw)
}

/// Au lancement : si la version de l'app a changé depuis le dernier lancement, copie data.json
/// (la nouvelle version peut transformer la sauvegarde au chargement).
pub fn backup_on_version_change(dir: &Path, version: &str, now: i64) {
    let marker = dir.join(BACKUP_DIR).join(VERSION_FILE);
    if fs::read_to_string(&marker).ok().as_deref() == Some(version) {
        return;
    }
    let data = dir.join(FILE);
    if data.is_file() && copy_backup(dir, &data, &format!("op-update-{now}.json"), "op").is_err() {
        return; // on réessaiera au prochain lancement
    }
    let _ = fs::create_dir_all(dir.join(BACKUP_DIR));
    let _ = fs::write(marker, version);
}

pub fn backup_at_launch(app: &AppHandle) {
    if let Ok(dir) = data_dir(app) {
        backup_on_version_change(&dir, &app.package_info().version.to_string(), now_ms());
    }
}

/// Copie « avant opération » de l'état envoyé par la page (raison : voir REASONS).
#[tauri::command]
pub fn backup_state(app: AppHandle, reason: String, json: String) -> Result<(), String> {
    backup_in(&data_dir(&app)?, &reason, &json, now_ms())
}

#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Vec<Backup>, String> {
    Ok(list_in(&data_dir(&app)?))
}

/// Contenu d'une copie (objet JSON) ; la page le fait passer par migrate/sanitizeState comme un import.
#[tauri::command]
pub fn read_backup(app: AppHandle, id: String) -> Result<String, String> {
    read_in(&data_dir(&app)?, &id)
}

/// Ouvre « Enregistrer sous… » et écrit l'export. Renvoie le chemin choisi, ou None si annulé.
#[tauri::command]
pub async fn export_data(app: AppHandle, name: String, content: String) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("JSON", &["json"])
        .blocking_save_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("hsr-test-storage-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    const DAY: i64 = 86_400_000;
    const T0: i64 = 1_762_600_000_000;

    #[test]
    fn write_state_refuses_invalid_json_and_keeps_old_save() {
        let d = tempdir("invalid");
        write_state(&d, r#"{"a":1}"#, None, T0).unwrap();
        assert!(write_state(&d, "", None, T0).is_err());
        assert!(write_state(&d, "[1]", None, T0).is_err());
        assert!(write_state(&d, "{oops", None, T0).is_err());
        assert_eq!(fs::read_to_string(d.join(FILE)).unwrap(), r#"{"a":1}"#);
    }

    #[test]
    fn daily_copy_keeps_previous_save_once_per_day() {
        let d = tempdir("daily");
        write_state(&d, r#"{"v":1}"#, Some("2026-11-07"), T0).unwrap();   // pas encore de sauvegarde : rien à copier
        assert!(list_in(&d).is_empty());
        write_state(&d, r#"{"v":2}"#, Some("2026-11-07"), T0 + 1).unwrap();   // pas encore de copie ce jour-là : on garde v1
        write_state(&d, r#"{"v":3}"#, Some("2026-11-07"), T0 + 2).unwrap();   // déjà copié aujourd'hui
        let l = list_in(&d);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].kind, "daily");
        assert_eq!(read_in(&d, &l[0].id).unwrap(), r#"{"v":1}"#);
        write_state(&d, r#"{"v":4}"#, Some("2026-11-08"), T0 + DAY).unwrap();   // nouveau jour : copie de v3
        let l = list_in(&d);
        assert_eq!(l.len(), 2);
        assert_eq!(read_in(&d, &l[0].id).unwrap(), r#"{"v":3}"#);   // plus récente en premier
    }

    #[test]
    fn daily_day_is_validated() {
        let d = tempdir("day");
        write_state(&d, r#"{"v":1}"#, None, T0).unwrap();
        write_state(&d, r#"{"v":2}"#, Some("../x"), T0).unwrap();   // jour invalide : sauvegarde faite, pas de copie
        assert!(list_in(&d).is_empty());
        assert_eq!(fs::read_to_string(d.join(FILE)).unwrap(), r#"{"v":2}"#);
    }

    #[test]
    fn keeps_five_copies_of_each_kind() {
        let d = tempdir("rotate");
        write_state(&d, r#"{"v":0}"#, None, T0).unwrap();
        for i in 0..8 {
            write_state(&d, &format!(r#"{{"v":{i}}}"#), Some(&format!("2026-10-{:02}", i + 1)), T0 + i * DAY).unwrap();
            backup_in(&d, "archive", &format!(r#"{{"op":{i}}}"#), T0 + i * DAY + 1).unwrap();
        }
        let l = list_in(&d);
        assert_eq!(l.iter().filter(|b| b.kind == "daily").count(), KEEP);
        assert_eq!(l.iter().filter(|b| b.kind == "op").count(), KEEP);
        let newest_op = l.iter().find(|b| b.kind == "op").unwrap();
        assert_eq!(read_in(&d, &newest_op.id).unwrap(), r#"{"op":7}"#);
        let oldest_op = l.iter().rev().find(|b| b.kind == "op").unwrap();
        assert_eq!(read_in(&d, &oldest_op.id).unwrap(), r#"{"op":3}"#);
    }

    #[test]
    fn backup_validates_reason_and_json() {
        let d = tempdir("backup");
        assert!(backup_in(&d, "../evil", "{}", T0).is_err());
        assert!(backup_in(&d, "nope", "{}", T0).is_err());
        assert!(backup_in(&d, "import", "pas du json", T0).is_err());
        backup_in(&d, "import", r#"{"x":1}"#, T0).unwrap();
        let l = list_in(&d);
        assert_eq!((l.len(), l[0].kind.as_str(), l[0].reason.as_str(), l[0].at), (1, "op", "import", T0));
    }

    #[test]
    fn read_refuses_unknown_names() {
        let d = tempdir("read");
        fs::write(d.join(FILE), r#"{"secret":1}"#).unwrap();
        for id in ["../data.json", "data.json", "op-import-1.json/../../data.json", "op-evil-1.json", ""] {
            assert!(read_in(&d, id).is_err(), "{id}");
        }
    }

    #[test]
    fn other_files_in_backup_folder_are_ignored() {
        let d = tempdir("ignore");
        fs::create_dir_all(d.join(BACKUP_DIR)).unwrap();
        fs::write(d.join(BACKUP_DIR).join("notes.txt"), "x").unwrap();
        fs::write(d.join(BACKUP_DIR).join("op-evil-5.json"), "{}").unwrap();
        assert!(list_in(&d).is_empty());
    }

    #[test]
    fn version_change_copies_the_save_once() {
        let d = tempdir("version");
        backup_on_version_change(&d, "1.0.0", T0);   // pas encore de sauvegarde : rien à copier
        assert!(list_in(&d).is_empty());
        fs::write(d.join(FILE), r#"{"v":1}"#).unwrap();
        backup_on_version_change(&d, "1.0.0", T0 + 1);   // même version (déjà notée) : rien
        assert!(list_in(&d).is_empty());
        backup_on_version_change(&d, "1.1.0", T0 + 2);
        backup_on_version_change(&d, "1.1.0", T0 + 3);
        let l = list_in(&d);
        assert_eq!(l.len(), 1);
        assert_eq!((l[0].reason.as_str(), l[0].at), ("update", T0 + 2));
        assert_eq!(read_in(&d, &l[0].id).unwrap(), r#"{"v":1}"#);
    }

    #[test]
    fn first_launch_with_existing_save_counts_as_update() {
        let d = tempdir("firstver");
        fs::write(d.join(FILE), r#"{"v":1}"#).unwrap();   // sauvegarde d'une version sans copies
        backup_on_version_change(&d, "1.1.0", T0);
        assert_eq!(list_in(&d).len(), 1);
    }
}
