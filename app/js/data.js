/* =========================================================================
   HSR Companion — base de données intégrée
   -------------------------------------------------------------------------
   Les coûts EXACTS des ascensions et traces de chaque perso viennent de
   js/assets.js (données du jeu, voir src-tauri/src/gamedata).
   Les tables ASCENSION / ABILITY_COST / BASIC_COST / BONUS_TRACES ci-dessous
   ne servent qu'en repli, pour un perso personnalisé absent de ces données.
   Seule l'EXP par palier de niveau (LEVEL_EXP) reste une estimation.
   ========================================================================= */

const ELEMENTS = ['physical', 'fire', 'ice', 'lightning', 'wind', 'quantum', 'imaginary'];
const PATHS = ['destruction', 'hunt', 'erudition', 'harmony', 'nihility', 'preservation', 'abundance', 'remembrance', 'elation'];

const EL_COLORS = {
  physical: '#c8ccd6', fire: '#f26a4b', ice: '#62c8f2', lightning: '#c77df2',
  wind: '#5ad6a6', quantum: '#7c78f5', imaginary: '#f2d54a'
};

const DPS_PATHS = ['destruction', 'hunt', 'erudition'];
const SUSTAIN_PATHS = ['preservation', 'abundance'];
const SUPPORT_PATHS = ['harmony', 'nihility', 'remembrance'];

/* Profils de reliques — poids des sous-stats (1 = stat idéale) et stats principales conseillées */
const PROFILES = {
  crit_atk: { weights: { cr: 1, cd: 1, atk_pct: 0.75, spd: 0.75, atk: 0.3, be: 0.1 },
    main: { body: ['cr', 'cd'], feet: ['spd', 'atk_pct'], sphere: ['elem', 'atk_pct'], rope: ['atk_pct', 'err'] } },
  crit_hp: { weights: { cr: 1, cd: 1, hp_pct: 0.75, spd: 0.75, hp: 0.3 },
    main: { body: ['cr', 'cd'], feet: ['spd', 'hp_pct'], sphere: ['elem', 'hp_pct'], rope: ['hp_pct', 'err'] } },
  break: { weights: { be: 1, spd: 1, atk_pct: 0.5, atk: 0.2, res: 0.1 },
    main: { body: ['atk_pct'], feet: ['spd'], sphere: ['atk_pct', 'elem'], rope: ['be'] } },
  dot: { weights: { atk_pct: 1, spd: 1, ehr: 0.75, atk: 0.3, be: 0.2 },
    main: { body: ['atk_pct', 'ehr'], feet: ['spd', 'atk_pct'], sphere: ['elem', 'atk_pct'], rope: ['atk_pct', 'err'] } },
  support: { weights: { spd: 1, hp_pct: 0.5, def_pct: 0.5, res: 0.5, cd: 0.3, ehr: 0.2 },
    main: { body: ['hp_pct', 'def_pct', 'cd'], feet: ['spd'], sphere: ['hp_pct', 'def_pct'], rope: ['err', 'be'] } },
  healer: { weights: { spd: 1, hp_pct: 1, res: 0.5, hp: 0.3, def_pct: 0.3 },
    main: { body: ['heal', 'hp_pct'], feet: ['spd'], sphere: ['hp_pct'], rope: ['err', 'hp_pct'] } },
  shielder: { weights: { spd: 1, def_pct: 1, res: 0.5, def: 0.3, hp_pct: 0.3 },
    main: { body: ['def_pct'], feet: ['spd'], sphere: ['def_pct'], rope: ['err', 'def_pct'] } },
  debuffer: { weights: { spd: 1, ehr: 1, atk_pct: 0.4, res: 0.3, be: 0.3 },
    main: { body: ['ehr'], feet: ['spd'], sphere: ['hp_pct', 'def_pct', 'elem'], rope: ['err'] } }
};
const PROFILE_IDS = Object.keys(PROFILES);
const DEFAULT_PROFILE_BY_PATH = {
  destruction: 'crit_atk', hunt: 'crit_atk', erudition: 'crit_atk', remembrance: 'crit_atk', elation: 'crit_atk',
  harmony: 'support', nihility: 'debuffer', abundance: 'healer', preservation: 'shielder'
};

