//! Sauvegarde des données de l'app dans un fichier JSON (plus fiable que localStorage seul).

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const FILE: &str = "data.json";

fn data_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(FILE))
}

/// Contenu du fichier de sauvegarde, re-sérialisé (donc forcément du JSON valide), ou None.
pub fn load_state(app: &AppHandle) -> Option<String> {
    let raw = fs::read_to_string(data_path(app)?).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value.is_object().then(|| value.to_string())
}

#[tauri::command]
pub fn save_state(app: AppHandle, json: String) -> Result<(), String> {
    // refuse ce qui n'est pas un objet JSON valide : on n'écrase jamais une bonne sauvegarde par du vide
    // (IgnoredAny vérifie la syntaxe sans construire l'arbre en mémoire)
    if !json.trim_start().starts_with('{') {
        return Err("données invalides".into());
    }
    serde_json::from_str::<serde::de::IgnoredAny>(&json).map_err(|e| e.to_string())?;
    let path = data_path(&app).ok_or("dossier de données introuvable")?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // écriture atomique : fichier temporaire puis renommage
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
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
