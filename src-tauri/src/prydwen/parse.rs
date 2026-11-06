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
    /// Conseils de reliques de la même page (absent des caches d'avant les reliques)
    #[serde(default)]
    pub relics: Option<RelicAdvice>,
    /// Version de la lecture qui a produit ce classement (0 : avant les reliques)
    #[serde(default)]
    pub format: u32,
}

/// Version de la lecture de la page : 1 = conseils de reliques, 2 = stats visées.
/// Un cache plus ancien est redemandé une fois (voir `ranking_with`).
pub const FORMAT: u32 = 2;

/// Un set d'une entrée conseillée et son nombre de pièces (4, ou 2)
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct SetPick {
    pub name: String,
    pub pieces: u8,
}

/// Conseils de reliques d'un perso : noms, ordre et stats seulement.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct RelicAdvice {
    /// « Best Relic Sets » dans l'ordre : 1 set (4 pièces), 2 sets (2 + 2) ou 1 set 2 pièces + « Flex »
    pub sets: Vec<Vec<SetPick>>,
    /// Bonus 2 pièces à combiner (« mix and match »)
    pub flex: Vec<String>,
    /// « Best Planetary Sets » dans l'ordre
    pub planars: Vec<String>,
    /// body / feet / sphere / rope → clés de stats de l'app, dans l'ordre de Prydwen
    pub main: std::collections::BTreeMap<String, Vec<String>>,
    /// « Recommended endgame stats » (absent des caches d'avant leur lecture)
    #[serde(default)]
    pub targets: Vec<StatTarget>,
}

/// Stat visée : clé de stat totale de l'app (`hp`, `atk`, `spd`, `cr`…), plus petite valeur de la ligne
/// (ratio pour les pourcentages : 0.8 = 80 %) et les valeurs telles qu'affichées (« 80-90%+ »).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct StatTarget {
    pub key: String,
    pub min: f64,
    pub text: String,
}

/// Ligne de « Recommended endgame stats » → stat visée (`None` si la stat ou la valeur est illisible)
fn stat_target(label: &str, value: &str) -> Option<StatTarget> {
    let key = match unescape(label).to_lowercase().trim() {
        "hp" => "hp".to_string(),
        "atk" => "atk".to_string(),
        "def" => "def".to_string(),
        "effect res" | "effect resistance" => "res".to_string(),
        other => stat_key(other).filter(|k| !k.ends_with("_pct"))?,
    };
    let text = unescape(value);
    let first: f64 = Regex::new(r"\d+(?:\.\d+)?").unwrap().find(&text)?.as_str().parse().ok()?;
    let pct = text.contains('%') || ["cr", "cd", "be", "ehr", "res", "err", "heal"].contains(&key.as_str());
    Some(StatTarget { key, min: if pct { first / 100.0 } else { first }, text })
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
    Some(Ranking { updated, fetched_at: 0, stale: false, cones, relics: parse_relics(html), format: FORMAT })
}

/// Stat principale de Prydwen → clé de l'app (`None` si inconnue)
fn stat_key(label: &str) -> Option<String> {
    let l = unescape(label).to_lowercase();
    let k = match l.trim() {
        "crit rate" => "cr",
        "crit dmg" => "cd",
        "atk%" | "atk" => "atk_pct",
        "hp%" | "hp" => "hp_pct",
        "def%" | "def" => "def_pct",
        "speed" | "spd" => "spd",
        "break effect" => "be",
        "energy regen rate" | "energy regeneration rate" | "err" => "err",
        "outgoing healing" | "outgoing healing boost" | "healing bonus" => "heal",
        "effect hit rate" | "ehr" => "ehr",
        other => {
            let el = other.strip_suffix(" dmg")?;
            return ["physical", "fire", "ice", "lightning", "wind", "quantum", "imaginary"]
                .contains(&el).then(|| format!("dmg_{el}"));
        }
    };
    Some(k.to_string())
}