/* [nom EN, rareté, élément, voie, profil de reliques, nom FR optionnel] */
const CHARACTERS = [
  ['Acheron', 5, 'lightning', 'nihility', 'crit_atk'],
  ['Aglaea', 5, 'lightning', 'remembrance', 'crit_atk'],
  ['Anaxa', 5, 'wind', 'erudition', 'crit_atk'],
  ['Archer', 5, 'quantum', 'hunt', 'crit_atk'],
  ['Argenti', 5, 'physical', 'erudition', 'crit_atk'],
  ['Aventurine', 5, 'imaginary', 'preservation', 'shielder'],
  ['Bailu', 5, 'lightning', 'abundance', 'healer'],
  ['Black Swan', 5, 'wind', 'nihility', 'dot'],
  ['Blade', 5, 'wind', 'destruction', 'crit_hp'],
  ['Boothill', 5, 'physical', 'hunt', 'break'],
  ['Bronya', 5, 'wind', 'harmony', 'support'],
  ['Castorice', 5, 'quantum', 'remembrance', 'crit_hp'],
  ['Cerydra', 5, 'wind', 'harmony', 'support'],
  ['Cipher', 5, 'quantum', 'nihility', 'crit_atk'],
  ['Clara', 5, 'physical', 'destruction', 'crit_atk'],
  ['Dan Heng • Imbibitor Lunae', 5, 'imaginary', 'destruction', 'crit_atk'],
  ['Dan Heng • Permansor Terrae', 5, 'physical', 'preservation', 'shielder'],
  ['Dr. Ratio', 5, 'imaginary', 'hunt', 'crit_atk'],
  ['Evernight', 5, 'ice', 'remembrance', 'crit_hp'],
  ['Feixiao', 5, 'wind', 'hunt', 'crit_atk'],
  ['Firefly', 5, 'fire', 'destruction', 'break'],
  ['Fu Xuan', 5, 'quantum', 'preservation', 'healer'],
  ['Fugue', 5, 'fire', 'nihility', 'break'],
  ['Gepard', 5, 'ice', 'preservation', 'shielder'],
  ['Himeko', 5, 'fire', 'erudition', 'crit_atk'],
  ['Huohuo', 5, 'wind', 'abundance', 'healer'],
  ['Hyacine', 5, 'wind', 'remembrance', 'healer'],
  ['Hysilens', 5, 'physical', 'nihility', 'dot'],
  ['Jade', 5, 'quantum', 'erudition', 'crit_atk'],
  ['Jiaoqiu', 5, 'fire', 'nihility', 'debuffer'],
  ['Jing Yuan', 5, 'lightning', 'erudition', 'crit_atk'],
  ['Jingliu', 5, 'ice', 'destruction', 'crit_atk'],
  ['Kafka', 5, 'lightning', 'nihility', 'dot'],
  ['Lingsha', 5, 'fire', 'abundance', 'healer'],
  ['Luocha', 5, 'imaginary', 'abundance', 'healer'],
  ['Mydei', 5, 'imaginary', 'destruction', 'crit_hp'],
  ['Phainon', 5, 'physical', 'destruction', 'crit_atk'],
  ['Rappa', 5, 'imaginary', 'erudition', 'break'],
  ['Robin', 5, 'physical', 'harmony', 'support'],
  ['Ruan Mei', 5, 'ice', 'harmony', 'break'],
  ['Saber', 5, 'wind', 'destruction', 'crit_atk'],
  ['Seele', 5, 'quantum', 'hunt', 'crit_atk'],
  ['Silver Wolf', 5, 'quantum', 'nihility', 'debuffer'],
  ['Sparkle', 5, 'quantum', 'harmony', 'support'],
  ['Sunday', 5, 'imaginary', 'harmony', 'support'],
  ['The Herta', 5, 'ice', 'erudition', 'crit_atk'],
  ['Topaz & Numby', 5, 'fire', 'hunt', 'crit_atk'],
  ['Tribbie', 5, 'quantum', 'harmony', 'crit_hp'],
  ['Welt', 5, 'imaginary', 'nihility', 'debuffer'],
  ['Yanqing', 5, 'ice', 'hunt', 'crit_atk'],
  ['Yunli', 5, 'physical', 'destruction', 'crit_atk'],
  /* --- Versions 3.x tardives → 4.6 (source : genshin-builds.com/en/hsr, liste v4.6) --- */
  ['Ashveil', 5, 'lightning', 'hunt', 'crit_atk'],
  /* Profils : d'après les guides de build (Beebom, Icy Veins, Game8, Sportskeeda, Mobalytics…) */
  ['Aventurine • Waveflair', 5, 'quantum', 'elation', 'crit_atk'],   // DPS : Crit / VIT / DGT Quantique / RÉG
  ['Cyrene', 5, 'ice', 'remembrance', 'support'],                    // Support : PV% / VIT / PV% / PV%
  ['Evanescia', 5, 'physical', 'elation', 'crit_atk'],               // DPS : DGT CRIT / VIT / DGT Physique / RÉG
  ['Gilgamesh', 5, 'lightning', 'destruction', 'crit_atk'],
  ['Himeko • Nova', 5, 'fire', 'erudition', 'crit_atk'],
  ['Mortenax Blade', 5, 'fire', 'nihility', 'crit_hp'],              // Taux CRIT / VIT / PV% / RÉG
  ['Pearl', 5, 'ice', 'elation', 'shielder'],                        // Soutien DÉF : DÉF% / VIT / DÉF% / RÉG
  ['Rin Tohsaka', 5, 'quantum', 'erudition', 'crit_atk'],
  ['Robin • Summeretto', 5, 'wind', 'remembrance', 'support'],       // Support : PV% / VIT / PV% / RÉG
  ['Silver Wolf LV.999', 5, 'imaginary', 'elation', 'crit_hp'],      // DPS sans ATQ : Taux CRIT / VIT / PV% / PV%
  ['Sparxie', 5, 'fire', 'elation', 'crit_atk'],                     // Taux CRIT / ATQ% / ATQ% / RÉG
  ['The Dahlia', 5, 'fire', 'nihility', 'break'],
  ['Yao Guang', 5, 'physical', 'elation', 'crit_atk'],               // Taux CRIT / VIT / DGT Physique / RÉG
  ['Trailblazer (Elation)', 5, 'lightning', 'elation', 'crit_atk', 'Pionnier (Allégresse)'], // Sub-DPS Crit / VIT / ATQ% / RÉG
  ['Trailblazer (Destruction)', 5, 'physical', 'destruction', 'crit_atk', 'Pionnier (Destruction)'],
  ['Trailblazer (Preservation)', 5, 'fire', 'preservation', 'shielder', 'Pionnier (Préservation)'],
  ['Trailblazer (Harmony)', 5, 'imaginary', 'harmony', 'break', 'Pionnier (Harmonie)'],
  ['Trailblazer (Remembrance)', 5, 'ice', 'remembrance', 'support', 'Pionnier (Souvenir)'],
  ['Arlan', 4, 'lightning', 'destruction', 'crit_atk'],
  ['Asta', 4, 'fire', 'harmony', 'support'],
  ['Dan Heng', 4, 'wind', 'hunt', 'crit_atk'],
  ['Gallagher', 4, 'fire', 'abundance', 'healer'],
  ['Guinaifen', 4, 'fire', 'nihility', 'dot'],
  ['Hanya', 4, 'physical', 'harmony', 'support'],
  ['Herta', 4, 'ice', 'erudition', 'crit_atk'],
  ['Hook', 4, 'fire', 'destruction', 'crit_atk'],
  ['Luka', 4, 'physical', 'nihility', 'dot'],
  ['Lynx', 4, 'quantum', 'abundance', 'healer'],
  ['March 7th', 4, 'ice', 'preservation', 'shielder'],
  ['March 7th (Hunt)', 4, 'imaginary', 'hunt', 'crit_atk', 'March 7th (Chasse)'],
  ['Misha', 4, 'ice', 'destruction', 'crit_atk'],
  ['Moze', 4, 'lightning', 'hunt', 'crit_atk'],
  ['Natasha', 4, 'physical', 'abundance', 'healer'],
  ['Pela', 4, 'ice', 'nihility', 'debuffer'],
  ['Qingque', 4, 'quantum', 'erudition', 'crit_atk'],
  ['Sampo', 4, 'wind', 'nihility', 'dot'],
  ['Serval', 4, 'lightning', 'erudition', 'crit_atk'],
  ['Sushang', 4, 'physical', 'hunt', 'break'],
  ['Tingyun', 4, 'lightning', 'harmony', 'support'],
  ['Xueyi', 4, 'quantum', 'destruction', 'break'],
  ['Yukong', 4, 'imaginary', 'harmony', 'support']
].map(([name, rarity, element, path, profile, fr]) => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  name, fr, rarity, element, path, profile
}));

