//! Réglages réseau communs à tous les appels du backend (HoYoverse, HoYoLAB, GitHub).

use std::time::Duration;

pub const UA: &str = "HSR-Companion/1.0 (local fan tool)";
/// Pause entre deux requêtes d'une même série (politesse envers les API)
pub const POLITE_DELAY: Duration = Duration::from_millis(250);

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())
}

/// Client bloquant, pour le travail fait hors du fil principal (spawn_blocking)
pub fn blocking_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())
}
