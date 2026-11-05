//! Analyse des annonces officielles HoYoLAB (fonctions pures, testées sur des posts réels enregistrés
//! dans tests/fixtures/hoyolab). Les posts sont reconnus par leur titre anglais, puis lus dans la
//! langue de l'app (français ou anglais).

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PostKind {
    PatchNotes { version: String, name: String },
    Warp { version: String, phase: u8 },
    VersionAnnounce { version: String, name: Option<String> },
    CharacterPreview,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteItem {
    pub title: String,
    pub text: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteSection {
    pub title: String,
    pub items: Vec<NoteItem>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameEvent {
    pub name: String,
    pub text: String,
    pub jades: u32,
    pub passes: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reward {
    pub label: String,
    pub jades: u32,
    pub passes: u32,
}

/// Élément d'une bannière ; `kind` = "char" ou "lc" ; élément et Voie avec les clés de l'app.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WarpItem {
    pub name: String,
    pub kind: String,
    pub rarity: u8,
    pub element: Option<String>,
    pub path: Option<String>,
    pub rerun: bool,
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WarpPhase {
    pub phase: u8,
    pub start: Option<String>,
    pub end: Option<String>,
    pub items: Vec<WarpItem>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Announced {
    pub name: String,
    pub element: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PatchNote {
    pub start: Option<String>,
    pub end: Option<String>,
    pub sections: Vec<NoteSection>,
    pub events: Vec<GameEvent>,
    pub rewards: Vec<Reward>,
    pub new_items: Vec<WarpItem>,
}

/// Expression régulière compilée une seule fois
macro_rules! re {
    ($pat:expr) => {{
        static RE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| regex::Regex::new($pat).unwrap());
        &*RE
    }};
}

/// Reconnaît un post utile à partir de son titre anglais (les titres anglais sont les plus réguliers).
pub fn classify(title_en: &str) -> Option<PostKind> {
    let t = title_en.trim();
    // le passe de combat (« Version 4.6 "Nameless Honor" Update ») a la forme d'un ancien patch note
    if t.contains("\"Nameless Honor\"") {
        return None;
    }
    let caps = |re: &regex::Regex| re.captures(t);
    // patch notes : « Version 4.6 "…" Update Details », et les anciens « Version 3.7 "…" Update » / « "…" Version 3.8 Update »
    if let Some(c) = caps(re!(r#"^Version (\d+\.\d+) "(.+)" Update(?: Details)?$"#)) {
        return Some(PostKind::PatchNotes { version: c[1].into(), name: c[2].into() });
    }
    if let Some(c) = caps(re!(r#"^"(.+)" Version (\d+\.\d+) Update(?: Details)?$"#)) {
        return Some(PostKind::PatchNotes { version: c[2].into(), name: c[1].into() });
    }
    // bannières : « Event Warp: Phase II », et les anciens « Event Warp: Part I » / « Event Warp (II) »
    if let Some(c) = caps(re!(r"^Version (\d+\.\d+) Event Warp(?:: (?:Phase|Part) (I{1,3})| \((I{1,3})\))$")) {
        let phase = c.get(2).or(c.get(3)).map_or(1, |m| m.as_str().len() as u8);
        return Some(PostKind::Warp { version: c[1].into(), phase });
    }
    let announce = |version: &str, name: Option<&str>| {
        Some(PostKind::VersionAnnounce { version: version.into(), name: name.map(str::to_string) })
    };
    if let Some(c) = caps(re!(r#"Version (\d+\.\d+) "(.+)" Special Program$"#)) {
        return announce(&c[1], Some(&c[2]));
    }
    if let Some(c) = caps(re!(r#"^Version (\d+\.\d+) Trailer: "(.+?)""#)) {
        return announce(&c[1], Some(&c[2]));
    }
    if let Some(c) = caps(re!(r#"^"(.+)" Version (\d+\.\d+) Preview$"#)) {
        return announce(&c[2], Some(&c[1]));
    }
    if let Some(c) = caps(re!(r#"^Light Cone Preview \| Version (\d+\.\d+) "(.+)"$"#)) {
        return announce(&c[1], Some(&c[2]));
    }
    if let Some(c) = caps(re!(r#"^Version (\d+\.\d+) "(.+)" Highlights Page"#)) {
        return announce(&c[1], Some(&c[2]));
    }
    if let Some(c) = caps(re!(r"^A Brief on the Version (\d+\.\d+) Special Program$")) {
        return announce(&c[1], None);
    }
    if re!(r"Preview \| .+★|Character Trailer:").is_match(t) {
        return Some(PostKind::CharacterPreview);
    }
    None
}

fn decode_entities(s: &str) -> String {
    let s = s.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'");
    let s = re!(r"&#(\d+);").replace_all(&s, |c: &regex::Captures| {
        char::from_u32(c[1].parse().unwrap_or(32)).unwrap_or(' ').to_string()
    });
    s.replace("&amp;", "&")
}

/// Texte d'un post, ligne par ligne : HTML de « content » ou, quand « content » n'en contient pas
/// (certains posts n'y mettent que le code de langue), les « insert » de « structured_content ».
pub fn post_lines(post: &Value) -> Vec<String> {
    let content = post["content"].as_str().unwrap_or_default();
    let text: String = if re!(r"<[a-zA-Z]").is_match(content) {
        let t = re!(r"(?i)<br\s*/?>|</(p|div|h\d|li)>").replace_all(content, "\n");
        decode_entities(&re!(r"<[^>]+>").replace_all(&t, ""))
    } else {
        let ops: Value = serde_json::from_str(post["structured_content"].as_str().unwrap_or("[]")).unwrap_or(Value::Null);
        ops.as_array().into_iter().flatten().map(|op| op["insert"].as_str().unwrap_or("\n")).collect()
    };
    text.replace('\u{a0}', " ").lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect()
}

/// Date trouvée dans un texte : année, mois, jour, heure:minute éventuelle
type Date = (String, String, String, Option<String>);

/// Dates d'un texte, dans l'ordre. Formats : 2026/09/28 [06:00] et 28/09/2026.
fn dates(s: &str) -> Vec<Date> {
    re!(r"(\d{4})/(\d{2})/(\d{2})(?: (\d{2}:\d{2}))?|(\d{2})/(\d{2})/(\d{4})").captures_iter(s).map(|c| match c.get(1) {
        Some(y) => (y.as_str().into(), c[2].into(), c[3].into(), c.get(4).map(|m| m.as_str().to_string())),
        None => (c[7].into(), c[6].into(), c[5].into(), None),
    }).collect()
}
fn iso_day(d: &Date) -> String {
    format!("{}-{}-{}", d.0, d.1, d.2)
}
/// Les dates des patch notes sont en UTC+8
fn iso_utc8(d: &Date) -> String {
    format!("{}T{}:00+08:00", iso_day(d), d.3.as_deref().unwrap_or("00:00"))
}

fn amount(re: &regex::Regex, line: &str) -> u32 {
    re.captures_iter(line)
        .filter_map(|c| c[1].chars().filter(char::is_ascii_digit).collect::<String>().parse::<u32>().ok())
        .sum()
}
/// Jades stellaires gagnés dans une ligne (« jade stellaire ×300 ») ; un prix (« 2 680 jades ») ne compte pas.
fn jades_in(line: &str) -> u32 {
    amount(re!(r"(?i)(?:jade stellaire|stellar jade)\s*×\s*(\d[\d  .,]*\d|\d)"), line)
}
/// Passes stellaires spéciaux (vœux sur les bannières limitées)
fn passes_in(line: &str) -> u32 {
    amount(re!(r"(?i)(?:passe? stellaire spécial|pass spécial du star rail|star rail special pass)\s*×\s*(\d+)"), line)
}

/// Voie (clé de l'app) à partir de son nom français ou anglais
fn path_key(s: &str) -> Option<String> {
    let s = re!(r"(?i)^\s*(la |le |l'|l’|the )").replace(s, "");
    let k = match crate::gamedata::norm(&s).as_str() {
        "destruction" => "destruction",
        "chasse" | "hunt" => "hunt",
        "erudition" => "erudition",
        "harmonie" | "harmony" => "harmony",
        "nihilite" | "nihility" => "nihility",
        "preservation" => "preservation",
        "abondance" | "abundance" => "abundance",
        "souvenir" | "remembrance" => "remembrance",
        "allegresse" | "elation" => "elation",
        _ => return None,
    };
    Some(k.into())
}
/// Élément (clé de l'app) à partir de son nom français ou anglais
fn element_key(s: &str) -> Option<String> {
    let k = match crate::gamedata::norm(s).as_str() {
        "physique" | "physical" => "physical",
        "feu" | "fire" => "fire",
        "glace" | "ice" => "ice",
        "foudre" | "lightning" => "lightning",
        "vent" | "wind" => "wind",
        "quantique" | "quantum" => "quantum",
        "imaginaire" | "imaginary" => "imaginary",
        _ => return None,
    };
    Some(k.into())
}
/// « Voie : élément » ou « Voie » (contenu des parenthèses d'un perso ou d'un cône)
fn path_element(paren: &str) -> (Option<String>, Option<String>) {
    match paren.split_once(':') {
        Some((p, e)) => (path_key(p), element_key(e)),
        None => (path_key(paren), None),
    }
}

/// Patch note : sections (« ▌ » et « N. »), entrées (« ■ »), dates de la version, événements,
/// gains explicites (jades, passes) et nouveaux persos / cônes.
pub fn parse_patch_note(lines: &[String]) -> PatchNote {
    let mut p = PatchNote::default();
    let mut sections: Vec<NoteSection> = Vec::new();
    for l in lines {
        if p.start.is_none() && re!(r"(?i)commencera le|begins at").is_match(l) {
            p.start = dates(l).first().map(iso_utc8);
        }
        if p.end.is_none() && re!(r"(?i)durée de la version|will run from").is_match(l) {
            p.end = dates(l).last().map(iso_utc8);
        }
        if let Some(title) = l.strip_prefix('▌') {
            sections.push(NoteSection { title: title.trim().into(), items: vec![] });
            continue;
        }
        if re!(r"^\d+\.\s").is_match(l) {
            sections.push(NoteSection { title: l.clone(), items: vec![] });
            continue;
        }
        if sections.is_empty() {
            sections.push(NoteSection::default());
        }
        let sec = sections.last_mut().unwrap();
        if let Some(title) = l.strip_prefix('■') {
            sec.items.push(NoteItem { title: title.trim().into(), text: String::new() });
            continue;
        }
        if sec.items.is_empty() {
            sec.items.push(NoteItem::default());
        }
        let item = sec.items.last_mut().unwrap();
        if !item.text.is_empty() {
            item.text.push('\n');
        }
        item.text.push_str(l);
    }
    for sec in &sections {
        let is_events = re!(r"(?i)^\d+\.\s*(nouveaux? événements?|new events?)$").is_match(&sec.title);
        let new_kind = if re!(r"(?i)^\d+\.\s*(nouveaux? personnages?|new characters?)$").is_match(&sec.title) {
            Some("char")
        } else if re!(r"(?i)^\d+\.\s*(nouveaux? cônes? de lumière|new light cones?)$").is_match(&sec.title) {
            Some("lc")
        } else {
            None
        };
        for item in &sec.items {
            let all = format!("{}\n{}", item.title, item.text);
            let (jades, passes) = all.lines().fold((0, 0), |(j, ps), l| (j + jades_in(l), ps + passes_in(l)));
            if is_events {
                p.events.push(GameEvent { name: item.title.clone(), text: item.text.clone(), jades, passes });
            } else if jades > 0 || passes > 0 {
                let label = if item.title.is_empty() { sec.title.clone() } else { item.title.clone() };
                p.rewards.push(Reward { label, jades, passes });
            }
            let Some(kind) = new_kind else { continue };
            let c = re!(r"(?i)^(?:personnage |cône de lumière )?(\d) étoiles (.+?) \(([^()]+)\)$").captures(&item.title)
                .or_else(|| re!(r"(?i)^(\d)-Star (.+?) \(([^()]+)\)$").captures(&item.title));
            if let Some(c) = c {
                let (path, element) = path_element(&c[3]);
                p.new_items.push(WarpItem {
                    name: c[2].trim().into(), kind: kind.into(), rarity: c[1].parse().unwrap_or(0),
                    element, path, ..Default::default()
                });
            }
        }
    }
    p.sections = sections.into_iter().filter(|s| !s.title.is_empty() || !s.items.is_empty()).collect();
    p
}

/// Nom nettoyé d'un élément de bannière (« et Micha » → « Micha »)
fn clean_name(s: &str) -> String {
    let s = s.trim().trim_matches(',').trim();
    // pas « the » ni « le » : ils font partie de certains noms (The Dahlia, Le Dahlia)
    re!(r"(?i)^(?:(?:et|and|ainsi que|as well as)\s+)+").replace(s, "").trim().to_string()
}

/// Ajoute les persos et cônes cités dans `text` (« personnage 5 étoiles exclusif X (Voie : élément) et les
/// personnages 4 étoiles … »). Un élément déjà présent (même nom, même type) n'est pas repris, mais il
/// devient un rerun si cette mention-ci l'indique. `dates` : début et fin, quand le post les donne.
fn collect_warp_items(text: &str, rerun: bool, dates: Option<(&Date, &Date)>, items: &mut Vec<WarpItem>) {
    let markers: Vec<_> = re!(r"(?i)(personnages?|cônes? de lumière) (\d) étoiles(?: exclusifs?)?|(\d)-star (characters?|light cones?)")
        .captures_iter(text).collect();
    for (i, m) in markers.iter().enumerate() {
        let (kind, rarity): (&str, u8) = match (m.get(1), m.get(3)) {
            (Some(k), _) => (if k.as_str().to_lowercase().starts_with("personnage") { "char" } else { "lc" }, m[2].parse().unwrap_or(0)),
            (_, Some(r)) => (if m[4].to_lowercase().starts_with("character") { "char" } else { "lc" }, r.as_str().parse().unwrap_or(0)),
            _ => continue,
        };
        let stop = markers.get(i + 1).map_or(text.len(), |n| n.get(0).unwrap().start());
        let mut seg = &text[m.get(0).unwrap().end()..stop];
        // fin de phrase (« Niv. 999 » ou « LV.999 » dans un nom ne coupent pas)
        if let Some(cut) = re!(r" seront | will |\.\s+[A-ZÀ-ÖØ-Þ]|\.$").find(seg) {
            seg = &seg[..cut.start()];
        }
        let found: Vec<(String, String)> = if seg.contains('"') {
            re!(r#""([^"]+?) \(([^()]+)\),?""#).captures_iter(seg).map(|c| (c[1].to_string(), c[2].to_string())).collect()
        } else {
            re!(r"([^,()]+?) \(([^()]+)\)").captures_iter(seg).map(|c| (c[1].to_string(), c[2].to_string())).collect()
        };
        for (name, paren) in found {
            let name = clean_name(&name);
            if name.is_empty() {
                continue;
            }
            if let Some(existing) = items.iter_mut().find(|it| it.name == name && it.kind == kind) {
                existing.rerun |= rerun;
                continue;
            }
            let (path, element) = path_element(&paren);
            items.push(WarpItem {
                name, kind: kind.into(), rarity, element, path, rerun,
                start: dates.map(|d| iso_day(d.0)), end: dates.map(|d| iso_day(d.1)),
            });
        }
    }
}

/// Bannières d'une annonce « Sauts événements ». Les formats ont varié selon les versions :
/// - les paragraphes d'introduction (avant le premier « ▌ ») listent les persos et cônes avec leurs dates ;
///   « seront de retour » / « will return » = rerun ;
/// - les persos sont dans les lignes « ● » des sections « ▌ » ; les dates viennent de l'introduction ou d'un
///   titre de section daté (« ▌ Durée des Sauts hyperespaces : … »), et parfois d'aucun des deux ;
///   une section « Résurgence du passé », « Figures indélébiles » (ou leurs titres anglais) = reruns.
pub fn parse_warp(lines: &[String], phase: u8) -> WarpPhase {
    let mut items: Vec<WarpItem> = Vec::new();
    let intro: Vec<&String> = lines.iter().take_while(|l| !l.starts_with('▌')).collect();
    for para in &intro {
        let ds = dates(para);
        if let (Some(first), Some(last)) = (ds.first(), ds.last()) {
            let rerun = re!(r"(?i)seront de retour|will return").is_match(para);
            collect_warp_items(para, rerun, Some((first, last)), &mut items);
        }
    }
    let mut span: Vec<Date> = intro.iter().flat_map(|p| dates(p)).collect();
    let mut rerun = false;
    for l in &lines[intro.len()..] {
        if let Some(title) = l.strip_prefix('▌') {
            // fin des bannières : règles détaillées, événement d'essai…
            if re!(r"(?i)règles|details|essai|trial").is_match(title) {
                break;
            }
            let ds = dates(title);
            if !ds.is_empty() {
                span = ds;
            }
            rerun = re!(r"(?i)résurgence du passé|bygone reminiscence|figures indélébiles|indelible coterie").is_match(title);
        } else if l.starts_with('●') {
            let range = span.first().zip(span.last());
            collect_warp_items(l, rerun, range, &mut items);
        }
    }
    let start = items.iter().filter_map(|i| i.start.clone()).min();
    let end = items.iter().filter_map(|i| i.end.clone()).max();
    WarpPhase { phase, start, end, items }
}

/// Persos présentés dans un post « Preview | X ★ Y » : nom suivi de « (Voie : élément) ».
pub fn parse_announced(lines: &[String]) -> Vec<Announced> {
    let mut out: Vec<Announced> = Vec::new();
    for l in lines {
        for c in re!(r"([^,!?.:(]+?) \(([^():]+?)\s?:\s?([^()]+?)\)").captures_iter(l) {
            let (Some(path), Some(element)) = (path_key(&c[2]), element_key(&c[3])) else { continue };
            let raw = c[1].trim();
            let name = [" sur ", " for the ", " for "].iter().find_map(|sep| raw.rsplit_once(sep).map(|(_, n)| n)).unwrap_or(raw).trim();
            if !name.is_empty() && !out.iter().any(|a| a.name == name) {
                out.push(Announced { name: name.into(), element: Some(element), path: Some(path) });
            }
        }
    }
    out
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Post enregistré (réponse getPostFull complète) : `fixture("46861607.fr-fr")`
    pub fn fixture(name: &str) -> Value {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/hoyolab").join(format!("{name}.json"));
        let v: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
        v["data"]["post"]["post"].clone()
    }
    fn lines(name: &str) -> Vec<String> {
        post_lines(&fixture(name))
    }
    fn find<'a>(items: &'a [WarpItem], name: &str) -> &'a WarpItem {
        items.iter().find(|i| i.name == name).unwrap_or_else(|| panic!("{name} absent de {:?}", items.iter().map(|i| &i.name).collect::<Vec<_>>()))
    }

    #[test]
    fn classify_known_titles() {
        assert_eq!(classify(r#"Version 4.6 "Dance With the Beast Before Moonrise" Update Details"#),
            Some(PostKind::PatchNotes { version: "4.6".into(), name: "Dance With the Beast Before Moonrise".into() }));
        assert_eq!(classify("Version 4.6 Event Warp: Phase II"), Some(PostKind::Warp { version: "4.6".into(), phase: 2 }));
        assert_eq!(classify("Version 4.5 Event Warp: Phase I"), Some(PostKind::Warp { version: "4.5".into(), phase: 1 }));
        assert_eq!(classify(r#"Honkai: Star Rail Version 4.7 "Now, Lay Laughter to All Stars" Special Program"#),
            Some(PostKind::VersionAnnounce { version: "4.7".into(), name: Some("Now, Lay Laughter to All Stars".into()) }));
        assert_eq!(classify(r#""Dance With the Beast Before Moonrise" Version 4.6 Preview"#),
            Some(PostKind::VersionAnnounce { version: "4.6".into(), name: Some("Dance With the Beast Before Moonrise".into()) }));
        assert!(matches!(classify(r#"Light Cone Preview | Version 4.7 "Now, Lay Laughter to All Stars""#), Some(PostKind::VersionAnnounce { .. })));
        assert!(matches!(classify(r#"Version 4.7 Trailer: "Now, Lay Laughter to All Stars" | Honkai: Star Rail"#), Some(PostKind::VersionAnnounce { .. })));
        assert_eq!(classify("Aeon Preview | Aeon ★ Aha"), Some(PostKind::CharacterPreview));
        assert_eq!(classify(r#"Pearl Character Trailer: "The Way to Paint a Form of Hope" | Honkai: Star Rail"#), Some(PostKind::CharacterPreview));
        // anciens formats de titres (versions 3.x)
        assert_eq!(classify(r#"Version 3.7 "As Tomorrow Became Yesterday" Update"#),
            Some(PostKind::PatchNotes { version: "3.7".into(), name: "As Tomorrow Became Yesterday".into() }));
        assert_eq!(classify(r#""Memories are the Prelude to Dreams" Version 3.8 Update"#),
            Some(PostKind::PatchNotes { version: "3.8".into(), name: "Memories are the Prelude to Dreams".into() }));
        assert_eq!(classify("Version 3.4 Event Warp (II)"), Some(PostKind::Warp { version: "3.4".into(), phase: 2 }));
        assert_eq!(classify("Version 3.3 Event Warp: Part I"), Some(PostKind::Warp { version: "3.3".into(), phase: 1 }));
        assert_eq!(classify("Version 3.8 Event Warp: Phase III"), Some(PostKind::Warp { version: "3.8".into(), phase: 3 }));
        assert_eq!(classify("Version 3.8 Nameless Honor & Store Update"), None);
        // le passe de combat a la même forme qu'un ancien patch note
        assert_eq!(classify(r#"Version 4.6 "Nameless Honor" Update"#), None);
        assert_eq!(classify("Version 4.7 Store Update"), None);
        assert_eq!(classify("Version 4.6 Update and Maintenance Notice"), None);
    }

    #[test]
    fn lines_from_html_content() {
        let l = lines("46861607.fr-fr");
        assert!(l.iter().any(|x| x == "2. Nouveau personnage"));
        assert!(l.iter().all(|x| !x.contains('<') && !x.trim().is_empty()));
    }

    #[test]
    fn lines_from_structured_content_when_content_is_lang_code() {
        assert_eq!(fixture("46851682.en-us")["content"], "en-us");
        let l = lines("46851682.en-us");
        assert!(l.iter().any(|x| x.contains("Pearl (Elation: Ice)")));
    }

    #[test]
    fn patch_note_46_fr() {
        let p = parse_patch_note(&lines("46861607.fr-fr"));
        assert_eq!(p.start.as_deref(), Some("2026-09-28T06:00:00+08:00"));
        assert_eq!(p.end.as_deref(), Some("2026-11-11T06:00:00+08:00"));
        assert_eq!(p.events.len(), 8);
        assert_eq!(p.events[0].name, "Amour, Fantômes et Robots");
        assert!(p.events.iter().any(|e| e.jades == 500));
        assert!(p.sections.iter().any(|s| s.title == "2. Nouveau personnage"));
        let perle = find(&p.new_items, "Perle");
        assert_eq!((perle.kind.as_str(), perle.rarity), ("char", 5));
        assert_eq!((perle.element.as_deref(), perle.path.as_deref()), (Some("ice"), Some("elation")));
        let lc = find(&p.new_items, "Couleurs dédiées au lendemain");
        assert_eq!((lc.kind.as_str(), lc.rarity, lc.path.as_deref()), ("lc", 5, Some("elation")));
    }

    #[test]
    fn patch_note_46_en_same_structure() {
        let p = parse_patch_note(&lines("46861607.en-us"));
        assert_eq!(p.start.as_deref(), Some("2026-09-28T06:00:00+08:00"));
        assert_eq!(p.end.as_deref(), Some("2026-11-11T06:00:00+08:00"));
        assert_eq!(p.events.len(), 8);
        assert_eq!(p.events[0].name, "Love, Ghosts & Robots");
        let pearl = find(&p.new_items, "Pearl");
        assert_eq!((pearl.element.as_deref(), pearl.path.as_deref()), (Some("ice"), Some("elation")));
    }

    #[test]
    fn patch_note_45_plural_sections() {
        let p = parse_patch_note(&lines("46449452.fr-fr"));
        assert_eq!(p.start.as_deref(), Some("2026-08-26T06:00:00+08:00"));
        assert_eq!(p.end.as_deref(), Some("2026-09-28T06:00:00+08:00"));
        assert!(p.new_items.iter().filter(|i| i.kind == "char").count() >= 2, "{:?}", p.new_items);
        assert!(p.new_items.iter().any(|i| i.kind == "lc"));
        assert!(!p.events.is_empty());
        assert!(p.events.iter().any(|e| e.passes == 10));
    }

    #[test]
    fn rewards_ignore_prices_and_keep_each_compensation_line() {
        for name in ["46861607.en-us", "46861607.fr-fr"] {
            let p = parse_patch_note(&lines(name));
            // 2 compensations de 300, et pas les 2 680 jades du prix d'une tenue
            assert_eq!(p.rewards.iter().map(|r| r.jades).sum::<u32>(), 600, "{name}");
            // connexion 7 jours : Passe stellaire spécial ×10 ; événement à 500 jades
            assert!(p.events.iter().any(|e| e.passes == 10), "{name}");
            assert_eq!(p.events.iter().map(|e| e.jades).sum::<u32>(), 500, "{name}");
        }
    }

    #[test]
    fn warp_46_phase1_fr() {
        let w = parse_warp(&lines("46851682.fr-fr"), 1);
        let perle = find(&w.items, "Perle");
        assert_eq!((perle.kind.as_str(), perle.rarity, perle.rerun), ("char", 5, false));
        assert_eq!((perle.start.as_deref(), perle.end.as_deref()), (Some("2026-09-28"), Some("2026-11-10")));
        let eva = find(&w.items, "Evanescia");
        assert!(eva.rerun);
        assert_eq!(eva.end.as_deref(), Some("2026-10-21"));
        let q = find(&w.items, "Qingque");
        assert_eq!((q.rarity, q.element.as_deref(), q.path.as_deref()), (4, Some("quantum"), Some("erudition")));
        assert_eq!(find(&w.items, "Micha").path.as_deref(), Some("destruction"));
        let lc = find(&w.items, "Couleurs dédiées au lendemain");
        assert_eq!((lc.kind.as_str(), lc.rarity, lc.path.as_deref()), ("lc", 5, Some("elation")));
        assert_eq!(find(&w.items, "Danse endiablée").rarity, 4);
        assert_eq!(w.items.len(), 10); // 2 persos 5★ + 2 cônes 5★ + 3 persos 4★ + 3 cônes 4★
        assert_eq!((w.start.as_deref(), w.end.as_deref()), (Some("2026-09-28"), Some("2026-11-10")));
    }

    #[test]
    fn warp_46_phase1_en_same_structure() {
        let fr = parse_warp(&lines("46851682.fr-fr"), 1);
        let en = parse_warp(&lines("46851682.en-us"), 1);
        let shape = |w: &WarpPhase| w.items.iter().map(|i| (i.kind.clone(), i.rarity, i.element.clone(), i.path.clone(), i.rerun, i.start.clone(), i.end.clone())).collect::<Vec<_>>();
        assert_eq!(shape(&fr), shape(&en));
        assert!(en.items.iter().any(|i| i.name == "Colors for Tomorrow" && i.kind == "lc"));
        assert!(en.items.iter().any(|i| i.name == "Misha"));
    }

    #[test]
    fn warp_46_phase2_dates_in_iso_order() {
        let w = parse_warp(&lines("47142215.fr-fr"), 2);
        let blade = find(&w.items, "Blade Mortenax");
        assert!(blade.rerun);
        assert_eq!((blade.start.as_deref(), blade.end.as_deref()), (Some("2026-10-21"), Some("2026-11-10")));
    }

    #[test]
    fn warp_45_items_listed_in_bullet_lines() {
        for (name, robin, dan_heng) in [("46439490.fr-fr", "Robin • Estivaria", "Dan Heng"), ("46439490.en-us", "Robin • Summeretto", "Dan Heng")] {
            let w = parse_warp(&lines(name), 1);
            let r = find(&w.items, robin);
            assert_eq!((r.kind.as_str(), r.rarity, r.rerun, r.path.as_deref(), r.element.as_deref()), ("char", 5, false, Some("remembrance"), Some("wind")), "{name}");
            assert_eq!((r.start.as_deref(), r.end.as_deref()), (Some("2026-08-26"), Some("2026-09-12")), "{name}");
            assert!(find(&w.items, "Hyacine").rerun, "{name} : Hyacine est dans la section « Résurgence du passé »");
            assert_eq!(find(&w.items, dan_heng).path.as_deref(), Some("hunt"), "{name}");
            assert_eq!(w.items.iter().filter(|i| i.kind == "lc" && i.rarity == 5).count(), 2, "{name}");
            assert_eq!(w.items.len(), 10, "{name}");
        }
    }

    #[test]
    fn warp_44_without_dates_and_indelible_reruns() {
        for (name, himeko, sparxie) in [("45842578.fr-fr", "Himeko • Nova", "Sparxie"), ("45842578.en-us", "Himeko • Nova", "Sparxie")] {
            let w = parse_warp(&lines(name), 1);
            let h = find(&w.items, himeko);
            assert_eq!((h.rarity, h.rerun, h.start.as_deref()), (5, false, None), "{name} : pas de date de bannière dans ce post");
            assert!(find(&w.items, sparxie).rerun, "{name} : section « Figures indélébiles » / « Indelible Coterie »");
        }
    }

    #[test]
    fn warp_42_dates_in_section_title_and_names_with_dots() {
        let en = parse_warp(&lines("44733121.en-us"), 1);
        let sw = find(&en.items, "Silver Wolf LV.999");
        assert_eq!((sw.rarity, sw.start.as_deref(), sw.end.as_deref()), (5, Some("2026-04-22"), Some("2026-05-13")));
        assert!(find(&en.items, "The Dahlia").rerun);
        let fr = parse_warp(&lines("44733121.fr-fr"), 1);
        assert_eq!(find(&fr.items, "Louve d'argent Niv. 999").element.as_deref(), Some("imaginary"));
    }

    #[test]
    fn unknown_warp_sentence_yields_no_items() {
        assert!(parse_warp(&["Bonjour".into()], 1).items.is_empty());
    }

    #[test]
    fn announced_character_from_preview() {
        let fr = parse_announced(&lines("47307963.fr-fr"));
        assert_eq!(fr, vec![Announced { name: "Aiôn ★ Aha".into(), element: Some("quantum".into()), path: Some("elation".into()) }]);
        let en = parse_announced(&lines("47307963.en-us"));
        assert_eq!(en[0].name, "Aeon ★ Aha");
    }
}