/* Noms et icônes des matériaux : voir js/assets.js (généré depuis les données du jeu). */

/* ---------- Niveaux (EXP cumulée approx.) ---------- */
const LEVELS = [1, 20, 30, 40, 50, 60, 70, 80];
/* Total 1→80 calé sur les guides (289 Traveler's Guides + 3 Adventure Logs ≈ 5 795 000 EXP,
   888 000 crédits avec les ascensions) ; la répartition par palier reste approximative. */
const LEVEL_EXP = { 1: 0, 20: 108800, 30: 326400, 40: 725300, 50: 1414400, 60: 2411700, 70: 3844200, 80: 5795000 };
const EXP_BOOK = 20000;          // Traveler's Guide
const EXP_CREDIT_RATIO = 0.1;    // crédits dépensés par point d'EXP (approx.)

/* ---------- Ascensions (au palier de niveau indiqué) ---------- */
const ASCENSION = {
  5: [
    { lvl: 20, cost: { credits: 4000, c1: 5 } },
    { lvl: 30, cost: { credits: 8000, c1: 10 } },
    { lvl: 40, cost: { credits: 16000, c2: 6, boss: 3 } },
    { lvl: 50, cost: { credits: 40000, c2: 9, boss: 7 } },
    { lvl: 60, cost: { credits: 80000, c3: 6, boss: 20 } },
    { lvl: 70, cost: { credits: 160000, c3: 9, boss: 35 } }
  ],
  4: [
    { lvl: 20, cost: { credits: 3200, c1: 4 } },
    { lvl: 30, cost: { credits: 6400, c1: 8 } },
    { lvl: 40, cost: { credits: 12800, c2: 5, boss: 2 } },
    { lvl: 50, cost: { credits: 32000, c2: 8, boss: 5 } },
    { lvl: 60, cost: { credits: 64000, c3: 5, boss: 15 } },
    { lvl: 70, cost: { credits: 128000, c3: 8, boss: 28 } }
  ]
};

