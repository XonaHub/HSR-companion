//! HSR Companion — application de bureau.
//!
//! L'interface (dossier `app/`) est embarquée dans l'exe ; ce que la page ne peut pas faire seule
//! passe par des commandes Tauri :
//!   * `gacha_find` / `gacha_fetch` : import de l'historique des vœux (API officielle HoYoverse) ;
//!   * `save_state` / `export_data` : sauvegarde dans %APPDATA%\fr.hsrcompanion.desktop\ et export ;
//!   * `game_data_update` / `game_details` / `restart_app` : données du jeu à jour (StarRailRes) ;
//!   * `news_feed` : actus officielles HoYoLAB regroupées par version ;
//!   * `app_update_check` / `app_update_install` : mise à jour de l'app depuis les releases GitHub.

mod appupdate;
mod gacha;
pub mod gamedata;
pub mod net;
mod news;
mod prydwen;
mod storage;

use tauri::{WebviewUrl, WebviewWindowBuilder};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // liens externes (target="_blank") ouverts dans le navigateur du système, voir app.js
        .plugin(tauri_plugin_opener::init())
        // mise à jour de l'app : utilisée seulement côté Rust (appupdate.rs), aucune permission côté page
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            appupdate::app_update_check,
            appupdate::app_update_install,
            gacha::gacha_find,
            gacha::gacha_fetch,
            storage::save_state,
            storage::backup_state,
            storage::list_backups,
            storage::read_backup,
            storage::export_data,
            gamedata::update::game_data_update,
            gamedata::update::game_details,
            gamedata::update::restart_app,
            news::news_feed,
            prydwen::prydwen_ranking,
            news::news_cached
        ])
        .setup(|app| {
            // Données injectées avant le chargement de la page, pour qu'app.js les lise de façon
            // synchrone : la sauvegarde du joueur et, si elles ont été téléchargées, les données du jeu.
            storage::backup_at_launch(app.handle()); // avant tout chargement : copie si la version a changé
            let saved = storage::load_state(app.handle()).unwrap_or_else(|| "null".into());
            let mut init = format!("window.__HSR_STATE__ = {saved};");
            if let Some(game) = gamedata::update::data_dir(app.handle()).ok().and_then(|d| gamedata::update::load_game(&d)) {
                init.push_str(&format!("\nwindow.__HSR_GAME__ = {game};"));
            }
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
