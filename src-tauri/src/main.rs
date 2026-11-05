// Pas de fenêtre console en version finale
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hsr_companion::run();
}