/* ---------- Traces (repli) : coût pour ATTEINDRE le niveau indiqué ---------- */
const ABILITY_COST = {          // Compétence / Ultime / Talent
  2: { credits: 5000, p1: 3, c1: 6 },
  3: { credits: 10000, p2: 3, c2: 3 },
  4: { credits: 20000, p2: 5, c2: 4 },
  5: { credits: 45000, p2: 8, c2: 6 },
  6: { credits: 80000, p3: 3, c3: 3 },
  7: { credits: 120000, p3: 5, c3: 4, weekly: 1 },
  8: { credits: 160000, p3: 8, c3: 6, weekly: 1 },
  9: { credits: 200000, p3: 10, weekly: 1 },
  10: { credits: 250000, p3: 12, weekly: 1, td: 1 }
};
const BASIC_COST = {            // Attaque normale
  2: { credits: 2500, p1: 2, c1: 3 },
  3: { credits: 5000, p2: 2, c2: 2 },
  4: { credits: 10000, p2: 3, c2: 3 },
  5: { credits: 20000, p2: 5, c2: 4 },
  6: { credits: 40000, p3: 3, c3: 3 }
};
/* Traces bonus (petits bonus de stats + 3 traces majeures), pour un 5★.
   Calées pour que « tout au max » donne les totaux des guides :
   3 000 000 crédits · communs 41/56/58 · Voie 18/69/139 · 12 mat. hebdo · 8 Traces du destin
   (totaux d'un 5★ standard d'après les données du jeu). */
const BONUS_TRACES = { credits: 252500, c1: 20, c2: 8, c3: 16, p1: 7, p2: 11, p3: 22, td: 5 };
const TRACE_CREDIT_MULT = { 5: 1, 4: 0.8 };

/* ---------- Énergie (Trailblaze Power) ---------- */
const TP_PER_DAY = 240;
const DEFAULT_RATES = { exp: 24000, credits: 24000, crimson: 6, shadow: 4, echo: 2 };

