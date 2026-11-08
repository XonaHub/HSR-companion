//! Mise à jour de l'app elle-même (plugin officiel Tauri « updater »).
//!
//! L'app lit `latest.json` dans la dernière release du dépôt public `XonaHub/HSR-companion`
//! (adresse et clé publique dans `tauri.conf.json`, section `plugins.updater`). Chaque version est signée
//! avec une clé privée qui reste hors du dépôt : une mise à jour mal signée est refusée par le plugin.
//! Sous Windows, l'installation lance l'installateur NSIS en mode « passive » ; il ferme l'app,
//! la remplace puis la relance. Les données du joueur (%APPDATA%) ne sont pas touchées.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdate {
    /// version installée
    current: String,
    /// version plus récente publiée, s'il y en a une
    available: Option<String>,
    /// notes de version de la release (texte brut)
    notes: Option<String>,
}

/// Cherche une version plus récente de l'app.
#[tauri::command]
pub async fn app_update_check(app: AppHandle) -> Result<AppUpdate, String> {
    let current = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Impossible de vérifier les mises à jour : {e}"))?;
    Ok(AppUpdate {
        current,
        available: update.as_ref().map(|u| u.version.clone()),
        notes: update.and_then(|u| u.body).filter(|b| !b.trim().is_empty()),
    })
}

/// Télécharge la nouvelle version, vérifie sa signature et l'installe, puis relance l'app.
#[tauri::command]
pub async fn app_update_install(app: AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Impossible de vérifier les mises à jour : {e}"))?
        .ok_or("Aucune mise à jour disponible.")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("La mise à jour a échoué : {e}"))?;
    // Sous Windows l'installateur a déjà fermé l'app ; ailleurs on relance nous-mêmes.
    app.restart();
}
