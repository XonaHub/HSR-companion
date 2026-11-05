//! Régénère les données du jeu intégrées à l'exe (app/js/assets.js et app/js/details/<lang>.js)
//! depuis le dernier commit de StarRailRes. L'app se met à jour seule ; cette commande sert
//! seulement à rafraîchir les données de repli avant une nouvelle compilation.
//!
//! Usage (depuis src-tauri) : cargo run --bin build_assets

use std::path::PathBuf;

use hsr_companion::gamedata::{build, update, write_js};

fn main() {
    let out = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("app").join("js");
    let result = tauri::async_runtime::block_on(async {
        let client = hsr_companion::net::client()?;
        let sha = update::latest_sha(&client).await?;
        println!("StarRailRes @{}", &sha[..7.min(sha.len())]);
        let bundle = build(update::getter(update::download_sources(&client, &sha).await?))?;
        write_js(&bundle, &sha, &out).map_err(|e| e.to_string())?;
        Ok::<_, String>(bundle.game["chars"].as_array().map_or(0, Vec::len))
    });
    match result {
        Ok(n) => println!("{n} persos -> {}", out.display()),
        Err(e) => {
            eprintln!("erreur : {e}");
            std::process::exit(1);
        }
    }
}
