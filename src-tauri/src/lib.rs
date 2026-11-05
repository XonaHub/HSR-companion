//! HSR Companion — application de bureau.
//!
//! L'interface (dossier `app/`) est embarquée dans l'exe ; ce que la page ne peut pas faire seule
//! passe par des commandes Tauri :
//!   * `gacha_find` / `gacha_fetch` : import de l'historique des vœux (API officielle HoYoverse) ;
//!   * `save_state` / `export_data` : sauvegarde dans %APPDATA%\fr.hsrcompanion.desktop\ et export ;
//!   * `game_data_update` / `game_details` / `restart_app` : données du jeu à jour (StarRailRes) ;
//!   * `news_feed` : actus officielles HoYoLAB regroupées par version.

mod gacha;
pub mod gamedata;
pub mod net;
mod news;
mod storage;

use tauri::{WebviewUrl, WebviewWindowBuilder};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            gacha::gacha_find,
            gacha::gacha_fetch,
            storage::save_state,
            storage::export_data,
            gamedata::update::game_data_update,
            gamedata::update::game_details,
            gamedata::update::restart_app,
            news::news_feed
        ])
        .setup(|app| {
            // Données injectées avant le chargement de la page, pour qu'app.js les lise de façon
            // synchrone : la sauvegarde du joueur et, si elles ont été téléchargées, les données du jeu.
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