/// Conseils de reliques : sets, sets planaires et stats principales. `None` si aucune de ces parties n'est lisible.
pub fn parse_relics(html: &str) -> Option<RelicAdvice> {
    let set = Regex::new(r#"class="hsr-set-name[^"]*">([^<]+)(?:<!-- -->)?\s*<span>\((?:<!-- -->)?(\d)(?:<!-- -->)?-PC\)"#).unwrap();
    let after = |from: &str| html.find(from).map(|i| &html[i..]);
    let mut advice = RelicAdvice::default();
    if let Some(rest) = after("Best Relic Sets") {
        let end = ["Best Planetary Sets", "<h2"].iter().filter_map(|m| rest[20..].find(m).map(|i| i + 20)).min().unwrap_or(rest.len());
        let section = &rest[..end];
        for chunk in section.split("class=\"single-cone").skip(1) {
            // la liste « mix and match » suit la dernière entrée : on ne lit les sets qu'avant elle
            let head = &chunk[..chunk.find("class=\"information").unwrap_or(chunk.len())];
            let picks: Vec<SetPick> = set.captures_iter(head)
                .filter_map(|c| Some(SetPick { name: unescape(&c[1]), pieces: c[2].parse().ok()? })).collect();
            if !picks.is_empty() {
                advice.sets.push(picks);
            }
        }
        if let Some(i) = section.find("mix and match") {
            let name = Regex::new(r#"class="hsr-name"><span>([^<]+)</span>"#).unwrap();
            advice.flex = name.captures_iter(&section[i..]).map(|c| unescape(&c[1])).collect();
        }
    }
    if let Some(rest) = after("Best Planetary Sets") {
        let section = &rest[..rest.find("class=\"build-stats").or_else(|| rest.find("<h2")).unwrap_or(rest.len())];
        advice.planars = set.captures_iter(section).map(|c| unescape(&c[1])).collect();
    }
    if let Some(rest) = after("Best Stats") {
        let section = &rest[..rest.find("Substats").unwrap_or(rest.len())];
        let header = Regex::new(r#"class="stats-header"><span>([^<]+)</span>"#).unwrap();
        // l'icône de la stat (`<img …/>`) précède parfois son nom
        let stat = Regex::new(r#"class="hsr-stat">(?:<img[^>]*>)?<span[^>]*>([^<]+)</span>"#).unwrap();
        let heads: Vec<_> = header.captures_iter(section).collect();
        for (i, h) in heads.iter().enumerate() {
            let slot = match h[1].trim() {
                "Body" => "body",
                "Feet" => "feet",
                "Planar Sphere" => "sphere",
                "Link Rope" => "rope",
                _ => continue,
            };
            let stop = heads.get(i + 1).map_or(section.len(), |n| n.get(0).unwrap().start());
            let mut keys: Vec<String> = Vec::new();
            for c in stat.captures_iter(&section[h.get(0).unwrap().end()..stop]) {
                if let Some(k) = stat_key(&c[1]).filter(|k| !keys.contains(k)) {
                    keys.push(k);
                }
            }
            if !keys.is_empty() {
                advice.main.insert(slot.to_string(), keys);
            }
        }
    }
    if let Some(rest) = after("Recommended endgame stats") {
        let section = &rest[..rest.find("</ul>").unwrap_or(rest.len())];
        let line = Regex::new(r"<li><p>([^<:]+):\s*<b>([^<]+)</b>").unwrap();
        advice.targets = line.captures_iter(section).filter_map(|c| stat_target(&c[1], &c[2])).collect();
    }
    (!advice.sets.is_empty() || !advice.planars.is_empty() || !advice.main.is_empty()).then_some(advice)
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
    fn parse_acheron_relics() {
        let a = parse_ranking(&fixture("acheron.html")).unwrap().relics.unwrap();
        let pick = |n: &str, p: u8| SetPick { name: n.into(), pieces: p };
        assert_eq!(a.sets[0], vec![pick("Pioneer Diver of Dead Waters", 4)]);
        assert_eq!(a.sets[1], vec![pick("Scholar Lost in Erudition", 4)]);
        assert_eq!(a.sets.last().unwrap(), &vec![pick("Scholar Lost in Erudition", 2)]);
        assert_eq!(a.sets.len(), 4);
        assert_eq!(a.flex.len(), 5);
        assert_eq!(a.flex[0], "Pioneer Diver of Dead Waters");
        assert_eq!(a.planars[0], "Izumo Gensei and Takama Divine Realm");
        assert_eq!(a.planars.len(), 4);
        assert_eq!(a.planars[3], "Firmament Frontline: Glamoth");
        let main = |s: &str| a.main[s].iter().map(String::as_str).collect::<Vec<_>>();
        assert_eq!(main("body"), ["cr", "cd"]);
        assert_eq!(main("feet"), ["atk_pct", "spd"]);
        assert_eq!(main("sphere"), ["atk_pct", "dmg_lightning"]);
        assert_eq!(main("rope"), ["atk_pct"]);
        // HP 2800-3000+, DEF 800+, ATK 2900-3200+, CRIT RATE 80-90%+, CRIT DMG 160-180%+, SPD 101 or 134+
        let t: Vec<(&str, f64)> = a.targets.iter().map(|t| (t.key.as_str(), t.min)).collect();
        assert_eq!(t, [("hp", 2800.0), ("def", 800.0), ("atk", 2900.0), ("cr", 0.8), ("cd", 1.6), ("spd", 101.0)]);
        assert_eq!(a.targets[3].text, "80-90%+");
    }

    #[test]
    fn relics_absent_or_unknown_stats() {
        assert_eq!(parse_relics("<html>rien</html>"), None);
        assert_eq!(stat_key("Lightning DMG").as_deref(), Some("dmg_lightning"));
        assert_eq!(stat_key("Energy Regen Rate").as_deref(), Some("err"));
        assert_eq!(stat_key("Something new"), None);
        assert_eq!(stat_key("Shadow DMG"), None);
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