/* ---------- Vœux ---------- */
const JADE_PER_PULL = 160;
const charRate = n => n <= 73 ? 0.006 : Math.min(1, 0.006 + 0.06 * (n - 73));  // pity max 90
const lcRate = n => n <= 65 ? 0.008 : Math.min(1, 0.008 + 0.07 * (n - 65));    // pity max 80

/* ---------- Reliques ---------- */
const SLOTS = ['head', 'hands', 'body', 'feet', 'sphere', 'rope'];
const MAIN_STATS = {
  head: ['hp'], hands: ['atk'],
  body: ['hp_pct', 'atk_pct', 'def_pct', 'cr', 'cd', 'heal', 'ehr'],
  feet: ['hp_pct', 'atk_pct', 'def_pct', 'spd'],
  sphere: ['hp_pct', 'atk_pct', 'def_pct', ...ELEMENTS.map(e => 'dmg_' + e)],
  rope: ['hp_pct', 'atk_pct', 'def_pct', 'be', 'err']
};
/* Valeur d'un jet de sous-stat sur une relique 5★ : [bas, moyen, haut] */
const SUBSTATS = {
  hp: { roll: [33.87, 38.10, 42.34], pct: false },
  atk: { roll: [16.94, 19.05, 21.17], pct: false },
  def: { roll: [16.94, 19.05, 21.17], pct: false },
  hp_pct: { roll: [3.456, 3.888, 4.32], pct: true },
  atk_pct: { roll: [3.456, 3.888, 4.32], pct: true },
  def_pct: { roll: [4.32, 4.86, 5.4], pct: true },
  spd: { roll: [2, 2.3, 2.6], pct: false },
  cr: { roll: [2.592, 2.916, 3.24], pct: true },
  cd: { roll: [5.184, 5.832, 6.48], pct: true },
  ehr: { roll: [3.456, 3.888, 4.32], pct: true },
  res: { roll: [3.456, 3.888, 4.32], pct: true },
  be: { roll: [5.184, 5.832, 6.48], pct: true }
};
const SUBSTAT_IDS = Object.keys(SUBSTATS);

const RELIC_SETS = [
  'Passerby of Wandering Cloud', 'Musketeer of Wild Wheat', 'Knight of Purity Palace', 'Hunter of Glacial Forest',
  'Champion of Streetwise Boxing', 'Guard of Wuthering Snow', 'Firesmith of Lava-Forging', 'Genius of Brilliant Stars',
  'Band of Sizzling Thunder', 'Eagle of Twilight Line', 'Thief of Shooting Meteor', 'Wastelander of Banditry Desert',
  'Longevous Disciple', 'Messenger Traversing Hackerspace', 'The Ashblazing Grand Duke', 'Prisoner in Deep Confinement',
  'Pioneer Diver of Dead Waters', 'Watchmaker, Master of Dream Machinations', 'Iron Cavalry Against the Scourge',
  'The Wind-Soaring Valorous', "Sacerdos' Relived Ordeal", 'Scholar Lost in Erudition', 'Hero of Triumphant Song',
  'Poet of Mourning Collapse', 'Warrior Goddess of Sun and Thunder', 'Wavestrider Captain', 'World-Remaking Deliverer',
  'Self-Enshrouded Recluse'
];
const PLANAR_SETS = [
  'Space Sealing Station', 'Fleet of the Ageless', 'Pan-Cosmic Commercial Enterprise', 'Belobog of the Architects',
  'Celestial Differentiator', 'Inert Salsotto', 'Talia: Kingdom of Banditry', 'Sprightly Vonwacq', 'Rutilant Arena',
  'Broken Keel', 'Firmament Frontline: Glamoth', 'Penacony, Land of the Dreams', 'Sigonia, the Unclaimed Desolation',
  'Izumo Gensei and Takama Divine Realm', 'Duran, Dynasty of Running Wolves', 'Forge of the Kalpagni Lantern',
  'Lushaka, the Sunken Seas', 'The Wondrous BananAmusement Park', "Bone Collection's Serene Demesne",
  'Giant Tree of Rapt Brooding', 'Arcadia of Woven Dreams', 'Revelry by the Sea'
];
