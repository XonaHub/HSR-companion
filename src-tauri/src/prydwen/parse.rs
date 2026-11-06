//! Lecture des pages Prydwen (HTML rendu) : classement « Best Light Cones » d'un perso et liste des persos.
//! On ne garde que le nom du cône, son score relatif, la superposition testée et la date de mise à jour :
//! jamais les textes d'explication.
//! Le rang est la position dans la liste de la page (1 = premier affiché).

use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct RankedCone {
    pub name: String,
    pub rank: u32,
    /// Score relatif en % (125.5 pour « 125.50% »), s'il est affiché
    pub score: Option<f64>,
    /// Superposition testée (1 à 5)
    pub sup: u8,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ranking {
    /// « AAAA-MM-JJ », d'après « Last updated » de la page
    pub updated: String,
    pub fetched_at: i64,
    pub stale: bool,
    pub cones: Vec<RankedCone>,
}

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&").replace("&#x27;", "'").replace("&#39;", "'").replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">").trim().to_string()
}

/// « 04/November/2026 » -> « 2026-11-04 »
fn parse_date(s: &str) -> Option<String> {
    let c = Regex::new(r"(\d{1,2})/([A-Za-z]+)/(\d{4})").unwrap().captures(s)?;
    const MONTHS: [&str; 12] = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    let m = MONTHS.iter().position(|n| *n == c[2].to_lowercase())? + 1;
    Some(format!("{}-{:02}-{:02}", &c[3], m, c[1].parse::<u32>().ok()?))
}

/// Classement des cônes de la section « Best Light Cones » ; `None` si la section ou la date manque,
/// ou si aucun cône n'y est lisible. `fetched_at` et `stale` sont remplis par l'appelant.
pub fn parse_ranking(html: &str) -> Option<Ranking> {
    let updated = parse_date(Regex::new(r"Last updated:\s*(?:<[^>]*>)*\s*([^<]+)").unwrap().captures(html)?.get(1)?.as_str())?;
    let start = html.find("Best Light Cones")?;
    let rest = &html[start..];
    let section = &rest[..rest.find("<h2").unwrap_or(rest.len())];
    let pct = Regex::new(r#"class="percentage"><p>\s*([0-9.]+)\s*%"#).unwrap();
    let name = Regex::new(r#"class="hsr-set-name[^"]*">([^<]+)</span>"#).unwrap();
    let sup = Regex::new(r#"class="cone-super">\(S(?:<!-- -->)*\s*(\d)"#).unwrap();
    let mut cones = Vec::new();
    // chaque entrée commence par `class="single-cone <Élément>"`
    for chunk in section.split("class=\"single-cone").skip(1) {
        let (Some(n), Some(s)) = (name.captures(chunk), sup.captures(chunk)) else { continue };
        cones.push(RankedCone {
            name: unescape(&n[1]),
            rank: cones.len() as u32 + 1,
            score: pct.captures(chunk).and_then(|p| p[1].parse().ok()),
            sup: s[1].parse().ok()?,
        });
    }
    if cones.is_empty() {
        return None;
    }
    Some(Ranking { updated, fetched_at: 0, stale: false, cones })
}

/// Persos de la page « characters » : (nom affiché, adresse). L'adresse vient du lien de la fiche, jamais du nom.
pub fn parse_character_list(html: &str) -> Vec<(String, String)> {
    let link = Regex::new(r#"(?s)<a href="/star-rail/characters/([a-z0-9-]+)"[^>]*>(.*?)</a>"#).unwrap();
    let name = Regex::new(r#"class="emp-name">([^<]+)"#).unwrap();
    let mut out: Vec<(String, String)> = Vec::new();
    for c in link.captures_iter(html) {
        let Some(n) = name.captures(&c[2]) else { continue };
        let entry = (unescape(&n[1]), c[1].to_string());
        if !out.contains(&entry) {
            out.push(entry);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/prydwen").join(name)).unwrap()
    }

    #[test]
    fn parse_acheron_ranking() {
        let r = parse_ranking(&fixture("acheron.html")).unwrap();
        assert_eq!(r.updated, "2026-11-04");
        assert_eq!(r.cones.len(), 4);
        assert_eq!(r.cones[0], RankedCone { name: "Along the Passing Shore".into(), rank: 1, score: Some(125.5), sup: 1 });
        assert_eq!(r.cones[2].name, "Good Night and Sleep Well");
        assert_eq!(r.cones[2].sup, 5);
        assert_eq!(r.cones[3].rank, 4);
    }

    #[test]
    fn parse_unknown_structure_yields_none() {
        assert_eq!(parse_ranking("<html><body>Bonjour</body></html>"), None);
        // section présente mais sans date
        assert_eq!(parse_ranking("<h2>Best Light Cones</h2>"), None);
    }

    #[test]
    fn slug_from_character_list() {
        let list = parse_character_list(&fixture("characters.html"));
        let slug = |n: &str| list.iter().find(|(name, _)| name == n).map(|(_, s)| s.as_str());
        assert_eq!(slug("Acheron"), Some("acheron"));
        assert_eq!(slug("Dan Heng • Permansor Terrae"), Some("dan-heng-permansor-terrae"));
    }
}
