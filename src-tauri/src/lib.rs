//! HSR Companion — application de bureau.
//!
//! Remplace `tools/serve.py` : l'interface (dossier `app/`) est embarquée dans l'exe,
//! et les fonctions que le navigateur ne peut pas faire seul passent par des commandes Tauri :
//!   * `gacha_find`  : retrouve le lien d'historique des vœux dans le cache du jeu ;
//!   * `gacha_fetch` : télécharge l'historique complet depuis l'API officielle HoYoverse ;
//!   * `save_state`  : sauvegarde les données dans %APPDATA%\fr.hsrcompanion.desktop\data.json ;
//!   * `export_data` : enregistre un export JSON là où l'utilisateur le choisit.

mod gacha;
mod storage;

use tauri::{WebviewUrl, WebviewWindowBuilder};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            gacha::gacha_find,
            gacha::gacha_fetch,
            storage::save_state,
            storage::export_data
        ])
        .setup(|app| {
            // Les données sauvegardées sont injectées avant le chargement de la page :
            // app.js peut ainsi les lire de façon synchrone, comme avec localStorage.
            let saved = storage::load_state(app.handle()).unwrap_or_else(|| "null".into());
            let init = format!("window.__HSR_STATE__ = {saved};");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("HSR Companion")
                .inner_size(1320.0, 880.0)
                .min_inner_size(900.0, 600.0)
                .initialization_script(&init)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("impossible de démarrer HSR Companion");
}
